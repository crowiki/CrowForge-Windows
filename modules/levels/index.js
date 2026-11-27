"use strict";
const { EmbedBuilder, MessageFlags, Events } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('levels');

// Configuração padrão
const XP_COOLDOWN_MS = 60_000; // 1 minuto entre ganhos de XP
const BASE_XP = 15;
const XP_VARIANCE = 10; // 15-25 XP por mensagem
const LEVEL_FORMULA = (xp) => Math.floor(0.1 * Math.sqrt(xp));

// Cooldown por usuário (guildId:userId -> timestamp)
const cooldowns = new Map();

function getGuildSetting(guildId, key) {
  const row = queryGet(
    "SELECT value FROM settings WHERE guild_id = ? AND module = 'levels' AND key = ?",
    [guildId, key]
  );
  return row?.value || null;
}

function xpForLevel(level) {
  // Inverso da fórmula: xp = (level / 0.1)^2 = 100 * level^2
  return 100 * level * level;
}

function getOrCreateProfile(guildId, userId) {
  let profile = queryGet(
    'SELECT * FROM level_profiles WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );
  if (!profile) {
    runSql(
      'INSERT INTO level_profiles (guild_id, user_id, xp, level) VALUES (?, ?, 0, 1)',
      [guildId, userId]
    );
    profile = { guild_id: guildId, user_id: userId, xp: 0, level: 1, last_xp_at: null };
  }
  return profile;
}

function getLeaderboard(guildId, limit = 10) {
  return queryAll(
    'SELECT * FROM level_profiles WHERE guild_id = ? ORDER BY xp DESC LIMIT ?',
    [guildId, limit]
  );
}

// === Comandos Slash ===

function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('Mostra seu nível e XP ou o de outro usuário.')
      .addUserOption(o => o.setName('usuario').setDescription('Usuário para consultar (padrão: você)')),

    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Ranking de níveis do servidor.')
      .addIntegerOption(o => o.setName('pagina').setDescription('Página do ranking (padrão: 1)').setMinValue(1)),

    new SlashCommandBuilder()
      .setName('configurar-niveis')
      .setDescription('Configura o sistema de níveis e XP.')
      .setDefaultMemberPermissions(0x20) // ManageGuild
      .addChannelOption(o => o.setName('canal').setDescription('Canal para anunciar level up (vazio = desativado)'))
      .addStringOption(o => o.setName('mensagem').setDescription('Mensagem de level up ({user} {level} {xp})').setMaxLength(200))
      .addBooleanOption(o => o.setName('habilitado').setDescription('Ativar ou desativar o sistema'))
  ];
}

// === Handlers ===

