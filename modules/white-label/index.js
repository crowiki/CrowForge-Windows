"use strict";
const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('white-label');

// === Schema ===
function ensureSchema() {
  runSql(`
    CREATE TABLE IF NOT EXISTS white_label_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL UNIQUE,
      bot_name TEXT NOT NULL DEFAULT 'CrowForge',
      bot_avatar_url TEXT,
      bot_banner_url TEXT,
      primary_color TEXT NOT NULL DEFAULT '#5b8def',
      secondary_color TEXT NOT NULL DEFAULT '#63d2a3',
      footer_text TEXT NOT NULL DEFAULT 'Powered by CrowForge',
      footer_icon TEXT,
      welcome_message TEXT,
      embed_footer TEXT,
      status_text TEXT,
      prefix TEXT NOT NULL DEFAULT '/',
      show_branding INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_white_label_guild ON white_label_config(guild_id)');
}

// === Helpers ===

function getConfig(guildId) {
  return queryGet('SELECT * FROM white_label_config WHERE guild_id = ?', [guildId]);
}

function getOrCreateConfig(guildId) {
  let config = getConfig(guildId);
  if (!config) {
    runSql(
      'INSERT INTO white_label_config (guild_id) VALUES (?)',
      [guildId]
    );
    config = getConfig(guildId);
  }
  return config;
}

function parseColor(input) {
  if (!input) return '#5b8def';
  const cleaned = String(input).replace('#', '').trim();
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) return `#${cleaned}`;
  return '#5b8def';
}

function colorToHex(colorStr) {
  const cleaned = String(colorStr).replace('#', '');
  const num = parseInt(cleaned, 16);
  return isNaN(num) ? 0x5b8def : num;
}

// === Comandos Slash ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('marca')
      .setDescription('Gerencia a personalização visual (white label) do bot.')
      .addSubcommand(sub =>
        sub.setName('configurar')
          .setDescription('Configura a marca personalizada do bot (requer permissão de gerenciamento).')
          .addStringOption(o => o.setName('nome').setDescription('Nome personalizado do bot'))
          .addStringOption(o => o.setName('avatar').setDescription('URL da imagem do avatar'))
          .addStringOption(o => o.setName('banner').setDescription('URL da imagem do banner'))
          .addStringOption(o => o.setName('cor_primaria').setDescription('Cor primária em hex (ex: #FF5733)'))
          .addStringOption(o => o.setName('cor_secundaria').setDescription('Cor secundária em hex (ex: #00FF00)'))
          .addStringOption(o => o.setName('rodape').setDescription('Texto do rodapé dos embeds'))
          .addStringOption(o => o.setName('icone_rodape').setDescription('URL do ícone do rodapé'))
          .addStringOption(o => o.setName('status').setDescription('Texto de status do bot'))
          .addStringOption(o => o.setName('prefixo').setDescription('Prefixo dos comandos'))
          .addBooleanOption(o => o.setName('mostrar_marca').setDescription('Mostrar "Powered by" no rodapé'))
      )
      .addSubcommand(sub =>
        sub.setName('info')
          .setDescription('Mostra a configuração atual da marca.')
      )
      .addSubcommand(sub =>
        sub.setName('resetar')
          .setDescription('Reseta a marca para os valores padrão.')
      )
      .addSubcommand(sub =>
        sub.setName('preview')
          .setDescription('Envia um embed de preview com a configuração atual.')
      )
  ];
}

// === Handlers ===

