"use strict";
const { EmbedBuilder, MessageFlags, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('polls');

// === Schema ===
function ensureSchema() {
  runSql(`
    CREATE TABLE IF NOT EXISTS polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      creator_id TEXT NOT NULL DEFAULT '',
      question TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      mode TEXT NOT NULL DEFAULT 'public',
      multiple_choice INTEGER NOT NULL DEFAULT 0,
      ends_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS poll_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      option_index INTEGER NOT NULL,
      voted_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (poll_id) REFERENCES polls(id),
      UNIQUE(poll_id, user_id, option_index)
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_polls_guild ON polls(guild_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_polls_status ON polls(status)');
  runSql('CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id)');
}

// === Helpers ===

function getActivePolls(guildId) {
  return queryAll(
    "SELECT * FROM polls WHERE guild_id = ? AND status = 'active' ORDER BY created_at DESC",
    [guildId]
  );
}

function getPoll(pollId) {
  return queryGet('SELECT * FROM polls WHERE id = ?', [pollId]);
}

function getPollVotes(pollId) {
  return queryAll(
    'SELECT * FROM poll_votes WHERE poll_id = ? ORDER BY voted_at ASC',
    [pollId]
  );
}

function getVoteCountByOption(pollId) {
  return queryAll(
    'SELECT option_index, COUNT(*) as count FROM poll_votes WHERE poll_id = ? GROUP BY option_index ORDER BY option_index',
    [pollId]
  );
}

function hasVoted(pollId, userId, optionIndex) {
  const row = queryGet(
    'SELECT id FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_index = ?',
    [pollId, userId, optionIndex]
  );
  return !!row;
}

function getUserVotes(pollId, userId) {
  return queryAll(
    'SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?',
    [pollId, userId]
  );
}

// === Comandos Slash ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('enquete')
      .setDescription('Gerencia enquetes do servidor.')
      .addSubcommand(sub =>
        sub.setName('criar')
          .setDescription('Cria uma nova enquete.')
          .addStringOption(o => o.setName('pergunta').setDescription('Pergunta da enquete').setRequired(true))
          .addStringOption(o => o.setName('opcoes').setDescription('Opções separadas por vírgula (máx 10)').setRequired(true))
          .addIntegerOption(o => o.setName('duracao').setDescription('Duração em horas (0 = sem limite)'))
          .addBooleanOption(o => o.setName('multipla').setDescription('Permitir múltiplas escolhas'))
          .addBooleanOption(o => o.setName('anonima').setDescription('Votos anônimos (não mostra quem votou em quê)'))
          .addChannelOption(o => o.setName('canal').setDescription('Canal para publicar a enquete'))
      )
      .addSubcommand(sub =>
        sub.setName('resultados')
          .setDescription('Visualiza os resultados de uma enquete.')
          .addIntegerOption(o => o.setName('id').setDescription('ID da enquete').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('encerrar')
          .setDescription('Encerra uma enquete ativa (requer permissão de gerenciamento).')
          .addIntegerOption(o => o.setName('id').setDescription('ID da enquete').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('listar')
          .setDescription('Lista enquetes ativas no servidor.')
      )
  ];
}

// === Construção de Embed de Enquete ===

function buildPollEmbed(poll) {
  const options = JSON.parse(poll.options);
  const votes = getVoteCountByOption(poll.id);
  const totalVotes = votes.reduce((sum, v) => sum + v.count, 0);

  const voteMap = {};
  votes.forEach(v => { voteMap[v.option_index] = v.count; });

  const bars = ['🟩', '🟦', '🟨', '🟧', '🟪', '⬜', '🟫', '🔴', '🔵', '🟡'];

  let optionsText = '';
  options.forEach((opt, i) => {
    const count = voteMap[i] || 0;
    const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    const barLength = Math.round(pct / 10);
    const bar = bars[i % bars.length].repeat(barLength) + '⬛'.repeat(10 - barLength);
    optionsText += `\n**${i + 1}.** ${opt}\n${bar} ${count} votos (${pct}%)\n`;
  });

  const isAnon = poll.mode === 'anonymous';
  const endsAt = poll.ends_at ? `<t:${Math.floor(new Date(poll.ends_at).getTime() / 1000)}:R>` : 'Sem limite';

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${poll.question}`)
    .setDescription(optionsText)
    .setColor(0x63d2a3)
    .addFields(
      { name: 'Total de votos', value: String(totalVotes), inline: true },
      { name: 'Encerra em', value: endsAt, inline: true },
      { name: 'Modo', value: isAnon ? '🔒 Anônima' : '🔓 Pública', inline: true }
    )
    .setFooter({ text: `Enquete #${poll.id} • Criada por ${poll.creator_id}` })
    .setTimestamp(new Date(poll.created_at));

  return embed;
}

function buildPollButtons(poll) {
  const options = JSON.parse(poll.options);
  const buttons = options.map((opt, i) =>
    new ButtonBuilder()
      .setCustomId(`poll:vote:${poll.id}:${i}`)
      .setLabel(`${i + 1}`)
      .setStyle(ButtonStyle.Secondary)
  );

  // Discord permite no máximo 5 botões por linha, 25 no total
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }

  return rows;
}

