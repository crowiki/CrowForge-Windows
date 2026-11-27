"use strict";
const { EmbedBuilder, MessageFlags, ChannelType } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('stats');

// === Schema ===
function ensureSchema() {
  runSql(`
    CREATE TABLE IF NOT EXISTS message_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 1,
      last_active TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(guild_id, user_id, channel_id)
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS voice_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      time_seconds INTEGER NOT NULL DEFAULT 0,
      last_join TEXT,
      UNIQUE(guild_id, user_id, channel_id)
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_message_stats_guild ON message_stats(guild_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_voice_stats_guild ON voice_stats(guild_id)');
}

// === Helpers ===

function getGuildMessageStats(guildId) {
  return queryAll(
    'SELECT user_id, SUM(message_count) as total FROM message_stats WHERE guild_id = ? GROUP BY user_id ORDER BY total DESC',
    [guildId]
  );
}

function getUserMessageStats(guildId, userId) {
  const row = queryGet(
    'SELECT SUM(message_count) as total FROM message_stats WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );
  return row?.total ?? 0;
}

function getGuildVoiceStats(guildId) {
  return queryAll(
    'SELECT user_id, SUM(time_seconds) as total FROM voice_stats WHERE guild_id = ? GROUP BY user_id ORDER BY total DESC',
    [guildId]
  );
}

function getUserVoiceStats(guildId, userId) {
  const row = queryGet(
    'SELECT SUM(time_seconds) as total FROM voice_stats WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );
  return row?.total ?? 0;
}

function formatDuration(seconds) {
  if (!seconds || seconds === 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// === Comandos Slash ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Visualiza estatísticas do servidor e membros.')
      .addSubcommand(sub =>
        sub.setName('servidor')
          .setDescription('Mostra estatísticas gerais do servidor.')
      )
      .addSubcommand(sub =>
        sub.setName('usuario')
          .setDescription('Mostra estatísticas de um usuário.')
          .addUserOption(o => o.setName('usuario').setDescription('Usuário para ver stats'))
      )
      .addSubcommand(sub =>
        sub.setName('ranking')
          .setDescription('Mostra ranking de atividade do servidor.')
          .addStringOption(o =>
            o.setName('tipo')
              .setDescription('Tipo de ranking')
              .addChoices(
                { name: '💬 Mensagens', value: 'messages' },
                { name: '🎙️ Voz', value: 'voice' }
              )
          )
      )
  ];
}

// === Handlers ===

async function handleServidor(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir stats do servidor');
    return;
  }

  try {
    const guild = interaction.guild;

    // Contar canais por tipo
    const channels = guild.channels.cache;
    const textChannels = channels.filter(c => c.type === ChannelType.GuildText).size;
    const voiceChannels = channels.filter(c => c.type === ChannelType.GuildVoice).size;
    const categories = channels.filter(c => c.type === ChannelType.GuildCategory).size;

    // Contar membros
    const totalMembers = guild.memberCount;
    const humans = guild.members.cache.filter(m => !m.user.bot).size;
    const bots = guild.members.cache.filter(m => m.user.bot).size;

    // Stats de mensagens
    const msgStats = getGuildMessageStats(guild.id);
    const totalMessages = msgStats.reduce((sum, s) => sum + s.total, 0);

    // Stats de voz
    const voiceStats = getGuildVoiceStats(guild.id);
    const totalVoiceTime = voiceStats.reduce((sum, s) => sum + s.total, 0);

    // Top 5 usuários ativos
    const topUsers = msgStats.slice(0, 5).map((s, i) =>
      `${i + 1}. <@${s.user_id}> — ${s.total} mensagens`
    ).join('\n') || 'Nenhuma atividade registrada';

    const embed = new EmbedBuilder()
      .setTitle(`📊 Estatísticas de ${guild.name}`)
      .setColor(0x5b8def)
      .setThumbnail(guild.iconURL({ dynamic: true }))
      .addFields(
        { name: '👥 Membros', value: `Total: ${totalMembers}\nHumanos: ${humans}\nBots: ${bots}`, inline: true },
        { name: '📝 Canais', value: `Texto: ${textChannels}\nVoz: ${voiceChannels}\nCategorias: ${categories}`, inline: true },
        { name: '📈 Atividade', value: `Mensagens: ${totalMessages}\nVoz: ${formatDuration(totalVoiceTime)}`, inline: true },
        { name: '🏆 Top 5 Ativos', value: topUsers, inline: false }
      )
      .setFooter({ text: `ID: ${guild.id}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao gerar stats do servidor');
    try {
      await interaction.editReply({ content: `❌ Erro ao gerar estatísticas: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleUsuario(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir stats do usuário');
    return;
  }

  try {
    const targetUser = interaction.options.getUser('usuario') || interaction.user;
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      return interaction.editReply({ content: '❌ Usuário não encontrado neste servidor.' });
    }

    // Stats de mensagens
    const messageCount = getUserMessageStats(interaction.guildId, targetUser.id);

    // Stats de voz
    const voiceTime = getUserVoiceStats(interaction.guildId, targetUser.id);

    // Informações do membro
    const joinDate = member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : 'Desconhecido';
    const create_date = `<t:${Math.floor(targetUser.createdAt.getTime() / 1000)}:R>`;
    const roles = member.roles.cache.filter(r => r.id !== interaction.guildId).size;

    const embed = new EmbedBuilder()
      .setTitle(`📊 Estatísticas de ${targetUser.displayName}`)
      .setColor(member.displayColor || 0x5b8def)
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: '💬 Mensagens', value: String(messageCount), inline: true },
        { name: '🎙️ Tempo em voz', value: formatDuration(voiceTime), inline: true },
        { name: '🎭 Cargos', value: String(roles), inline: true },
        { name: '📅 Entrou no servidor', value: joinDate, inline: true },
        { name: '📅 Conta criada', value: create_date, inline: true },
        { name: '🤖 Bot?', value: targetUser.bot ? 'Sim' : 'Não', inline: true }
      )
      .setFooter({ text: `ID: ${targetUser.id}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao gerar stats do usuário');
    try {
      await interaction.editReply({ content: `❌ Erro ao gerar estatísticas: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleRanking(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir ranking');
    return;
  }

  try {
    const type = interaction.options.getString('tipo') || 'messages';

    let title, stats, valueLabel;

    if (type === 'voice') {
      title = '🎙️ Ranking de Voz';
      stats = getGuildVoiceStats(interaction.guildId).slice(0, 10);
      valueLabel = (s) => formatDuration(s.total);
    } else {
      title = '💬 Ranking de Mensagens';
      stats = getGuildMessageStats(interaction.guildId).slice(0, 10);
      valueLabel = (s) => `${s.total} mensagens`;
    }

    if (stats.length === 0) {
      return interaction.editReply({ content: '📊 Nenhuma atividade registrada ainda.' });
    }

    const medals = ['🥇', '🥈', '🥉'];
    const list = stats.map((s, i) => {
      const medal = medals[i] || `${i + 1}.`;
      return `${medal} <@${s.user_id}> — ${valueLabel(s)}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(list)
      .setColor(0x5b8def)
      .setFooter({ text: `${stats.length} usuário(s) no ranking` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao gerar ranking');
    try {
      await interaction.editReply({ content: `❌ Erro ao gerar ranking: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

// === Listener de mensagens para stats ===

function handleMessageCreate(message) {
  if (!require("../state").isEnabled(message.guild?.id, "stats")) return;
  if (!message.guild || message.author.bot) return;

  try {
    runSql(
      `INSERT INTO message_stats (guild_id, user_id, channel_id, message_count, last_active)
       VALUES (?, ?, ?, 1, datetime('now'))
       ON CONFLICT(guild_id, user_id, channel_id) DO UPDATE SET
         message_count = message_count + 1,
         last_active = datetime('now')`,
      [message.guild.id, message.author.id, message.channel.id]
    );
  } catch (err) {
    log.warn({ err }, 'Falha ao registrar stat de mensagem');
  }
}

// === Listener de voz para stats ===

function handleVoiceStateUpdate(oldState, newState) {
  if (!require("../state").isEnabled(newState.guild?.id, "stats")) return;
  if (!oldState.guild) return;

  const guildId = oldState.guild.id;
  const userId = oldState.member?.id || newState.member?.id;

  if (!userId) return;

  // Usuário saiu de um canal de voz
  if (oldState.channelId && !newState.channelId) {
    try {
      const lastJoinRow = queryGet(
        'SELECT last_join FROM voice_stats WHERE guild_id = ? AND user_id = ? AND channel_id = ?',
        [guildId, userId, oldState.channelId]
      );

      if (lastJoinRow?.last_join) {
        const joinTime = new Date(lastJoinRow.last_join).getTime();
        const now = Date.now();
        const seconds = Math.floor((now - joinTime) / 1000);

        if (seconds > 0 && seconds < 86400) { // máximo 24h por sessão
          runSql(
            `UPDATE voice_stats SET time_seconds = time_seconds + ?, last_join = NULL
             WHERE guild_id = ? AND user_id = ? AND channel_id = ?`,
            [seconds, guildId, userId, oldState.channelId]
          );
        }
      }
    } catch (err) {
      log.warn({ err }, 'Falha ao calcular tempo de voz ao sair');
    }
  }

  // Usuário entrou em um canal de voz
  if (!oldState.channelId && newState.channelId) {
    try {
      runSql(
        `INSERT INTO voice_stats (guild_id, user_id, channel_id, time_seconds, last_join)
         VALUES (?, ?, ?, 0, datetime('now'))
         ON CONFLICT(guild_id, user_id, channel_id) DO UPDATE SET last_join = datetime('now')`,
        [guildId, userId, newState.channelId]
      );
    } catch (err) {
      log.warn({ err }, 'Falha ao registrar entrada em voz');
    }
  }
}

// === Contrato do Módulo ===
let context = null;

module.exports = {
  name: 'stats',
  getCommands,

  async init(ctx) {
    context = ctx;
    ensureSchema();
    log.info('Módulo Stats inicializado');
  },

  async start() {
    if (!context?.bus) return;

    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'stats') return;

      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'servidor': return handleServidor(interaction);
        case 'usuario': return handleUsuario(interaction);
        case 'ranking': return handleRanking(interaction);
      }
    });

    // Listener de mensagens para contar stats
    if (context.client) {
      context.client.on('messageCreate', handleMessageCreate);
      context.client.on('voiceStateUpdate', handleVoiceStateUpdate);
    }

    log.info('Módulo Stats iniciado — handlers e listeners registrados');
  },

  async stop() {
    if (context?.client) {
      context.client.off('messageCreate', handleMessageCreate);
      context.client.off('voiceStateUpdate', handleVoiceStateUpdate);
    }
    log.info('Módulo Stats parado');
  },

  health() {
    const msgCount = queryGet("SELECT SUM(message_count) as total FROM message_stats");
    const voiceCount = queryGet("SELECT SUM(time_seconds) as total FROM voice_stats");
    return {
      status: 'ok',
      totalMessages: msgCount?.total ?? 0,
      totalVoiceSeconds: voiceCount?.total ?? 0
    };
  }
};