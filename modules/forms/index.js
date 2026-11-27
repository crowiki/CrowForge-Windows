"use strict";
const { EmbedBuilder, MessageFlags, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('forms');

// === Schema ===
function ensureSchema() {
  runSql(`
    CREATE TABLE IF NOT EXISTS forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      creator_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      fields TEXT NOT NULL DEFAULT '[]',
      channel_id TEXT,
      message_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      anonymous INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS form_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      responses TEXT NOT NULL DEFAULT '{}',
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (form_id) REFERENCES forms(id)
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_forms_guild ON forms(guild_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_forms_status ON forms(status)');
  runSql('CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON form_submissions(form_id)');
}

// === Helpers ===

function getActiveForms(guildId) {
  return queryAll(
    "SELECT * FROM forms WHERE guild_id = ? AND status = 'active' ORDER BY created_at DESC",
    [guildId]
  );
}

function getForm(formId) {
  return queryGet('SELECT * FROM forms WHERE id = ?', [formId]);
}

function getSubmissions(formId) {
  return queryAll(
    'SELECT * FROM form_submissions WHERE form_id = ? ORDER BY submitted_at DESC',
    [formId]
  );
}

function getSubmissionCount(formId) {
  const row = queryGet(
    'SELECT COUNT(*) as count FROM form_submissions WHERE form_id = ?',
    [formId]
  );
  return row?.count ?? 0;
}

function hasUserSubmitted(formId, userId) {
  const row = queryGet(
    'SELECT id FROM form_submissions WHERE form_id = ? AND user_id = ?',
    [formId, userId]
  );
  return !!row;
}

// === Comandos Slash ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('formulario')
      .setDescription('Gerencia formulários do servidor.')
      .addSubcommand(sub =>
        sub.setName('criar')
          .setDescription('Cria um novo formulário interativo.')
          .addStringOption(o => o.setName('titulo').setDescription('Título do formulário').setRequired(true))
          .addStringOption(o => o.setName('campos').setDescription('Campos separados por | (ex: Nome|Email|Idade)').setRequired(true))
          .addStringOption(o => o.setName('descricao').setDescription('Descrição do formulário'))
          .addBooleanOption(o => o.setName('anonimo').setDescription('Submissões anônimas'))
          .addChannelOption(o => o.setName('canal').setDescription('Canal para publicar o formulário'))
      )
      .addSubcommand(sub =>
        sub.setName('listar')
          .setDescription('Lista formulários ativos no servidor.')
      )
      .addSubcommand(sub =>
        sub.setName('resultados')
          .setDescription('Visualiza submissões de um formulário.')
          .addIntegerOption(o => o.setName('id').setDescription('ID do formulário').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('encerrar')
          .setDescription('Encerra um formulário ativo (requer permissão de gerenciamento).')
          .addIntegerOption(o => o.setName('id').setDescription('ID do formulário').setRequired(true))
      )
  ];
}

// === Construção de Embed ===

function buildFormEmbed(form) {
  const fields = JSON.parse(form.fields);
  const submissionCount = getSubmissionCount(form.id);
  const isAnon = form.anonymous === 1;

  let fieldsText = '';
  fields.forEach((field, i) => {
    fieldsText += `\n**${i + 1}.** ${field}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📋 ${form.title}`)
    .setDescription(form.description || 'Preencha o formulário clicando no botão abaixo.')
    .setColor(0x5b8def)
    .addFields(
      { name: 'Campos', value: fieldsText || 'Nenhum campo definido', inline: false },
      { name: 'Submissões', value: String(submissionCount), inline: true },
      { name: 'Modo', value: isAnon ? '🔒 Anônimo' : '🔓 Público', inline: true },
      { name: 'Status', value: form.status === 'active' ? '✅ Ativo' : '❌ Encerrado', inline: true }
    )
    .setFooter({ text: `Formulário #${form.id} • Criado por ${form.creator_id}` })
    .setTimestamp(new Date(form.created_at));

  return embed;
}

function buildFormButtons(formId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`form:respond:${formId}`)
        .setLabel('📝 Responder Formulário')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`form:results:${formId}`)
        .setLabel('📊 Ver Resultados')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

// === Handlers ===

async function handleCriar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta do formulário');
    return;
  }

  try {
    const title = interaction.options.getString('titulo', true);
    const description = interaction.options.getString('descricao') || '';
    const fieldsStr = interaction.options.getString('campos', true);
    const anonymous = interaction.options.getBoolean('anonimo') || false;

    // Resolver canal alvo
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

    // Parsear campos
    const fields = fieldsStr.split('|').map(s => s.trim()).filter(Boolean);

    if (fields.length < 1) {
      return interaction.editReply({ content: '❌ O formulário precisa de pelo menos 1 campo.' });
    }
    if (fields.length > 5) {
      return interaction.editReply({ content: '❌ Máximo de 5 campos permitidos (limite do Discord para modais).' });
    }

    // Garantir que a guild existe
    runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
      [interaction.guildId, interaction.guild?.name || 'Unknown']);

    // Inserir formulário
    runSql(
      'INSERT INTO forms (guild_id, creator_id, title, description, fields, channel_id, anonymous, form_name, form_type, fields_json, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?3, \'custom\', ?5, ?2)',
      [interaction.guildId, interaction.user.id, title, description, JSON.stringify(fields), targetChannelId, anonymous ? 1 : 0]
    );

    // Obter ID do formulário recém-criado
    const formRow = queryGet(
      "SELECT id FROM forms WHERE guild_id = ? AND title = ? ORDER BY id DESC LIMIT 1",
      [interaction.guildId, title]
    );

    if (!formRow || !formRow.id) {
      log.error({ guildId: interaction.guildId, title }, 'Falha ao recuperar ID do formulário após inserção');
      return interaction.editReply({ content: '❌ Falha ao salvar o formulário no banco de dados.' });
    }

    const formId = Number(formRow.id);
    const form = getForm(formId);

    if (!form) {
      log.error({ formId }, 'Formulário não encontrado logo após inserção');
      return interaction.editReply({ content: '❌ Erro ao carregar dados do formulário.' });
    }

    const embed = buildFormEmbed(form);
    const components = buildFormButtons(formId);

    // Buscar canal e enviar mensagem
    let targetChannel;
    try {
      targetChannel = await interaction.guild.channels.fetch(targetChannelId);
    } catch (fetchErr) {
      log.error({ err: fetchErr, channelId: targetChannelId }, 'Falha ao buscar canal para formulário');
      return interaction.editReply({ content: '❌ Não foi possível acessar o canal informado.' });
    }

    if (!targetChannel || typeof targetChannel.send !== 'function') {
      return interaction.editReply({ content: '❌ O canal informado não é um canal de texto válido.' });
    }

    const msg = await targetChannel.send({ embeds: [embed], components });

    runSql("UPDATE forms SET message_id = ? WHERE id = ?", [msg.id, formId]);

    log.info({ formId, guildId: interaction.guildId, title }, 'Formulário criado');

    await interaction.editReply({
      content: `✅ Formulário #${formId} criado com sucesso em <#${targetChannelId}>!`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro fatal ao criar formulário');
    try {
      await interaction.editReply({ content: `❌ Erro interno ao criar o formulário: ${err?.message || 'desconhecido'}` });
    } catch {
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ Erro interno ao criar o formulário.', flags: MessageFlags.Ephemeral });
        }
      } catch { /* ignora */ }
    }
  }
}

