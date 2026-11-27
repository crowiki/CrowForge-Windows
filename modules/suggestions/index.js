"use strict";
const { EmbedBuilder, MessageFlags, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('suggestions');

// === Schema ===
function ensureSchema() {
  runSql(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      creator_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      channel_id TEXT,
      message_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      upvotes INTEGER NOT NULL DEFAULT 0,
      downvotes INTEGER NOT NULL DEFAULT 0,
      admin_note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS suggestion_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      suggestion_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      vote_type TEXT NOT NULL,
      voted_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (suggestion_id) REFERENCES suggestions(id),
      UNIQUE(suggestion_id, user_id)
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_suggestions_guild ON suggestions(guild_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status)');
  runSql('CREATE INDEX IF NOT EXISTS idx_suggestion_votes_sug ON suggestion_votes(suggestion_id)');
}

// === Helpers ===

function getSuggestion(id) {
  return queryGet('SELECT * FROM suggestions WHERE id = ?', [id]);
}

function getGuildSuggestions(guildId, status) {
  if (status) {
    return queryAll(
      "SELECT * FROM suggestions WHERE guild_id = ? AND status = ? ORDER BY created_at DESC",
      [guildId, status]
    );
  }
  return queryAll(
    'SELECT * FROM suggestions WHERE guild_id = ? ORDER BY created_at DESC',
    [guildId]
  );
}

function getUserVote(suggestionId, userId) {
  return queryGet(
    'SELECT vote_type FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?',
    [suggestionId, userId]
  );
}

function getVoteCounts(suggestionId) {
  const up = queryGet(
    "SELECT COUNT(*) as count FROM suggestion_votes WHERE suggestion_id = ? AND vote_type = 'up'",
    [suggestionId]
  );
  const down = queryGet(
    "SELECT COUNT(*) as count FROM suggestion_votes WHERE suggestion_id = ? AND vote_type = 'down'",
    [suggestionId]
  );
  return { up: up?.count ?? 0, down: down?.count ?? 0 };
}

// === Comandos Slash ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('sugestao')
      .setDescription('Gerencia sugestões do servidor.')
      .addSubcommand(sub =>
        sub.setName('enviar')
          .setDescription('Envia uma nova sugestão.')
          .addStringOption(o => o.setName('titulo').setDescription('Título da sugestão').setRequired(true))
          .addStringOption(o => o.setName('descricao').setDescription('Descrição detalhada da sugestão').setRequired(true))
          .addChannelOption(o => o.setName('canal').setDescription('Canal para publicar a sugestão'))
      )
      .addSubcommand(sub =>
        sub.setName('listar')
          .setDescription('Lista sugestões do servidor.')
          .addStringOption(o =>
            o.setName('status')
              .setDescription('Filtrar por status')
              .addChoices(
                { name: '⏳ Pendente', value: 'pending' },
                { name: '✅ Aprovada', value: 'approved' },
                { name: '❌ Negada', value: 'rejected' },
                { name: '🚀 Implementada', value: 'implemented' }
              )
          )
      )
      .addSubcommand(sub =>
        sub.setName('status')
          .setDescription('Altera o status de uma sugestão (requer permissão de gerenciamento).')
          .addIntegerOption(o => o.setName('id').setDescription('ID da sugestão').setRequired(true))
          .addStringOption(o =>
            o.setName('novo_status')
              .setDescription('Novo status')
              .setRequired(true)
              .addChoices(
                { name: '⏳ Pendente', value: 'pending' },
                { name: '✅ Aprovada', value: 'approved' },
                { name: '❌ Negada', value: 'rejected' },
                { name: '🚀 Implementada', value: 'implemented' }
              )
          )
          .addStringOption(o => o.setName('nota').setDescription('Nota da equipe sobre a sugestão'))
      )
      .addSubcommand(sub =>
        sub.setName('ver')
          .setDescription('Visualiza detalhes de uma sugestão.')
          .addIntegerOption(o => o.setName('id').setDescription('ID da sugestão').setRequired(true))
      )
  ];
}