async function handleRank(interaction) {
  const targetUser = interaction.options.getUser('usuario') || interaction.user;
  const profile = getOrCreateProfile(interaction.guildId, targetUser.id);

  const xpNeeded = xpForLevel(profile.level + 1);
  const progress = profile.level > 0
    ? Math.min(100, Math.round((profile.xp / xpNeeded) * 100))
    : 0;

  const progressBar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));

  const embed = new EmbedBuilder()
    .setTitle(`📊 Nível de ${targetUser.username}`)
    .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: 'Nível', value: `**${profile.level}**`, inline: true },
      { name: 'XP Total', value: `**${profile.xp.toLocaleString()}**`, inline: true },
      { name: 'Posição', value: (() => {
      const rankRow = queryGet(
        'SELECT COUNT(*) as pos FROM level_profiles WHERE guild_id = ? AND xp > ?',
        [interaction.guildId, profile.xp]
      );
      return '#' + ((rankRow ? Number(rankRow.pos) : 0) + 1);
    })(), inline: true },
      { name: `Progresso para Nível ${profile.level + 1}`, value: `${progressBar} ${progress}%\n${profile.xp}/${xpNeeded} XP` }
    )
    .setColor(0x22c55e)
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleLeaderboard(interaction) {
  const page = interaction.options.getInteger('pagina') || 1;
  const perPage = 10;
  const offset = (page - 1) * perPage;

  const entries = queryAll(
    'SELECT * FROM level_profiles WHERE guild_id = ? ORDER BY xp DESC LIMIT ? OFFSET ?',
    [interaction.guildId, perPage, offset]
  );

  const totalRow = queryGet(
    'SELECT COUNT(*) as c FROM level_profiles WHERE guild_id = ?',
    [interaction.guildId]
  );
  const total = totalRow ? Number(totalRow.c) : 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (entries.length === 0) {
    return interaction.reply({ content: 'Nenhum membro no ranking ainda. Envie mensagens para começar!', flags: MessageFlags.Ephemeral });
  }

  const lines = entries.map((e, i) => {
    const pos = offset + i + 1;
    const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `**${pos}.**`;
    return `${medal} <@${e.user_id}> — Nível **${e.level}** (${e.xp.toLocaleString()} XP)`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🏆 Leaderboard — ${interaction.guild.name}`)
    .setDescription(lines)
    .setFooter({ text: `Página ${page}/${totalPages} — ${total} membro(s)` })
    .setColor(0xf59e0b)
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

async function handleConfig(interaction) {
  if (!interaction.memberPermissions?.has(0x20)) {
    return interaction.reply({ content: 'Você precisa de Gerenciar Servidor.', flags: MessageFlags.Ephemeral });
  }

  const channel = interaction.options.getChannel('canal');
  const message = interaction.options.getString('mensagem');
  const enabled = interaction.options.getBoolean('habilitado');

  runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
    [interaction.guildId, interaction.guild.name]);

  if (channel !== null) {
    runSql(
      "INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)",
      [interaction.guildId, 'levels', 'levelup_channel', channel?.id || '']
    );
  }
  if (message) {
    runSql(
      "INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)",
      [interaction.guildId, 'levels', 'levelup_message', message]
    );
  }
  if (enabled !== null) {
    try {await context.setEnabled(interaction.guildId,'levels',enabled);}
    catch {return interaction.reply({content:'Falha ao sincronizar os comandos de níveis.',flags:MessageFlags.Ephemeral});}
  }

  const parts = [];
  if (enabled !== null) parts.push(`Sistema: ${enabled ? 'ativado' : 'desativado'}`);
  if (channel !== null) parts.push(`Canal de level up: ${channel ? channel.name : 'desativado'}`);
  if (message) parts.push(`Mensagem personalizada`);

  return interaction.reply({
    content: `✅ Configuração de níveis atualizada! ${parts.join(' | ')}`,
    flags: MessageFlags.Ephemeral
  });
}

// === Listener de mensagens (XP gain) ===

function handleMessage(message) {
  if (!message.guild || message.author.bot) return;

  const guildId = message.guildId;
  const userId = message.author.id;
  const key = `${guildId}:${userId}`;

  // Cooldown
  const lastXp = cooldowns.get(key) || 0;
  if (Date.now() - lastXp < XP_COOLDOWN_MS) return;
  cooldowns.set(key, Date.now());

  // Verificar se módulo está habilitado
  const modRow = queryGet(
    "SELECT enabled FROM modules WHERE guild_id = ? AND module_name = 'levels'",
    [guildId]
  );
  if (!modRow?.enabled) return;

  const profile = getOrCreateProfile(guildId, userId);
  const xpGained = BASE_XP + Math.floor(Math.random() * XP_VARIANCE);
  const newXp = profile.xp + xpGained;
  const newLevel = LEVEL_FORMULA(newXp);
  const oldLevel = profile.level;

  // Atualizar perfil
  runSql(
    "UPDATE level_profiles SET xp = ?, level = ?, last_xp_at = datetime('now') WHERE guild_id = ? AND user_id = ?",
    [newXp, Math.max(newLevel, 1), guildId, userId]
  );

  // Registrar evento
  runSql(
    'INSERT INTO level_events (guild_id, user_id, xp_gained, source) VALUES (?, ?, ?, ?)',
    [guildId, userId, xpGained, 'message']
  );

  // Level up!
  if (newLevel > oldLevel) {
    emitLevelUp(message, newLevel, newXp);
    log.info({ guildId, userId, oldLevel, newLevel, newXp }, 'Level up!');
  }
}

async function emitLevelUp(message, level, xp) {
  const channelId = getGuildSetting(message.guildId, 'levelup_channel');
  const customMsg = getGuildSetting(message.guildId, 'levelup_message');

  const msgTemplate = customMsg || '🎉 Parabéns {user}! Você alcançou o **nível {level}** com {xp} XP!';
  const msg = msgTemplate
    .replace('{user}', `<@${message.author.id}>`)
    .replace('{level}', level)
    .replace('{xp}', xp.toLocaleString());

  const targetChannel = channelId
    ? await message.guild.channels.fetch(channelId).catch(() => null)
    : message.channel;

  if (targetChannel?.isTextBased()) {
    const embed = new EmbedBuilder()
      .setDescription(msg)
      .setColor(0x22c55e)
      .setThumbnail(message.author.displayAvatarURL({ size: 64 }));

    try {
      await targetChannel.send({ embeds: [embed], allowedMentions: { parse: ['users'] } });
    } catch (err) {
      log.warn({ err, channelId }, 'Falha ao enviar mensagem de level up');
    }
  }
}

// === Contrato do Módulo ===

let context = null;
let _messageHandler = null;

module.exports = {
  name: 'levels',
  getCommands,

  async init(ctx) {
    context = ctx;
    log.info('Módulo Níveis inicializado');
  },

  async start() {
    if (!context?.client) return;

    // Listener de mensagens para XP (requer MessageContent intent)
    _messageHandler = (message) => {
      if (process.env.GUILD_ID && message.guild?.id !== process.env.GUILD_ID) return;
      try {
        handleMessage(message);
      } catch (err) {
        log.error({ err }, 'Erro no handler de XP');
      }
    };
    context.client.on(Events.MessageCreate, _messageHandler);

    // Listener de comandos
    if (context.bus) {
      context.bus.on('interaction:create', async ({ interaction }) => {
        if (!interaction.inGuild() || !interaction.isChatInputCommand()) return;

        switch (interaction.commandName) {
          case 'rank': return handleRank(interaction);
          case 'leaderboard': return handleLeaderboard(interaction);
          case 'configurar-niveis': return handleConfig(interaction);
        }
      });
    }

    log.info('Módulo Níveis iniciado — handlers registrados');
  },

  async stop() {
    if (context?.client && _messageHandler) {
      context.client.off(Events.MessageCreate, _messageHandler);
      _messageHandler = null;
    }
    cooldowns.clear();
    log.info('Módulo Níveis parado');
  },

  health() {
    const totalProfiles = queryGet('SELECT COUNT(*) as c FROM level_profiles');
    return {
      status: 'ok',
      totalProfiles: totalProfiles ? Number(totalProfiles.c) : 0,
      activeCooldowns: cooldowns.size
    };
  }
};