async function handleListar(interaction) {
  const forms = getActiveForms(interaction.guildId);

  if (forms.length === 0) {
    return interaction.reply({ content: '📋 Nenhum formulário ativo neste servidor.', flags: MessageFlags.Ephemeral });
  }

  const list = forms.map(f => {
    const count = getSubmissionCount(f.id);
    return `\`#${f.id}\` **${f.title}** — ${count} submissões`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('📋 Formulários Ativos')
    .setDescription(list)
    .setColor(0x5b8def)
    .setFooter({ text: 'Use /formulario resultados id:<número> para ver detalhes' });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleResultados(interaction) {
  const formId = interaction.options.getInteger('id', true);
  const form = getForm(formId);

  if (!form || form.guild_id !== interaction.guildId) {
    return interaction.reply({ content: '❌ Formulário não encontrado neste servidor.', flags: MessageFlags.Ephemeral });
  }

  const submissions = getSubmissions(formId);
  const fields = JSON.parse(form.fields);

  if (submissions.length === 0) {
    return interaction.reply({ content: '📋 Este formulário ainda não recebeu submissões.', flags: MessageFlags.Ephemeral });
  }

  // Construir resumo das submissões
  let resultText = '';
  const maxShow = Math.min(submissions.length, 10);

  for (let i = 0; i < maxShow; i++) {
    const sub = submissions[i];
    const responses = JSON.parse(sub.responses);
    const userLabel = form.anonymous ? `Anônimo #${i + 1}` : `<@${sub.user_id}>`;

    resultText += `\n**${userLabel}** (${new Date(sub.submitted_at).toLocaleString('pt-BR')})\n`;
    fields.forEach(field => {
      const answer = responses[field] || '*(sem resposta)*';
      resultText += `• **${field}:** ${answer}\n`;
    });
    resultText += '\n';
  }

  if (submissions.length > maxShow) {
    resultText += `\n*... e mais ${submissions.length - maxShow} submissões*`;
  }

  const embed = new EmbedBuilder()
    .setTitle(`📊 Resultados: ${form.title}`)
    .setDescription(resultText)
    .setColor(0x5b8def)
    .setFooter({ text: `Total: ${submissions.length} submissões` });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleEncerrar(interaction) {
  const formId = interaction.options.getInteger('id', true);
  const form = getForm(formId);

  if (!form || form.guild_id !== interaction.guildId) {
    return interaction.reply({ content: '❌ Formulário não encontrado neste servidor.', flags: MessageFlags.Ephemeral });
  }

  if (form.status !== 'active') {
    return interaction.reply({ content: '❌ Este formulário já foi encerrado.', flags: MessageFlags.Ephemeral });
  }

  runSql("UPDATE forms SET status = 'closed' WHERE id = ?", [formId]);
  form.status = 'closed';

  const embed = buildFormEmbed(form);

  // Tentar editar a mensagem original
  if (form.message_id && form.channel_id) {
    try {
      const channel = await interaction.guild.channels.fetch(form.channel_id);
      if (channel?.isTextBased()) {
        const msg = await channel.messages.fetch(form.message_id);
        await msg.edit({ embeds: [embed], components: [] });
      }
    } catch (err) {
      log.warn({ err, formId }, 'Falha ao editar mensagem original do formulário');
    }
  }

  log.info({ formId, guildId: interaction.guildId }, 'Formulário encerrado manualmente');

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// === Handler de botão de resposta ===

async function handleFormButton(interaction) {
  if (!interaction.customId.startsWith('form:')) return false;

  const parts = interaction.customId.split(':');
  const action = parts[1];
  const formId = Number(parts[2]);

  const form = getForm(formId);
  if (!form) {
    await interaction.reply({ content: '❌ Formulário não encontrado.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (form.status !== 'active') {
    await interaction.reply({ content: '❌ Este formulário já foi encerrado.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === 'respond') {
    // Verificar se já respondeu (apenas se não for anônimo)
    if (!form.anonymous && hasUserSubmitted(formId, interaction.user.id)) {
      await interaction.reply({ content: '❌ Você já respondeu este formulário.', flags: MessageFlags.Ephemeral });
      return true;
    }

    // Criar modal com campos dinâmicos
    const fields = JSON.parse(form.fields);
    const modal = new ModalBuilder()
      .setCustomId(`form:submit:${formId}`)
      .setTitle(form.title.substring(0, 45)); // Discord limita título do modal

    fields.forEach((field, i) => {
      const textInput = new TextInputBuilder()
        .setCustomId(`field_${i}`)
        .setLabel(field.substring(0, 45)) // Discord limita label
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(1000);

      const row = new ActionRowBuilder().addComponents(textInput);
      modal.addComponents(row);
    });

    await interaction.showModal(modal);
    return true;
  }

  if (action === 'results') {
    const submissions = getSubmissions(formId);
    const fields = JSON.parse(form.fields);

    if (submissions.length === 0) {
      await interaction.reply({ content: '📋 Este formulário ainda não recebeu submissões.', flags: MessageFlags.Ephemeral });
      return true;
    }

    let resultText = '';
    const maxShow = Math.min(submissions.length, 5);

    for (let i = 0; i < maxShow; i++) {
      const sub = submissions[i];
      const responses = JSON.parse(sub.responses);
      const userLabel = form.anonymous ? `Anônimo #${i + 1}` : `<@${sub.user_id}>`;

      resultText += `\n**${userLabel}**\n`;
      fields.forEach(field => {
        const answer = responses[field] || '*(sem resposta)*';
        resultText += `• **${field}:** ${answer}\n`;
      });
      resultText += '\n';
    }

    if (submissions.length > maxShow) {
      resultText += `\n*... e mais ${submissions.length - maxShow} submissões*`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`📊 Resultados: ${form.title}`)
      .setDescription(resultText)
      .setColor(0x5b8def)
      .setFooter({ text: `Total: ${submissions.length} submissões` });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return true;
  }

  return false;
}

// === Handler de submissão de modal ===

async function handleFormSubmit(interaction) {
  if (!interaction.customId.startsWith('form:submit:')) return false;

  const formId = Number(interaction.customId.split(':')[2]);
  const form = getForm(formId);

  if (!form) {
    await interaction.reply({ content: '❌ Formulário não encontrado.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const fields = JSON.parse(form.fields);
  const responses = {};

  fields.forEach((field, i) => {
    const fieldId = `field_${i}`;
    const value = interaction.fields.getTextInputValue(fieldId);
    responses[field] = value;
  });

  // Salvar submissão
  runSql(
    'INSERT INTO form_submissions (form_id, user_id, responses, answers_json) VALUES (?1, ?2, ?3, ?3)',
    [formId, interaction.user.id, JSON.stringify(responses)]
  );

  log.info({ formId, userId: interaction.user.id }, 'Submissão de formulário registrada');

  await interaction.reply({
    content: '✅ Sua resposta foi registrada com sucesso!',
    flags: MessageFlags.Ephemeral
  });

  return true;
}

// === Contrato do Módulo ===
let context = null;

module.exports = {
  name: 'forms',
  getCommands,

  async init(ctx) {
    context = ctx;
    ensureSchema();
    log.info('Módulo Formulários inicializado');
  },

  async start() {
    if (!context?.bus) return;

    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;

      // Handler de botão
      if (interaction.isButton()) {
        const handled = await handleFormButton(interaction);
        if (handled) return;
      }

      // Handler de modal submit
      if (interaction.isModalSubmit()) {
        const handled = await handleFormSubmit(interaction);
        if (handled) return;
      }

      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'formulario') return;

      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'criar': return handleCriar(interaction);
        case 'listar': return handleListar(interaction);
        case 'resultados': return handleResultados(interaction);
        case 'encerrar': return handleEncerrar(interaction);
      }
    });

    log.info('Módulo Formulários iniciado — handlers registrados');
  },

  async stop() {
    log.info('Módulo Formulários parado');
  },

  health() {
    const active = queryGet("SELECT COUNT(*) as count FROM forms WHERE status = 'active'");
    return {
      status: 'ok',
      activeForms: active?.count ?? 0
    };
  }
};