// === Handlers ===

async function handleCriar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta da enquete');
    return;
  }

  try {
    const question = interaction.options.getString('pergunta', true);
    const optionsStr = interaction.options.getString('opcoes', true);
    const duration = interaction.options.getInteger('duracao') || 0;
    const multiple = interaction.options.getBoolean('multipla') || false;
    const anonymous = interaction.options.getBoolean('anonima') || false;

    // Resolver canal alvo: opção explícita ou canal da interação
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

    const options = optionsStr.split(',').map(s => s.trim()).filter(Boolean);

    if (options.length < 2) {
      return interaction.editReply({ content: '❌ A enquete precisa de pelo menos 2 opções.' });
    }
    if (options.length > 10) {
      return interaction.editReply({ content: '❌ Máximo de 10 opções permitidas.' });
    }

    const endsAt = duration > 0
      ? new Date(Date.now() + duration * 60 * 60 * 1000).toISOString()
      : null;

    // Garantir que a guild existe na tabela
    runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
      [interaction.guildId, interaction.guild?.name || 'Unknown']);

    // Inserir enquete e obter ID diretamente
    runSql(
      'INSERT INTO polls (guild_id, channel_id, creator_id, question, options, mode, multiple_choice, ends_at, options_json, created_by, anonymous) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?5, ?3, ?6=\'anonymous\')',
      [interaction.guildId, targetChannelId, interaction.user.id, question, JSON.stringify(options), anonymous ? 'anonymous' : 'public', multiple ? 1 : 0, endsAt]
    );

    // Obter o ID da enquete recém-criada via MAX(id) para esta guild (mais seguro que last_insert_rowid em WASM)
    const pollRow = queryGet(
      "SELECT id FROM polls WHERE guild_id = ? AND question = ? ORDER BY id DESC LIMIT 1",
      [interaction.guildId, question]
    );

    if (!pollRow || !pollRow.id) {
      log.error({ guildId: interaction.guildId, question }, 'Falha ao recuperar ID da enquete após inserção');
      return interaction.editReply({ content: '❌ Falha ao salvar a enquete no banco de dados.' });
    }

    const pollId = Number(pollRow.id);
    const poll = getPoll(pollId);

    if (!poll) {
      log.error({ pollId }, 'Enquete não encontrada logo após inserção');
      return interaction.editReply({ content: '❌ Erro ao carregar dados da enquete.' });
    }

    const embed = buildPollEmbed(poll);
    const components = buildPollButtons(poll);

    // Buscar canal e enviar mensagem
    let targetChannel;
    try {
      targetChannel = await interaction.guild.channels.fetch(targetChannelId);
    } catch (fetchErr) {
      log.error({ err: fetchErr, channelId: targetChannelId }, 'Falha ao buscar canal para enquete');
      return interaction.editReply({ content: '❌ Não foi possível acessar o canal informado.' });
    }

    if (!targetChannel || typeof targetChannel.send !== 'function') {
      return interaction.editReply({ content: '❌ O canal informado não é um canal de texto válido.' });
    }

    const msg = await targetChannel.send({ embeds: [embed], components });

    runSql("UPDATE polls SET message_id = ? WHERE id = ?", [msg.id, pollId]);

    // Agendar encerramento se tiver duração
    if (endsAt) {
      try {
        const { scheduler } = require('../../packages/jobs');
        scheduler.schedule(interaction.guildId, 'poll:end', { pollId }, endsAt);
      } catch (err) {
        log.warn({ err, pollId }, 'Falha ao agendar encerramento da enquete');
      }
    }

    log.info({ pollId, guildId: interaction.guildId, question }, 'Enquete criada');

    await interaction.editReply({
      content: `✅ Enquete #${pollId} criada com sucesso em <#${targetChannelId}>!`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro fatal ao criar enquete');
    try {
      await interaction.editReply({ content: `❌ Erro interno ao criar a enquete: ${err?.message || 'desconhecido'}` });
    } catch {
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ Erro interno ao criar a enquete.', flags: MessageFlags.Ephemeral });
        }
      } catch { /* ignora */ }
    }
  }
}