async function handleConfigurar(interaction) {
  // Verificar permissão
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Você não tem permissão para configurar a marca.', flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de configurar marca');
    return;
  }

  try {
    const config = getOrCreateConfig(interaction.guildId);

    const nome = interaction.options.getString('nome');
    const avatar = interaction.options.getString('avatar');
    const banner = interaction.options.getString('banner');
    const corPrimaria = interaction.options.getString('cor_primaria');
    const corSecundaria = interaction.options.getString('cor_secundaria');
    const rodape = interaction.options.getString('rodape');
    const iconeRodape = interaction.options.getString('icone_rodape');
    const status = interaction.options.getString('status');
    const prefixo = interaction.options.getString('prefixo');
    const mostrarMarca = interaction.options.getBoolean('mostrar_marca');

    // Construir query de update dinamicamente
    const updates = [];
    const values = [];

    if (nome !== null) { updates.push('bot_name = ?'); values.push(nome.substring(0, 100)); }
    if (avatar !== null) { updates.push('bot_avatar_url = ?'); values.push(avatar); }
    if (banner !== null) { updates.push('bot_banner_url = ?'); values.push(banner); }
    if (corPrimaria !== null) { updates.push('primary_color = ?'); values.push(parseColor(corPrimaria)); }
    if (corSecundaria !== null) { updates.push('secondary_color = ?'); values.push(parseColor(corSecundaria)); }
    if (rodape !== null) { updates.push('footer_text = ?'); values.push(rodape.substring(0, 200)); }
    if (iconeRodape !== null) { updates.push('footer_icon = ?'); values.push(iconeRodape); }
    if (status !== null) { updates.push('status_text = ?'); values.push(status.substring(0, 100)); }
    if (prefixo !== null) { updates.push('prefix = ?'); values.push(prefixo.substring(0, 10)); }
    if (mostrarMarca !== null) { updates.push('show_branding = ?'); values.push(mostrarMarca ? 1 : 0); }

    if (updates.length === 0) {
      return interaction.editReply({ content: '❌ Nenhum campo para atualizar. Informe pelo menos uma opção.' });
    }

    updates.push("updated_at = datetime('now')");
    values.push(interaction.guildId);

    runSql(
      `UPDATE white_label_config SET ${updates.join(', ')} WHERE guild_id = ?`,
      values
    );

    log.info({ guildId: interaction.guildId, fields: updates.length }, 'Marca personalizada atualizada');

    // Aplicar mudanças ao bot se possível
    let nicknameFeedback = '';

    if (nome && interaction.guild?.members.me) {
      try { await interaction.guild.members.me.setNickname(nome); }
      catch (err) { nicknameFeedback = ' O Discord recusou a alteração do apelido.'; log.warn({code:err.code},'Apelido do servidor indisponível'); }
    }


    await interaction.editReply({
      content: `✅ Marca personalizada atualizada com sucesso!\n\n` +
        `Configuração de marca salva para este servidor.${nicknameFeedback}\n` +
        `Use \`/marca preview\` para visualizar como ficará.`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao configurar marca');
    try {
      await interaction.editReply({ content: `❌ Erro: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleInfo(interaction) {
  const config = getOrCreateConfig(interaction.guildId);

  const embed = new EmbedBuilder()
    .setTitle('🏷️ Configuração da Marca')
    .setColor(colorToHex(config.primary_color))
    .addFields(
      { name: 'Nome do Bot', value: config.bot_name, inline: true },
      { name: 'Cor Primária', value: `\`${config.primary_color}\``, inline: true },
      { name: 'Cor Secundária', value: `\`${config.secondary_color}\``, inline: true },
      { name: 'Rodapé', value: config.footer_text || '*(padrão)*', inline: false },
      { name: 'Texto de Status', value: config.status_text || '*(padrão)*', inline: true },
      { name: 'Prefixo', value: `\`${config.prefix}\``, inline: true },
      { name: 'Mostrar Marca', value: config.show_branding ? '✅ Sim' : '❌ Não', inline: true }
    )
    .setFooter({ text: `Configurado para ${interaction.guild?.name || 'servidor'}` })
    .setTimestamp();

  if (config.bot_avatar_url) {
    embed.setThumbnail(config.bot_avatar_url);
  }
  if (config.bot_banner_url) {
    embed.setImage(config.bot_banner_url);
  }

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleResetar(interaction) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de resetar');
    return;
  }

  try {
    runSql('DELETE FROM white_label_config WHERE guild_id = ?', [interaction.guildId]);

    log.info({ guildId: interaction.guildId }, 'Marca resetada para padrão');

    await interaction.editReply({
      content: '✅ Marca resetada para os valores padrão. Use `/marca configurar` para personalizar novamente.'
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao resetar marca');
    try {
      await interaction.editReply({ content: `❌ Erro: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handlePreview(interaction) {
  try {
    await interaction.deferReply();
  } catch (err) {
    log.error({ err }, 'Falha ao deferir preview');
    return;
  }

  try {
    const config = getOrCreateConfig(interaction.guildId);

    const footerText = config.show_branding
      ? `${config.footer_text} • Powered by CrowForge`
      : config.footer_text;

    const embed = new EmbedBuilder()
      .setTitle(`📢 ${config.bot_name} — Exemplo de Anúncio`)
      .setDescription('Este é um exemplo de como os embeds do bot aparecerão com sua marca personalizada.\n\nTodas as mensagens, respostas e notificações usarão esta configuração.')
      .setColor(colorToHex(config.primary_color))
      .addFields(
        { name: '📊 Estatísticas', value: 'Exemplo de campo inline', inline: true },
        { name: '🎯 Ação', value: 'Outro campo inline', inline: true },
        { name: '📝 Descrição longa', value: 'Este campo demonstra como textos mais longos aparecem nos embeds do bot.', inline: false }
      );

    if (config.bot_avatar_url) {
      embed.setThumbnail(config.bot_avatar_url);
    }
    if (config.bot_banner_url) {
      embed.setImage(config.bot_banner_url);
    }

    embed.setFooter({
      text: footerText,
      iconURL: config.footer_icon || undefined
    });
    embed.setTimestamp();

    await interaction.editReply({
      content: `**Preview da marca personalizada:**`,
      embeds: [embed]
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao gerar preview');
    try {
      await interaction.editReply({ content: `❌ Erro: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

// === API pública para outros módulos usarem a marca ===

function getBranding(guildId) {
  const config = getConfig(guildId);
  if (!config) {
    return {
      name: 'CrowForge',
      primaryColor: 0x5b8def,
      secondaryColor: 0x63d2a3,
      footerText: 'Powered by CrowForge',
      footerIcon: null,
      showBranding: true,
      prefix: '/'
    };
  }

  return {
    name: config.bot_name,
    primaryColor: colorToHex(config.primary_color),
    secondaryColor: colorToHex(config.secondary_color),
    footerText: config.show_branding
      ? `${config.footer_text} • Powered by CrowForge`
      : config.footer_text,
    footerIcon: config.footer_icon,
    avatarUrl: config.bot_avatar_url,
    bannerUrl: config.bot_banner_url,
    showBranding: config.show_branding === 1,
    prefix: config.prefix
  };
}

function createBrandedEmbed(guildId, options = {}) {
  const branding = getBranding(guildId);

  const embed = new EmbedBuilder()
    .setColor(options.color || branding.primaryColor);

  if (options.title) embed.setTitle(options.title);
  if (options.description) embed.setDescription(options.description);
  if (options.fields) embed.addFields(options.fields);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.image) embed.setImage(options.image);
  if (options.author) embed.setAuthor(options.author);
  if (options.url) embed.setURL(options.url);
  if (options.timestamp !== false) embed.setTimestamp(options.timestamp || new Date());

  embed.setFooter({
    text: options.footer || branding.footerText,
    iconURL: options.footerIcon || branding.footerIcon
  });

  return embed;
}

// === Contrato do Módulo ===
let context = null;

module.exports = {
  name: 'white-label',
  getCommands,

  // API pública
  getBranding,
  createBrandedEmbed,

  async init(ctx) {
    context = ctx;
    ensureSchema();
    log.info('Módulo White Label inicializado');
  },

  async start() {
    if (!context?.bus) return;

    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'marca') return;

      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'configurar': return handleConfigurar(interaction);
        case 'info': return handleInfo(interaction);
        case 'resetar': return handleResetar(interaction);
        case 'preview': return handlePreview(interaction);
      }
    });

    log.info('Módulo White Label iniciado — handlers registrados');
  },

  async stop() {
    log.info('Módulo White Label parado');
  },

  health() {
    const count = queryGet("SELECT COUNT(*) as count FROM white_label_config");
    return {
      status: 'ok',
      configuredGuilds: count?.count ?? 0
    };
  }
};