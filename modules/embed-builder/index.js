"use strict";
const { EmbedBuilder, MessageFlags, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('embed-builder');

// === Schema ===
function ensureSchema() {
  runSql('DROP TABLE IF EXISTS embed_templates');

  runSql(`
    CREATE TABLE IF NOT EXISTS embed_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      creator_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_embed_templates_guild ON embed_templates(guild_id)');
}

// === Helpers ===

function getTemplate(id) {
  return queryGet('SELECT * FROM embed_templates WHERE id = ?', [id]);
}

function getGuildTemplates(guildId) {
  return queryAll(
    'SELECT * FROM embed_templates WHERE guild_id = ? ORDER BY name ASC',
    [guildId]
  );
}

function parseColor(input) {
  if (!input) return 0x5b8def;
  const cleaned = String(input).replace('#', '');
  const num = parseInt(cleaned, 16);
  return isNaN(num) ? 0x5b8def : num;
}

// === Comandos Slash ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('embed')
      .setDescription('Construtor de embeds customizados.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(sub =>
        sub.setName('criar')
          .setDescription('Cria e envia um embed customizado.')
          .addStringOption(o => o.setName('titulo').setDescription('Título do embed').setRequired(true))
          .addStringOption(o => o.setName('descricao').setDescription('Descrição do embed').setRequired(true))
          .addStringOption(o => o.setName('cor').setDescription('Cor em hex (ex: #FF5733)'))
          .addStringOption(o => o.setName('imagem').setDescription('URL de imagem'))
          .addStringOption(o => o.setName('thumbnail').setDescription('URL do thumbnail'))
          .addStringOption(o => o.setName('footer').setDescription('Texto do rodapé'))
          .addChannelOption(o => o.setName('canal').setDescription('Canal para enviar o embed'))
          .addStringOption(o =>
            o.setName('campos')
              .setDescription('Campos no formato: nome1|valor1|inline,nome2|valor2|inline')
          )
      )
      .addSubcommand(sub =>
        sub.setName('template')
          .setDescription('Envia um embed usando um template pré-pronto.')
          .addStringOption(o =>
            o.setName('tipo')
              .setDescription('Tipo de template')
              .setRequired(true)
              .addChoices(
                { name: '📢 Anúncio', value: 'announcement' },
                { name: '📜 Regras', value: 'rules' },
                { name: '👋 Boas-vindas', value: 'welcome' },
                { name: '🎉 Evento', value: 'event' },
                { name: '⚠️ Alerta', value: 'alert' }
              )
          )
          .addStringOption(o => o.setName('titulo').setDescription('Título personalizado'))
          .addStringOption(o => o.setName('conteudo').setDescription('Conteúdo principal'))
          .addChannelOption(o => o.setName('canal').setDescription('Canal para enviar'))
      )
      .addSubcommand(sub =>
        sub.setName('salvar')
          .setDescription('Salva um embed como template para uso futuro.')
          .addStringOption(o => o.setName('nome').setDescription('Nome do template').setRequired(true))
          .addStringOption(o => o.setName('titulo').setDescription('Título do embed').setRequired(true))
          .addStringOption(o => o.setName('descricao').setDescription('Descrição do embed').setRequired(true))
          .addStringOption(o => o.setName('cor').setDescription('Cor em hex'))
      )
      .addSubcommand(sub =>
        sub.setName('templates')
          .setDescription('Lista templates salvos no servidor.')
      )
  ];
}

// === Templates pré-prontos ===

const TEMPLATES = {
  announcement: {
    color: 0xf59e0b,
    emoji: '📢',
    defaultTitle: 'Anúncio',
    defaultDesc: 'Conteúdo do anúncio aqui.',
    fields: [
      { name: '📅 Data', value: new Date().toLocaleDateString('pt-BR'), inline: true },
      { name: '👤 Por', value: '{user}', inline: true }
    ]
  },
  rules: {
    color: 0xef4444,
    emoji: '📜',
    defaultTitle: 'Regras do Servidor',
    defaultDesc: 'Leia e respeite as regras abaixo.',
    fields: [
      { name: '1️⃣ Respeito', value: 'Trate todos com respeito. Sem toxicidade ou discriminação.', inline: false },
      { name: '2️⃣ Spam', value: 'Não faça spam, flood ou autopromoção sem permissão.', inline: false },
      { name: '3️⃣ Canais', value: 'Use cada canal para seu propósito.', inline: false },
      { name: '4️⃣ NSFW', value: 'Conteúdo +18 apenas nos canais designados.', inline: false },
      { name: '5️⃣ Staff', value: 'Respeite as decisões da equipe.', inline: false }
    ]
  },
  welcome: {
    color: 0x63d2a3,
    emoji: '👋',
    defaultTitle: 'Bem-vindo(a)!',
    defaultDesc: 'Obrigado por entrar no servidor! Leia as regras e divirta-se.',
    fields: [
      { name: '📋 Próximos passos', value: '• Leia as regras\n• Pegue seus cargos\n• Apresente-se', inline: false }
    ]
  },
  event: {
    color: 0x8b5cf6,
    emoji: '🎉',
    defaultTitle: 'Evento',
    defaultDesc: 'Detalhes do evento aqui.',
    fields: [
      { name: '📅 Data', value: 'A definir', inline: true },
      { name: '⏰ Horário', value: 'A definir', inline: true },
      { name: '📍 Local', value: 'A definir', inline: true }
    ]
  },
  alert: {
    color: 0xf97316,
    emoji: '⚠️',
    defaultTitle: 'Alerta',
    defaultDesc: 'Atenção! Informação importante.',
    fields: []
  }
};

// === Handlers ===

async function handleCriar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta do embed');
    return;
  }

  try {
    const title = interaction.options.getString('titulo', true);
    const description = interaction.options.getString('descricao', true);
    const colorStr = interaction.options.getString('cor');
    const image = interaction.options.getString('imagem');
    const thumbnail = interaction.options.getString('thumbnail');
    const footer = interaction.options.getString('footer');
    const fieldsStr = interaction.options.getString('campos');

    let targetChannelId;
    const channelOption = interaction.options.getChannel('canal');
    if (channelOption) {
      targetChannelId = channelOption.id;
    } else if (interaction.channelId) {
      targetChannelId = interaction.channelId;
    }

    if (!targetChannelId) {
      return interaction.editReply({ content: '❌ Canal não encontrado.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(parseColor(colorStr));

    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (footer) embed.setFooter({ text: footer });
    embed.setTimestamp();

    // Parsear campos customizados: nome|valor|inline,nome2|valor2|inline
    if (fieldsStr) {
      const fieldPairs = fieldsStr.split(',');
      for (const pair of fieldPairs) {
        const parts = pair.split('|').map(s => s.trim());
        if (parts.length >= 2) {
          embed.addFields({
            name: parts[0],
            value: parts[1],
            inline: parts[2] === 'true' || parts[2] === '1' || parts[2] === 'inline'
          });
        }
      }
    }

    let targetChannel;
    try {
      targetChannel = await interaction.guild.channels.fetch(targetChannelId);
    } catch {
      return interaction.editReply({ content: '❌ Não foi possível acessar o canal.' });
    }

    if (!targetChannel || typeof targetChannel.send !== 'function') {
      return interaction.editReply({ content: '❌ Canal inválido.' });
    }

    await targetChannel.send({ embeds: [embed] });

    log.info({ guildId: interaction.guildId, title }, 'Embed customizado enviado');

    await interaction.editReply({
      content: `✅ Embed enviado com sucesso em <#${targetChannelId}>!`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao criar embed');
    try {
      await interaction.editReply({ content: `❌ Erro ao criar embed: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleTemplate(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta do template');
    return;
  }

  try {
    const tipo = interaction.options.getString('tipo', true);
    const customTitle = interaction.options.getString('titulo');
    const customContent = interaction.options.getString('conteudo');

    let targetChannelId;
    const channelOption = interaction.options.getChannel('canal');
    if (channelOption) {
      targetChannelId = channelOption.id;
    } else if (interaction.channelId) {
      targetChannelId = interaction.channelId;
    }

    if (!targetChannelId) {
      return interaction.editReply({ content: '❌ Canal não encontrado.' });
    }

    const tmpl = TEMPLATES[tipo];
    if (!tmpl) {
      return interaction.editReply({ content: '❌ Template não encontrado.' });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${tmpl.emoji} ${customTitle || tmpl.defaultTitle}`)
      .setDescription(customContent || tmpl.defaultDesc)
      .setColor(tmpl.color)
      .setTimestamp();

    // Adicionar campos do template
    if (tmpl.fields && tmpl.fields.length > 0) {
      const fields = tmpl.fields.map(f => ({
        ...f,
        value: f.value.replace('{user}', `<@${interaction.user.id}>`)
      }));
      embed.addFields(fields);
    }

    embed.setFooter({ text: `Enviado por ${interaction.user.displayName}` });

    let targetChannel;
    try {
      targetChannel = await interaction.guild.channels.fetch(targetChannelId);
    } catch {
      return interaction.editReply({ content: '❌ Não foi possível acessar o canal.' });
    }

    if (!targetChannel || typeof targetChannel.send !== 'function') {
      return interaction.editReply({ content: '❌ Canal inválido.' });
    }

    await targetChannel.send({ embeds: [embed] });

    log.info({ guildId: interaction.guildId, tipo }, 'Embed de template enviado');

    await interaction.editReply({
      content: `✅ Template **${tipo}** enviado com sucesso em <#${targetChannelId}>!`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao enviar template');
    try {
      await interaction.editReply({ content: `❌ Erro ao enviar template: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleSalvar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de salvar template');
    return;
  }

  try {
    const name = interaction.options.getString('nome', true);
    const title = interaction.options.getString('titulo', true);
    const description = interaction.options.getString('descricao', true);
    const colorStr = interaction.options.getString('cor');

    const data = JSON.stringify({
      title,
      description,
      color: colorStr || '#5b8def'
    });

    runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
      [interaction.guildId, interaction.guild?.name || 'Unknown']);

    runSql(
      'INSERT INTO embed_templates (guild_id, creator_id, name, data) VALUES (?, ?, ?, ?)',
      [interaction.guildId, interaction.user.id, name, data]
    );

    log.info({ guildId: interaction.guildId, name }, 'Template salvo');

    await interaction.editReply({
      content: `✅ Template **${name}** salvo com sucesso! Use \`/embed templates\` para ver todos.`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao salvar template');
    try {
      await interaction.editReply({ content: `❌ Erro ao salvar template: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleListarTemplates(interaction) {
  const templates = getGuildTemplates(interaction.guildId);

  if (templates.length === 0) {
    return interaction.reply({
      content: '📋 Nenhum template salvo neste servidor. Use `/embed salvar` para criar um.',
      flags: MessageFlags.Ephemeral
    });
  }

  const list = templates.map(t => {
    const data = JSON.parse(t.data);
    return `\`#${t.id}\` **${t.name}** — ${data.title}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('📋 Templates Salvos')
    .setDescription(list)
    .setColor(0x5b8def);

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// === Contrato do Módulo ===
let context = null;

module.exports = {
  name: 'embed-builder',
  getCommands,

  async init(ctx) {
    context = ctx;
    ensureSchema();
    log.info('Módulo Embed Builder inicializado');
  },

  async start() {
    if (!context?.bus) return;

    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'embed') return;

      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'criar': return handleCriar(interaction);
        case 'template': return handleTemplate(interaction);
        case 'salvar': return handleSalvar(interaction);
        case 'templates': return handleListarTemplates(interaction);
      }
    });

    log.info('Módulo Embed Builder iniciado — handlers registrados');
  },

  async stop() {
    log.info('Módulo Embed Builder parado');
  },

  health() {
    const count = queryGet("SELECT COUNT(*) as count FROM embed_templates");
    return {
      status: 'ok',
      savedTemplates: count?.count ?? 0
    };
  }
};