// === Construção de Embed ===

const STATUS_EMOJI = { pending: '⏳', approved: '✅', rejected: '❌', implemented: '🚀' };
const STATUS_LABEL = { pending: 'Pendente', approved: 'Aprovada', rejected: 'Negada', implemented: 'Implementada' };
const STATUS_COLOR = { pending: 0xffa500, approved: 0x63d2a3, rejected: 0xf87171, implemented: 0x5b8def };

function buildSuggestionEmbed(suggestion) {
  const votes = getVoteCounts(suggestion.id);
  const statusEmoji = STATUS_EMOJI[suggestion.status] || '⏳';
  const statusLabel = STATUS_LABEL[suggestion.status] || 'Pendente';
  const color = STATUS_COLOR[suggestion.status] || 0xffa500;

  const embed = new EmbedBuilder()
    .setTitle(`${statusEmoji} #${suggestion.id} — ${suggestion.title}`)
    .setDescription(suggestion.description)
    .setColor(color)
    .addFields(
      { name: '👍 Votos positivos', value: String(votes.up), inline: true },
      { name: '👎 Votos negativos', value: String(votes.down), inline: true },
      { name: 'Status', value: statusLabel, inline: true }
    )
    .setFooter({ text: `Sugestão #${suggestion.id} • Por <@${suggestion.creator_id}>` })
    .setTimestamp(new Date(suggestion.created_at));

  if (suggestion.admin_note) {
    embed.addFields({ name: '📝 Nota da equipe', value: suggestion.admin_note });
  }

  return embed;
}

function buildSuggestionButtons(suggestionId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`sug:up:${suggestionId}`)
        .setLabel('👍 Apoiar')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`sug:down:${suggestionId}`)
        .setLabel('👎 Não apoiar')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`sug:info:${suggestionId}`)
        .setLabel('ℹ️ Detalhes')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

// === Handlers ===

async function handleEnviar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta da sugestão');
    return;
  }

  try {
    const title = interaction.options.getString('titulo', true);
    const description = interaction.options.getString('descricao', true);

    let targetChannelId;
    const channelOption = interaction.options.getChannel('canal');
    if (channelOption) {
      targetChannelId = channelOption.id;
    } else if (interaction.channelId) {
      targetChannelId = interaction.channelId;
    } else if (interaction.channel && interaction.channel.id) {
      targetChannelId = interaction.channel.id;
    }

    if (!targetChannelId) {
      return interaction.editReply({ content: '❌ Canal não encontrado. Especifique um canal com a opção `canal`.' });
    }

    if (title.length > 256) {
      return interaction.editReply({ content: '❌ Título muito longo (máximo 256 caracteres).' });
    }

    runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
      [interaction.guildId, interaction.guild?.name || 'Unknown']);

    runSql(
      'INSERT INTO suggestions (guild_id, creator_id, title, description, channel_id) VALUES (?, ?, ?, ?, ?)',
      [interaction.guildId, interaction.user.id, title, description, targetChannelId]
    );

    const sugRow = queryGet(
      "SELECT id FROM suggestions WHERE guild_id = ? AND title = ? ORDER BY id DESC LIMIT 1",
      [interaction.guildId, title]
    );

    if (!sugRow || !sugRow.id) {
      log.error({ guildId: interaction.guildId, title }, 'Falha ao recuperar ID da sugestão após inserção');
      return interaction.editReply({ content: '❌ Falha ao salvar a sugestão no banco de dados.' });
    }

    const sugId = Number(sugRow.id);
    const suggestion = getSuggestion(sugId);

    if (!suggestion) {
      log.error({ sugId }, 'Sugestão não encontrada logo após inserção');
      return interaction.editReply({ content: '❌ Erro ao carregar dados da sugestão.' });
    }

    const embed = buildSuggestionEmbed(suggestion);
    const components = buildSuggestionButtons(sugId);

    let targetChannel;
    try {
      targetChannel = await interaction.guild.channels.fetch(targetChannelId);
    } catch (fetchErr) {
      log.error({ err: fetchErr, channelId: targetChannelId }, 'Falha ao buscar canal para sugestão');
      return interaction.editReply({ content: '❌ Não foi possível acessar o canal informado.' });
    }

    if (!targetChannel || typeof targetChannel.send !== 'function') {
      return interaction.editReply({ content: '❌ O canal informado não é um canal de texto válido.' });
    }

    const msg = await targetChannel.send({ embeds: [embed], components });

    runSql("UPDATE suggestions SET message_id = ? WHERE id = ?", [msg.id, sugId]);

    log.info({ sugId, guildId: interaction.guildId, title }, 'Sugestão criada');

    await interaction.editReply({
      content: `✅ Sugestão #${sugId} enviada com sucesso em <#${targetChannelId}>!`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro fatal ao criar sugestão');
    try {
      await interaction.editReply({ content: `❌ Erro interno ao criar a sugestão: ${err?.message || 'desconhecido'}` });
    } catch {
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ Erro interno ao criar a sugestão.', flags: MessageFlags.Ephemeral });
        }
      } catch { /* ignora */ }
    }
  }
}