async function handleResultados(interaction) {
  const pollId = interaction.options.getInteger('id', true);
  const poll = getPoll(pollId);

  if (!poll || poll.guild_id !== interaction.guildId) {
    return interaction.reply({ content: '❌ Enquete não encontrada neste servidor.', flags: MessageFlags.Ephemeral });
  }

  const embed = buildPollEmbed(poll);

  // Se não é anônima, mostrar quem votou em quê
  if (poll.mode !== 'anonymous') {
    const options = JSON.parse(poll.options);
    const allVotes = getPollVotes(pollId);

    const votersByOption = {};
    allVotes.forEach(v => {
      if (!votersByOption[v.option_index]) votersByOption[v.option_index] = [];
      votersByOption[v.option_index].push(`<@${v.user_id}>`);
    });

    let voterText = '';
    options.forEach((opt, i) => {
      const voters = votersByOption[i] || [];
      if (voters.length > 0) {
        const display = voters.length <= 5 ? voters.join(', ') : `${voters.slice(0, 5).join(', ')} e +${voters.length - 5}`;
        voterText += `**${opt}:** ${display}\n`;
      }
    });

    if (voterText) {
      embed.addFields({ name: '👥 Quem votou em quê', value: voterText });
    }
  }

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleEncerrar(interaction) {
  const pollId = interaction.options.getInteger('id', true);
  const poll = getPoll(pollId);

  if (!poll || poll.guild_id !== interaction.guildId) {
    return interaction.reply({ content: '❌ Enquete não encontrada neste servidor.', flags: MessageFlags.Ephemeral });
  }

  if (poll.status !== 'active') {
    return interaction.reply({ content: '❌ Esta enquete já foi encerrada.', flags: MessageFlags.Ephemeral });
  }

  runSql("UPDATE polls SET status = 'closed' WHERE id = ?", [pollId]);
  poll.status = 'closed';

  const embed = buildPollEmbed(poll)
    .setTitle(`📊 ${poll.question} *(Encerrada)*`)
    .setColor(0xf87171);

  // Tentar editar a mensagem original
  if (poll.message_id && poll.channel_id) {
    try {
      const channel = await interaction.guild.channels.fetch(poll.channel_id);
      if (channel?.isTextBased()) {
        const msg = await channel.messages.fetch(poll.message_id);
        await msg.edit({ embeds: [embed], components: [] });
      }
    } catch (err) {
      log.warn({ err, pollId }, 'Falha ao editar mensagem original da enquete');
    }
  }

  log.info({ pollId, guildId: interaction.guildId }, 'Enquete encerrada manualmente');

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleListar(interaction) {
  const polls = getActivePolls(interaction.guildId);

  if (polls.length === 0) {
    return interaction.reply({ content: '📊 Nenhuma enquete ativa neste servidor.', flags: MessageFlags.Ephemeral });
  }

  const list = polls.map(p => {
    const votes = getVoteCountByOption(p.id);
    const total = votes.reduce((sum, v) => sum + v.count, 0);
    const endsText = p.ends_at ? `• Encerra: <t:${Math.floor(new Date(p.ends_at).getTime() / 1000)}:R>` : '• Sem limite';
    return `\`#${p.id}\` **${p.question}** — ${total} votos ${endsText}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('📊 Enquetes Ativas')
    .setDescription(list)
    .setColor(0x63d2a3)
    .setFooter({ text: 'Use /enquete resultados id:<número> para ver detalhes' });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// === Handler de botão de voto ===

async function handleVoteButton(interaction) {
  if (!interaction.customId.startsWith('poll:vote:')) return false;

  const parts = interaction.customId.split(':');
  const pollId = Number(parts[2]);
  const optionIndex = Number(parts[3]);

  const poll = getPoll(pollId);
  if (!poll) {
    await interaction.reply({ content: '❌ Enquete não encontrada.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (poll.status !== 'active') {
    await interaction.reply({ content: '❌ Esta enquete já foi encerrada.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (poll.ends_at && new Date(poll.ends_at) < new Date()) {
    runSql("UPDATE polls SET status = 'closed' WHERE id = ?", [pollId]);
    await interaction.reply({ content: '⏰ Esta enquete já expirou.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const options = JSON.parse(poll.options);
  const alreadyVoted = hasVoted(pollId, interaction.user.id, optionIndex);

  if (alreadyVoted) {
    // Remover voto (toggle)
    runSql('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_index = ?',
      [pollId, interaction.user.id, optionIndex]);

    await interaction.reply({
      content: `🔄 Voto na opção **${options[optionIndex]}** removido.`,
      flags: MessageFlags.Ephemeral
    });
  } else {
    // Se não permite múltipla escolha, remover votos anteriores
    if (!poll.multiple_choice) {
      runSql('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?',
        [pollId, interaction.user.id]);
    }

    runSql('INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES (?, ?, ?)',
      [pollId, interaction.user.id, optionIndex]);

    await interaction.reply({
      content: `✅ Voto registrado na opção **${options[optionIndex]}**!`,
      flags: MessageFlags.Ephemeral
    });
  }

  // Atualizar embed da mensagem original
  try {
    const updatedPoll = getPoll(pollId);
    const embed = buildPollEmbed(updatedPoll);
    const components = buildPollButtons(updatedPoll);
    await interaction.message.edit({ embeds: [embed], components });
  } catch (err) {
    log.warn({ err, pollId }, 'Falha ao atualizar embed da enquete');
  }

  return true;
}

// === Handler de job de encerramento ===

async function handlePollEndJob(payload, job) {
  const { pollId } = payload;
  const poll = getPoll(pollId);

  if (!poll || poll.status !== 'active') return;

  runSql("UPDATE polls SET status = 'closed' WHERE id = ?", [pollId]);
  poll.status = 'closed';

  log.info({ pollId }, 'Enquete encerrada automaticamente por tempo');

  // Tentar editar a mensagem original com resultado final
  if (poll.message_id && poll.channel_id) {
    try {
      const { Client } = require('discord.js');
      // Precisamos do client — pegar do contexto global
      // O job handler recebe o payload mas não tem acesso direto ao client
      // Vamos buscar o guild e channel via cache se possível
      // Por agora, apenas logar
      log.info({ pollId, channelId: poll.channel_id, messageId: poll.message_id },
        'Enquete encerrada — edição da mensagem requer acesso ao client');
    } catch (err) {
      log.warn({ err, pollId }, 'Falha ao atualizar mensagem de enquete encerrada');
    }
  }
}

// === Contrato do Módulo ===
let context = null;

module.exports = {
  name: 'polls',
  getCommands,

  async init(ctx) {
    context = ctx;
    ensureSchema();

    // Registrar handler de job para encerramento automático
    try {
      const { scheduler } = require('../../packages/jobs');
      scheduler.register('poll:end', handlePollEndJob);
    } catch (err) {
      log.warn({ err }, 'Falha ao registrar handler de job poll:end');
    }

    log.info('Módulo Enquetes inicializado');
  },

  async start() {
    if (!context?.bus) return;

    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;

      if (interaction.isButton()) {
        const handled = await handleVoteButton(interaction);
        if (handled) return;
      }

      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'enquete') return;

      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'criar': return handleCriar(interaction);
        case 'resultados': return handleResultados(interaction);
        case 'encerrar': return handleEncerrar(interaction);
        case 'listar': return handleListar(interaction);
      }
    });

    log.info('Módulo Enquetes iniciado — handlers registrados');
  },

  async stop() {
    log.info('Módulo Enquetes parado');
  },

  health() {
    const active = queryGet("SELECT COUNT(*) as count FROM polls WHERE status = 'active'");
    return {
      status: 'ok',
      activePolls: active?.count ?? 0
    };
  }
};