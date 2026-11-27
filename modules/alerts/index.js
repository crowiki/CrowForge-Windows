"use strict";
const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('alerts');

// === Schema ===
function ensureSchema() {
  runSql(`
    CREATE TABLE IF NOT EXISTS alert_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      creator_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_template TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_check TEXT,
      last_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS alert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_id INTEGER NOT NULL,
      alert_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      url TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (config_id) REFERENCES alert_configs(id)
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_alert_configs_guild ON alert_configs(guild_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_alert_configs_enabled ON alert_configs(enabled)');
  runSql('CREATE INDEX IF NOT EXISTS idx_alert_history_config ON alert_history(config_id)');
}

// === Helpers ===

function getConfigs(guildId, type) {
  if (type) {
    return queryAll(
      'SELECT * FROM alert_configs WHERE guild_id = ? AND type = ? ORDER BY created_at DESC',
      [guildId, type]
    );
  }
  return queryAll(
    'SELECT * FROM alert_configs WHERE guild_id = ? ORDER BY type, created_at DESC',
    [guildId]
  );
}

function getAllEnabledConfigs(type) {
  if (type) {
    return queryAll(
      'SELECT * FROM alert_configs WHERE enabled = 1 AND type = ?',
      [type]
    );
  }
  return queryAll('SELECT * FROM alert_configs WHERE enabled = 1');
}

function getConfig(configId) {
  return queryGet('SELECT * FROM alert_configs WHERE id = ?', [configId]);
}

function getAlertHistory(configId) {
  return queryAll(
    'SELECT * FROM alert_history WHERE config_id = ? ORDER BY sent_at DESC',
    [configId]
  );
}

function hasAlertBeenSent(configId, alertId) {
  const row = queryGet(
    'SELECT id FROM alert_history WHERE config_id = ? AND alert_id = ?',
    [configId, alertId]
  );
  return !!row;
}

function recordAlert(configId, alertId, title, url) {
  runSql(
    'INSERT INTO alert_history (config_id, alert_id, title, url) VALUES (?, ?, ?, ?)',
    [configId, alertId, title, url]
  );
}

function parseTemplate(template, vars) {
  let result = template || '';
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), () => value);
  }
  return result;
}

// === Comandos Slash ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('alerta')
      .setDescription('Gerencia alertas e notificações do servidor.')
      .addSubcommand(sub =>
        sub.setName('twitch')
          .setDescription('Configura alerta de live na Twitch.')
          .addStringOption(o => o.setName('acao').setDescription('Ação').setRequired(true).addChoices(
            { name: '➕ Adicionar', value: 'add' },
            { name: '🗑️ Remover', value: 'remove' }
          ))
          .addStringOption(o => o.setName('usuario').setDescription('Nome de usuário da Twitch').setRequired(true))
          .addChannelOption(o => o.setName('canal').setDescription('Canal para enviar o alerta'))
          .addStringOption(o => o.setName('mensagem').setDescription('Mensagem customizada (use {user}, {title}, {game}, {url})'))
      )
      .addSubcommand(sub =>
        sub.setName('youtube')
          .setDescription('Configura alerta de vídeo novo no YouTube.')
          .addStringOption(o => o.setName('acao').setDescription('Ação').setRequired(true).addChoices(
            { name: '➕ Adicionar', value: 'add' },
            { name: '🗑️ Remover', value: 'remove' }
          ))
          .addStringOption(o => o.setName('canal_id').setDescription('ID do canal do YouTube (ex: UCxxxx)').setRequired(true))
          .addChannelOption(o => o.setName('canal').setDescription('Canal para enviar o alerta'))
          .addStringOption(o => o.setName('mensagem').setDescription('Mensagem customizada (use {channel}, {title}, {url})'))
      )
      .addSubcommand(sub =>
        sub.setName('webhook')
          .setDescription('Configura alerta via webhook genérico.')
          .addStringOption(o => o.setName('acao').setDescription('Ação').setRequired(true).addChoices(
            { name: '➕ Adicionar', value: 'add' },
            { name: '🗑️ Remover', value: 'remove' }
          ))
          .addStringOption(o => o.setName('nome').setDescription('Nome do alerta (ex: deploy, status)').setRequired(true))
          .addChannelOption(o => o.setName('canal').setDescription('Canal para enviar o alerta'))
          .addStringOption(o => o.setName('mensagem').setDescription('Mensagem customizada'))
      )
      .addSubcommand(sub =>
        sub.setName('listar')
          .setDescription('Lista todos os alertas configurados.')
      )
      .addSubcommand(sub =>
        sub.setName('teste')
          .setDescription('Envia um alerta de teste para verificar configuração.')
          .addIntegerOption(o => o.setName('id').setDescription('ID do alerta').setRequired(true))
      )
  ];
}

// === Handlers ===

async function handleTwitch(interaction) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Você não tem permissão para gerenciar alertas.', flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta twitch');
    return;
  }

  try {
    const acao = interaction.options.getString('acao', true);
    const usuario = interaction.options.getString('usuario', true).toLowerCase().replace(/[^a-z0-9_]/g, '');
    const channel = interaction.options.getChannel('canal');
    const mensagem = interaction.options.getString('mensagem') || '🔴 **{user}** está ao vivo na Twitch!\n📺 {title}\n🎮 {game}\n🔗 {url}';

    if (!usuario) {
      return interaction.editReply({ content: '❌ Nome de usuário inválido.' });
    }

    if (acao === 'add') {
      if (!provider.configured('twitch')) return interaction.editReply({content:'Configure TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET na instalação antes de adicionar o alerta.'});
      const targetChannelId = channel?.id || interaction.channelId;
      if (!targetChannelId) {
        return interaction.editReply({ content: '❌ Canal não encontrado.' });
      }

      // Verificar duplicata
      const existing = queryGet(
        "SELECT id FROM alert_configs WHERE enabled=1 AND guild_id = ? AND type = 'twitch' AND source = ?",
        [interaction.guildId, usuario]
      );
      if (existing) {
        return interaction.editReply({ content: `❌ Já existe um alerta configurado para **${usuario}** na Twitch.` });
      }

      runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
        [interaction.guildId, interaction.guild?.name || 'Unknown']);

      runSql(
        'INSERT INTO alert_configs (guild_id, creator_id, type, source, channel_id, message_template) VALUES (?, ?, ?, ?, ?, ?)',
        [interaction.guildId, interaction.user.id, 'twitch', usuario, targetChannelId, mensagem]
      );

      log.info({ guildId: interaction.guildId, usuario }, 'Alerta Twitch adicionado');

      await interaction.editReply({
        content: `✅ Alerta da Twitch configurado!\n\n• **Usuário:** ${usuario}\n• **Canal:** <#${targetChannelId}>\n\nO bot verificará periodicamente se o streamer está ao vivo.`
      });
    }

    if (acao === 'remove') {
      const config = queryGet(
        "SELECT id FROM alert_configs WHERE enabled=1 AND guild_id = ? AND type = 'twitch' AND source = ?",
        [interaction.guildId, usuario]
      );
      if (!config) {
        return interaction.editReply({ content: `❌ Nenhum alerta encontrado para **${usuario}** na Twitch.` });
      }

      runSql('UPDATE alert_configs SET enabled = 0 WHERE id = ?', [config.id]);

      log.info({ guildId: interaction.guildId, usuario }, 'Alerta Twitch removido');

      await interaction.editReply({ content: `✅ Alerta da Twitch para **${usuario}** removido.` });
    }
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao gerenciar alerta Twitch');
    try {
      await interaction.editReply({ content: `❌ Erro: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleYoutube(interaction) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Você não tem permissão para gerenciar alertas.', flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta youtube');
    return;
  }

  try {
    const acao = interaction.options.getString('acao', true);
    const canalId = interaction.options.getString('canal_id', true).trim();
    const channel = interaction.options.getChannel('canal');
    const mensagem = interaction.options.getString('mensagem') || '📹 **{channel}** postou um novo vídeo!\n🎬 {title}\n🔗 {url}';

    if (!canalId || canalId.length < 10) {
      return interaction.editReply({ content: '❌ ID do canal do YouTube inválido. Deve começar com "UC" e ter pelo menos 20 caracteres.' });
    }

    if (acao === 'add') {
      if (!provider.configured('youtube')) return interaction.editReply({content:'Configure YOUTUBE_API_KEY na instalação antes de adicionar o alerta.'});
      const targetChannelId = channel?.id || interaction.channelId;
      if (!targetChannelId) {
        return interaction.editReply({ content: '❌ Canal não encontrado.' });
      }

      const existing = queryGet(
        "SELECT id FROM alert_configs WHERE enabled=1 AND guild_id = ? AND type = 'youtube' AND source = ?",
        [interaction.guildId, canalId]
      );
      if (existing) {
        return interaction.editReply({ content: `❌ Já existe um alerta configurado para este canal do YouTube.` });
      }

      runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
        [interaction.guildId, interaction.guild?.name || 'Unknown']);

      runSql(
        'INSERT INTO alert_configs (guild_id, creator_id, type, source, channel_id, message_template) VALUES (?, ?, ?, ?, ?, ?)',
        [interaction.guildId, interaction.user.id, 'youtube', canalId, targetChannelId, mensagem]
      );

      log.info({ guildId: interaction.guildId, canalId }, 'Alerta YouTube adicionado');

      await interaction.editReply({
        content: `✅ Alerta do YouTube configurado!\n\n• **Canal:** \`${canalId}\`\n• **Canal Discord:** <#${targetChannelId}>\n\nO bot verificará periodicamente novos vídeos.`
      });
    }

    if (acao === 'remove') {
      const config = queryGet(
        "SELECT id FROM alert_configs WHERE enabled=1 AND guild_id = ? AND type = 'youtube' AND source = ?",
        [interaction.guildId, canalId]
      );
      if (!config) {
        return interaction.editReply({ content: `❌ Nenhum alerta encontrado para este canal do YouTube.` });
      }

      runSql('UPDATE alert_configs SET enabled = 0 WHERE id = ?', [config.id]);

      log.info({ guildId: interaction.guildId, canalId }, 'Alerta YouTube removido');

      await interaction.editReply({ content: `✅ Alerta do YouTube removido.` });
    }
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao gerenciar alerta YouTube');
    try {
      await interaction.editReply({ content: `❌ Erro: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleWebhook(interaction) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Você não tem permissão para gerenciar alertas.', flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta webhook');
    return;
  }

  try {
    const acao = interaction.options.getString('acao', true);
    const nome = interaction.options.getString('nome', true).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const channel = interaction.options.getChannel('canal');
    const mensagem = interaction.options.getString('mensagem') || '📢 **Alerta {nome}**: {mensagem}';

    if (!nome || nome.length < 2) {
      return interaction.editReply({ content: '❌ Nome do alerta inválido (mínimo 2 caracteres).' });
    }

    if (acao === 'add') {
      const targetChannelId = channel?.id || interaction.channelId;
      if (!targetChannelId) {
        return interaction.editReply({ content: '❌ Canal não encontrado.' });
      }

      const existing = queryGet(
        "SELECT id FROM alert_configs WHERE enabled=1 AND guild_id = ? AND type = 'webhook' AND source = ?",
        [interaction.guildId, nome]
      );
      if (existing) {
        return interaction.editReply({ content: `❌ Já existe um alerta webhook chamado **${nome}**.` });
      }

      runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
        [interaction.guildId, interaction.guild?.name || 'Unknown']);

      runSql(
        'INSERT INTO alert_configs (guild_id, creator_id, type, source, channel_id, message_template) VALUES (?, ?, ?, ?, ?, ?)',
        [interaction.guildId, interaction.user.id, 'webhook', nome, targetChannelId, mensagem]
      );

      log.info({ guildId: interaction.guildId, nome }, 'Alerta webhook adicionado');

      const webhookUrl = `http://127.0.0.1:${process.env.PANEL_PORT || 3000}/api/alerts/webhook/${interaction.guildId}/${nome}`;

      await interaction.editReply({
        content: `✅ Alerta webhook **${nome}** configurado!\n\n• **Canal:** <#${targetChannelId}>\n• **URL do webhook:** \`${webhookUrl}\`\n\nEnvie POST para a URL com JSON \`{"title": "...", "message": "..."}\` para disparar o alerta.`
      });
    }

    if (acao === 'remove') {
      const config = queryGet(
        "SELECT id FROM alert_configs WHERE enabled=1 AND guild_id = ? AND type = 'webhook' AND source = ?",
        [interaction.guildId, nome]
      );
      if (!config) {
        return interaction.editReply({ content: `❌ Nenhum alerta webhook chamado **${nome}**.` });
      }

      runSql('UPDATE alert_configs SET enabled = 0 WHERE id = ?', [config.id]);

      log.info({ guildId: interaction.guildId, nome }, 'Alerta webhook removido');

      await interaction.editReply({ content: `✅ Alerta webhook **${nome}** removido.` });
    }
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao gerenciar alerta webhook');
    try {
      await interaction.editReply({ content: `❌ Erro: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleListar(interaction) {
  const configs = getConfigs(interaction.guildId);

  if (configs.length === 0) {
    return interaction.reply({
      content: '📢 Nenhum alerta configurado neste servidor. Use `/alerta twitch`, `/alerta youtube` ou `/alerta webhook` para adicionar.',
      flags: MessageFlags.Ephemeral
    });
  }

  const typeEmoji = { twitch: '🔴', youtube: '📹', webhook: '🔗' };
  const list = configs.filter(c => c.enabled === 1).map(c => {
    const emoji = typeEmoji[c.type] || '📢';
    return `\`#${c.id}\` ${emoji} **${c.type}** — ${c.source} → <#${c.channel_id}>`;
  }).join('\n') || 'Nenhum alerta ativo.';

  const embed = new EmbedBuilder()
    .setTitle('📢 Alertas Configurados')
    .setDescription(list)
    .setColor(0x9146ff)
    .setFooter({ text: `${configs.filter(c => c.enabled).length} ativo(s)` });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleTeste(interaction) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta teste');
    return;
  }

  try {
    const configId = interaction.options.getInteger('id', true);
    const config = getConfig(configId);

    if (!config || config.guild_id !== interaction.guildId) {
      return interaction.editReply({ content: '❌ Alerta não encontrado neste servidor.' });
    }

    const channel = await interaction.guild.channels.fetch(config.channel_id);
    if (!channel || typeof channel.send !== 'function') {
      return interaction.editReply({ content: '❌ Canal de destino não encontrado.' });
    }

    // Gerar mensagem de teste baseada no tipo
    let testMessage;
    if (config.type === 'twitch') {
      testMessage = parseTemplate(config.message_template, {
        user: config.source,
        title: 'Stream de Teste',
        game: 'Teste',
        url: `https://twitch.tv/${config.source}`
      });
    } else if (config.type === 'youtube') {
      testMessage = parseTemplate(config.message_template, {
        channel: 'Canal de Teste',
        title: 'Vídeo de Teste',
        url: 'https://youtube.com/watch?v=test'
      });
    } else {
      testMessage = parseTemplate(config.message_template, {
        nome: config.source,
        mensagem: 'Este é um alerta de teste.'
      });
    }

    const embed = new EmbedBuilder()
      .setDescription(testMessage)
      .setColor(0x9146ff)
      .setFooter({ text: '🧪 Alerta de teste' })
      .setTimestamp();

    await channel.send({ embeds: [embed] });

    log.info({ configId, guildId: interaction.guildId }, 'Alerta de teste enviado');

    await interaction.editReply({
      content: `✅ Alerta de teste enviado em <#${config.channel_id}>!`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao enviar alerta de teste');
    try {
      await interaction.editReply({ content: `❌ Erro: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

// === Polling de verificação (executado pelo JobScheduler) ===

const provider=require('./provider');
let timer;
let polling=false;
async function pollAlerts() {
  if (polling || !context?.client?.isReady()) return;
  polling=true;
  try {
    for (const config of getAllEnabledConfigs()) {
      if (!['youtube','twitch'].includes(config.type) || !provider.configured(config.type) ||
          !require('../state').isEnabled(config.guild_id,'alerts')) continue;
      try {
        const item=await provider.latest(config.type,config.source);
        if (!item || item.id===config.last_id || hasAlertBeenSent(config.id,item.id)) continue;
        const guild=context.client.guilds.cache.get(config.guild_id);
        const target=await guild?.channels.fetch(config.channel_id);
        if (!target?.isSendable()) continue;
        if (config.type!=='youtube' || config.last_id) {
          await target.send({content:parseTemplate(config.message_template,item).slice(0,2000),allowedMentions:{parse:[]}});
          recordAlert(config.id,item.id,item.title,item.url);
        }
        runSql("UPDATE alert_configs SET last_id=?,last_check=datetime('now') WHERE id=?",[item.id,config.id]);
      } catch (err) {log.warn({configId:config.id},'Falha ao consultar ou entregar alerta. Nova tentativa no próximo ciclo.');}
    }
  } finally {polling=false;}
}

// === Contrato do Módulo ===
let context = null;

module.exports = {
  name: 'alerts',
  getCommands,

  async init(ctx) {
    context = ctx;
    ensureSchema();

    log.info('Módulo Alertas inicializado');
  },

  async start() {
    if (!context?.bus) return;

    timer=setInterval(()=>pollAlerts().catch(()=>log.warn('Falha no ciclo de alertas')),300000);
    timer.unref();
    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'alerta') return;

      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'twitch': return handleTwitch(interaction);
        case 'youtube': return handleYoutube(interaction);
        case 'webhook': return handleWebhook(interaction);
        case 'listar': return handleListar(interaction);
        case 'teste': return handleTeste(interaction);
      }
    });

    log.info('Módulo Alertas iniciado — handlers registrados');
  },

  async stop() {
    clearInterval(timer);
    log.info('Módulo Alertas parado');
  },

  health() {
    const active = queryGet("SELECT COUNT(*) as count FROM alert_configs WHERE enabled = 1");
    return {
      status: 'ok',
      activeAlerts: active?.count ?? 0
    };
  }
};