async function handleListar(interaction) {
  const status = interaction.options.getString('status') || null;
  const suggestions = getGuildSuggestions(interaction.guildId, status);

  if (suggestions.length === 0) {
    return interaction.reply({ content: '📋 Nenhuma sugestão encontrada com este filtro.', flags: MessageFlags.Ephemeral });
  }

  const list = suggestions.slice(0, 20).map(s => {
    const votes = getVoteCounts(s.id);
    const emoji = STATUS_EMOJI[s.status] || '⏳';
    return `\`#${s.id}\` ${emoji} **${s.title}** — 👍${votes.up} 👎${votes.down}`;
  }).join('\n');

  const filterLabel = status ? STATUS_LABEL[status] : 'Todos';

  const embed = new EmbedBuilder()
    .setTitle('📋 Sugestões do Servidor')
    .setDescription(list)
    .setColor(0xffa500)
    .setFooter({ text: `Filtro: ${filterLabel} • Use /sugestao ver id:<número> para detalhes` });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleStatus(interaction) {
  const sugId = interaction.options.getInteger('id', true);
  const newStatus = interaction.options.getString('novo_status', true);
  const note = interaction.options.getString('nota') || '';

  const suggestion = getSuggestion(sugId);

  if (!suggestion || suggestion.guild_id !== interaction.guildId) {
    return interaction.reply({ content: '❌ Sugestão não encontrada neste servidor.', flags: MessageFlags.Ephemeral });
  }

  runSql("UPDATE suggestions SET status = ?, admin_note = ? WHERE id = ?",
    [newStatus, note, sugId]);

  suggestion.status = newStatus;
  if (note) suggestion.admin_note = note;

  const embed = buildSuggestionEmbed(suggestion);

  // Tentar editar a mensagem original
  if (suggestion.message_id && suggestion.channel_id) {
    try {
      const channel = await interaction.guild.channels.fetch(suggestion.channel_id);
      if (channel?.isTextBased()) {
        const msg = await channel.messages.fetch(suggestion.message_id);
        await msg.edit({ embeds: [embed], components: suggestion.status === 'pending' ? buildSuggestionButtons(sugId) : [] });
      }
    } catch (err) {
      log.warn({ err, sugId }, 'Falha ao editar mensagem original da sugestão');
    }
  }

  log.info({ sugId, guildId: interaction.guildId, newStatus }, 'Status da sugestão alterado');

  return interaction.reply({
    content: `✅ Sugestão #${sugId} atualizada para **${STATUS_LABEL[newStatus]}**.`,
    embeds: [embed],
    flags: MessageFlags.Ephemeral
  });
}

async function handleVer(interaction) {
  const sugId = interaction.options.getInteger('id', true);
  const suggestion = getSuggestion(sugId);

  if (!suggestion || suggestion.guild_id !== interaction.guildId) {
    return interaction.reply({ content: '❌ Sugestão não encontrada neste servidor.', flags: MessageFlags.Ephemeral });
  }

  const embed = buildSuggestionEmbed(suggestion);
  const components = suggestion.status === 'pending' ? buildSuggestionButtons(sugId) : [];

  return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

// === Handler de botão de voto ===

async function handleSuggestionButton(interaction) {
  if (!interaction.customId.startsWith('sug:')) return false;

  const parts = interaction.customId.split(':');
  const action = parts[1];
  const sugId = Number(parts[2]);

  const suggestion = getSuggestion(sugId);
  if (!suggestion) {
    await interaction.reply({ content: '❌ Sugestão não encontrada.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === 'info') {
    const embed = buildSuggestionEmbed(suggestion);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === 'up' || action === 'down') {
    const voteType = action === 'up' ? 'up' : 'down';
    const existing = getUserVote(sugId, interaction.user.id);

    if (existing) {
      if (existing.vote_type === voteType) {
        // Remover voto (toggle)
        runSql('DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?',
          [sugId, interaction.user.id]);

        await interaction.reply({
          content: `🔄 Seu voto foi removido da sugestão #${sugId}.`,
          flags: MessageFlags.Ephemeral
        });
      } else {
        // Mudar voto
        runSql("UPDATE suggestion_votes SET vote_type = ?, voted_at = datetime('now') WHERE suggestion_id = ? AND user_id = ?",
          [voteType, sugId, interaction.user.id]);

        await interaction.reply({
          content: `✅ Seu voto foi alterado para ${action === 'up' ? '👍 Apoiar' : '👎 Não apoiar'} na sugestão #${sugId}.`,
          flags: MessageFlags.Ephemeral
        });
      }
    } else {
      // Novo voto
      runSql('INSERT INTO suggestion_votes (suggestion_id, user_id, vote_type) VALUES (?, ?, ?)',
        [sugId, interaction.user.id, voteType]);

      await interaction.reply({
        content: `✅ Voto registrado: ${action === 'up' ? '👍 Apoiar' : '👎 Não apoiar'} na sugestão #${sugId}!`,
        flags: MessageFlags.Ephemeral
      });
    }

    // Atualizar embed da mensagem original
    try {
      const updatedSuggestion = getSuggestion(sugId);
      const embed = buildSuggestionEmbed(updatedSuggestion);
      const components = buildSuggestionButtons(sugId);
      await interaction.message.edit({ embeds: [embed], components });
    } catch (err) {
      log.warn({ err, sugId }, 'Falha ao atualizar embed da sugestão');
    }

    return true;
  }

  return false;
}

// === Contrato do Módulo ===
let context = null;

module.exports = {
  name: 'suggestions',
  getCommands,

  async init(ctx) {
    context = ctx;
    ensureSchema();
    log.info('Módulo Sugestões inicializado');
  },

  async start() {
    if (!context?.bus) return;

    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;

      if (interaction.isButton()) {
        const handled = await handleSuggestionButton(interaction);
        if (handled) return;
      }

      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'sugestao') return;

      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'enviar': return handleEnviar(interaction);
        case 'listar': return handleListar(interaction);
        case 'status': return handleStatus(interaction);
        case 'ver': return handleVer(interaction);
      }
    });

    log.info('Módulo Sugestões iniciado — handlers registrados');
  },

  async stop() {
    log.info('Módulo Sugestões parado');
  },

  health() {
    const pending = queryGet("SELECT COUNT(*) as count FROM suggestions WHERE status = 'pending'");
    return {
      status: 'ok',
      pendingSuggestions: pending?.count ?? 0
    };
  }
};