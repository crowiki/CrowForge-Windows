"use strict";
const { EmbedBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('temp-voice');

// === Schema ===
function ensureSchema() {
  runSql('DROP TABLE IF EXISTS temp_voice_config');
  runSql('DROP TABLE IF EXISTS temp_voice_channels');

  runSql(`
    CREATE TABLE IF NOT EXISTS temp_voice_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL UNIQUE,
      hub_channel_id TEXT NOT NULL,
      category_id TEXT,
      default_user_limit INTEGER NOT NULL DEFAULT 0,
      default_bitrate INTEGER NOT NULL DEFAULT 64,
      enabled INTEGER NOT NULL DEFAULT 1
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS temp_voice_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_temp_voice_config_guild ON temp_voice_config(guild_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_temp_voice_channels_guild ON temp_voice_channels(guild_id)');
}

// === Helpers ===

function getConfig(guildId) {
  return queryGet('SELECT * FROM temp_voice_config WHERE guild_id = ?', [guildId]);
}

function isTempChannel(channelId) {
  const row = queryGet('SELECT id FROM temp_voice_channels WHERE channel_id = ?', [channelId]);
  return !!row;
}

function getTempChannel(channelId) {
  return queryGet('SELECT * FROM temp_voice_channels WHERE channel_id = ?', [channelId]);
}

function getUserTempChannel(guildId, userId) {
  return queryGet('SELECT * FROM temp_voice_channels WHERE guild_id = ? AND owner_id = ?', [guildId, userId]);
}

function addTempChannel(guildId, channelId, ownerId) {
  runSql(
    'INSERT INTO temp_voice_channels (guild_id, channel_id, owner_id) VALUES (?, ?, ?)',
    [guildId, channelId, ownerId]
  );
}

function removeTempChannel(channelId) {
  runSql('DELETE FROM temp_voice_channels WHERE channel_id = ?', [channelId]);
}

// === Comandos Slash ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('voz-temp')
      .setDescription('Gerencia canais de voz temporários.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(sub =>
        sub.setName('configurar')
          .setDescription('Configura o sistema de voz temporária.')
          .addChannelOption(o => o.setName('hub').setDescription('Canal de entrada (hub)').setRequired(true))
          .addChannelOption(o => o.setName('categoria').setDescription('Categoria para criar canais temporários'))
          .addIntegerOption(o => o.setName('limite').setDescription('Limite padrão de usuários (0 = sem limite)'))
      )
      .addSubcommand(sub =>
        sub.setName('desativar')
          .setDescription('Desativa o sistema de voz temporária.')
      )
      .addSubcommand(sub =>
        sub.setName('info')
          .setDescription('Mostra configuração atual do sistema.')
      )
  ];
}

// === Handlers ===

async function handleConfigurar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de configuração');
    return;
  }

  try {
    const hubChannel = interaction.options.getChannel('hub', true);
    const categoryChannel = interaction.options.getChannel('categoria');
    const userLimit = interaction.options.getInteger('limite') || 0;

    if (hubChannel.type !== ChannelType.GuildVoice) {
      return interaction.editReply({ content: '❌ O canal hub deve ser um canal de voz.' });
    }

    if (categoryChannel && categoryChannel.type !== ChannelType.GuildCategory) {
      return interaction.editReply({ content: '❌ O canal de categoria deve ser uma categoria.' });
    }

    runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
      [interaction.guildId, interaction.guild?.name || 'Unknown']);

    const existing = getConfig(interaction.guildId);
    if (existing) {
      runSql(
        'UPDATE temp_voice_config SET hub_channel_id = ?, category_id = ?, default_user_limit = ?, enabled = 1 WHERE guild_id = ?',
        [hubChannel.id, categoryChannel?.id || null, userLimit, interaction.guildId]
      );
    } else {
      runSql(
        'INSERT INTO temp_voice_config (guild_id, hub_channel_id, category_id, default_user_limit, enabled) VALUES (?, ?, ?, ?, 1)',
        [interaction.guildId, hubChannel.id, categoryChannel?.id || null, userLimit]
      );
    }

    log.info({ guildId: interaction.guildId, hubChannelId: hubChannel.id }, 'Voz temporária configurada');

    const catMention = categoryChannel ? `<#${categoryChannel.id}>` : 'Sem categoria específica';
    const limitText = userLimit > 0 ? `${userLimit} usuários` : 'sem limite';

    await interaction.editReply({
      content: `✅ Voz temporária configurada!\n\n` +
        `• **Hub:** <#${hubChannel.id}>\n` +
        `• **Categoria:** ${catMention}\n` +
        `• **Limite padrão:** ${limitText}\n\n` +
        `Quando alguém entrar no hub, um canal temporário será criado automaticamente.`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao configurar voz temporária');
    try {
      await interaction.editReply({ content: `❌ Erro ao configurar: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleDesativar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de desativação');
    return;
  }

  try {
    const config = getConfig(interaction.guildId);
    if (!config || !config.enabled) {
      return interaction.editReply({ content: '❌ Voz temporária já está desativada.' });
    }

    runSql('UPDATE temp_voice_config SET enabled = 0 WHERE guild_id = ?', [interaction.guildId]);

    log.info({ guildId: interaction.guildId }, 'Voz temporária desativada');

    await interaction.editReply({ content: '✅ Voz temporária desativada. Os canais temporários existentes serão mantidos até ficarem vazios.' });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao desativar voz temporária');
    try {
      await interaction.editReply({ content: `❌ Erro ao desativar: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleInfo(interaction) {
  const config = getConfig(interaction.guildId);

  if (!config || !config.enabled) {
    return interaction.reply({
      content: '🎙️ Voz temporária não está configurada neste servidor. Use `/voz-temp configurar` para ativar.',
      flags: MessageFlags.Ephemeral
    });
  }

  const activeChannels = queryAll(
    'SELECT * FROM temp_voice_channels WHERE guild_id = ?',
    [interaction.guildId]
  );

  const catMention = config.category_id ? `<#${config.category_id}>` : 'Sem categoria';
  const limitText = config.default_user_limit > 0 ? `${config.default_user_limit} usuários` : 'sem limite';

  let channelList = '';
  if (activeChannels.length > 0) {
    channelList = '\n\n**Canais ativos:**\n' + activeChannels.slice(0, 10).map(c =>
      `• <#${c.channel_id}> — dono: <@${c.owner_id}>`
    ).join('\n');
    if (activeChannels.length > 10) channelList += `\n... e mais ${activeChannels.length - 10}`;
  }

  const embed = new EmbedBuilder()
    .setTitle('🎙️ Voz Temporária')
    .setColor(0x5b8def)
    .addFields(
      { name: 'Hub', value: `<#${config.hub_channel_id}>`, inline: true },
      { name: 'Categoria', value: catMention, inline: true },
      { name: 'Limite padrão', value: limitText, inline: true },
      { name: 'Canais ativos', value: String(activeChannels.length), inline: true }
    )
    .setDescription(channelList || 'Nenhum canal temporário ativo no momento.');

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// === Listener de voiceStateUpdate ===

async function handleVoiceStateUpdate(oldState, newState) {
  if (!require("../state").isEnabled(newState.guild?.id, "temp-voice")) return;
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const config = getConfig(guild.id);
  if (!config || !config.enabled) return;

  const userId = newState.member?.id || oldState.member?.id;
  if (!userId) return;

  // Usuário entrou no hub — criar canal temporário
  if (newState.channelId === config.hub_channel_id && oldState.channelId !== config.hub_channel_id) {
    // Verificar se o usuário já tem um canal temporário
    const existingChannel = getUserTempChannel(guild.id, userId);
    if (existingChannel) {
      try {
        // Mover o usuário para o canal existente
        await newState.member.voice.setChannel(existingChannel.channel_id);
      } catch (err) {
        log.warn({ err, userId, channelId: existingChannel.channel_id }, 'Falha ao mover usuário para canal temporário existente');
      }
      return;
    }

    // Criar novo canal temporário
    try {
      const member = newState.member;
      const displayName = member?.displayName || 'Canal';
      const channelName = `🎙️ ${displayName}`.substring(0, 100);

      const newChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: config.category_id || undefined,
        userLimit: config.default_user_limit,
        bitrate: (config.default_bitrate || 64) * 1000,
        permissionOverwrites: [
          {
            id: userId,
            allow: ['ManageChannels', 'MuteMembers', 'DeafenMembers', 'MoveMembers']
          }
        ]
      });

      addTempChannel(guild.id, newChannel.id, userId);

      // Mover o usuário para o novo canal
      try {
        await newState.member.voice.setChannel(newChannel.id);
      } catch (moveErr) {
        log.warn({ err: moveErr, channelId: newChannel.id }, 'Falha ao mover usuário para novo canal temporário');
      }

      log.info({ guildId: guild.id, channelId: newChannel.id, userId }, 'Canal temporário criado');
    } catch (err) {
      log.error({ err, stack: err?.stack, userId }, 'Erro ao criar canal temporário');
    }
  }

  // Usuário saiu de um canal temporário — verificar se está vazio
  if (oldState.channelId && isTempChannel(oldState.channelId)) {
    try {
      const channel = await guild.channels.fetch(oldState.channelId).catch(() => null);
      if (channel && channel.members.size === 0) {
        // Canal vazio — deletar
        removeTempChannel(oldState.channelId);
        await channel.delete('Canal temporário vazio');
        log.info({ guildId: guild.id, channelId: oldState.channelId }, 'Canal temporário removido (vazio)');
      }
    } catch (err) {
      log.warn({ err, channelId: oldState.channelId }, 'Falha ao verificar/remover canal temporário vazio');
      // Mesmo com erro, remover do banco
      removeTempChannel(oldState.channelId);
    }
  }
}

// === Contrato do Módulo ===
let context = null;

module.exports = {
  name: 'temp-voice',
  getCommands,

  async init(ctx) {
    context = ctx;
    ensureSchema();
    log.info('Módulo Voz Temporária inicializado');
  },

  async start() {
    if (!context?.bus) return;

    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'voz-temp') return;

      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'configurar': return handleConfigurar(interaction);
        case 'desativar': return handleDesativar(interaction);
        case 'info': return handleInfo(interaction);
      }
    });

    // Listener de voice state para criar/remover canais
    if (context.client) {
      context.client.on('voiceStateUpdate', handleVoiceStateUpdate);
    }

    log.info('Módulo Voz Temporária iniciado — handlers e listeners registrados');
  },

  async stop() {
    if (context?.client) {
      context.client.off('voiceStateUpdate', handleVoiceStateUpdate);
    }
    log.info('Módulo Voz Temporária parado');
  },

  health() {
    const configCount = queryGet("SELECT COUNT(*) as count FROM temp_voice_config WHERE enabled = 1");
    const channelCount = queryGet("SELECT COUNT(*) as count FROM temp_voice_channels");
    return {
      status: 'ok',
      configuredGuilds: configCount?.count ?? 0,
      activeChannels: channelCount?.count ?? 0
    };
  }
};