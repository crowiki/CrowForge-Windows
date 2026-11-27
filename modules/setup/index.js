"use strict";
const { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryGet, runSql } = require('../../packages/db');

const log = createChild('setup');

// === Definição de Canais Padrão ===
const DEFAULT_CHANNELS = [
  { name: '📢-anúncios', type: ChannelType.GuildText, topic: 'Anúncios oficiais do servidor' },
  { name: '💬-chat-geral', type: ChannelType.GuildText, topic: 'Conversa geral da comunidade' },
  { name: '🎉-sorteios', type: ChannelType.GuildText, topic: 'Sorteios e eventos da comunidade' },
  { name: '💡-sugestões', type: ChannelType.GuildText, topic: 'Envie suas sugestões para melhorar o servidor' },
  { name: '📊-logs', type: ChannelType.GuildText, topic: 'Logs de moderação e ações do bot' },
  { name: '🎫-tickets', type: ChannelType.GuildCategory, topic: null },
  { name: '🔊-voz-geral', type: ChannelType.GuildVoice, topic: null },
  { name: '🎙️-hub-temp', type: ChannelType.GuildVoice, topic: 'Entre aqui para criar sua sala temporária' }
];

// === Configurações Padrão por Módulo ===
const MODULE_DEFAULTS = {
  welcome: (channels) => ({
    channel_id: channels['💬-chat-geral']?.id || null,
    enabled: 'true'
  }),
  moderation: (channels) => ({
    logs_channel_id: channels['📊-logs']?.id || null
  }),
  levels: (channels) => ({
    levelup_channel: channels['💬-chat-geral']?.id || null,
    enabled: 'true'
  }),
  economy: () => ({
    enabled: 'true',
    currency_name: 'CrowCoins',
    currency_symbol: '🪙',
    daily_amount: '500',
    work_min: '50',
    work_max: '200',
    work_cooldown_minutes: '30',
    starting_balance: '100'
  }),
  suggestions: (channels) => ({
    default_channel: channels['💡-sugestões']?.id || null
  })
};

// === Comandos Slash ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Configuração automática do servidor — cria canais e configura módulos.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(sub =>
        sub.setName('completo')
          .setDescription('Cria todos os canais padrão e configura todos os módulos automaticamente.')
      )
      .addSubcommand(sub =>
        sub.setName('canais')
          .setDescription('Apenas cria os canais padrão do servidor.')
      )
      .addSubcommand(sub =>
        sub.setName('modulos')
          .setDescription('Apenas configura os módulos com valores padrão.')
      )
      .addSubcommand(sub =>
        sub.setName('status')
          .setDescription('Mostra o status atual da configuração do servidor.')
      ),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Lista todos os comandos disponíveis e como usar o bot.')
      .addStringOption(o =>
        o.setName('modulo')
          .setDescription('Filtrar comandos por módulo')
          .setRequired(false)
          .addChoices(
            { name: '🎫 Tickets', value: 'tickets' },
            { name: '🛡️ Moderação', value: 'moderation' },
            { name: '⭐ Níveis', value: 'levels' },
            { name: '💰 Economia', value: 'economy' },
            { name: '🎉 Sorteios', value: 'giveaways' },
            { name: '📊 Enquetes', value: 'polls' },
            { name: '💡 Sugestões', value: 'suggestions' },
            { name: '🎙️ Voz Temporária', value: 'temp-voice' },
            { name: '👋 Boas-vindas', value: 'welcome' },
            { name: '⚙️ Setup', value: 'setup' }
          )
      )
  ];
}

// === Handlers ===

async function handleSetupCompleto(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const guild = interaction.guild;
    const results = { created: [], skipped: [], configured: [] };

    // 1. Criar canais padrão
    const createdChannels = {};
    for (const chDef of DEFAULT_CHANNELS) {
      const existing = guild.channels.cache.find(c => c.name === chDef.name);
      if (existing) {
        results.skipped.push(chDef.name);
        createdChannels[chDef.name] = existing;
        continue;
      }

      try {
        const opts = {
          name: chDef.name,
          type: chDef.type,
          reason: 'CrowBot Setup Automático'
        };
        if (chDef.topic && chDef.type === ChannelType.GuildText) {
          opts.topic = chDef.topic;
        }
        const channel = await guild.channels.create(opts);
        createdChannels[chDef.name] = channel;
        results.created.push(chDef.name);
      } catch (err) {
        log.warn({ err, channelName: chDef.name }, 'Falha ao criar canal no setup');
        results.skipped.push(`${chDef.name} (erro)`);
      }
    }

    // 2. Garantir que guild existe no DB
    runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
      [guild.id, guild.name]);

    // 3. Configurar módulos com defaults
    for (const [moduleName, defaultsFn] of Object.entries(MODULE_DEFAULTS)) {
      try {
        const defaults = defaultsFn(createdChannels);
        for (const [key, value] of Object.entries(defaults)) {
          if (value !== null) {
            runSql(
              'INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)',
              [guild.id, moduleName, key, String(value)]
            );
          }
        }
        results.configured.push(moduleName);
      } catch (err) {
        log.warn({ err, moduleName }, 'Falha ao configurar módulo no setup');
      }
    }

    // 4. Habilitar módulos principais
    const modulesToEnable = ['welcome', 'moderation', 'levels', 'economy', 'tickets'];
    for (const mod of modulesToEnable) {
      try {
        runSql(
          'INSERT OR REPLACE INTO modules (guild_id, module_name, enabled) VALUES (?, ?, 1)',
          [guild.id, mod]
        );
      } catch (err) {
        log.warn({ err, mod }, 'Falha ao habilitar módulo no setup');
      }
    }

    // 5. Construir resposta
    const embed = new EmbedBuilder()
      .setTitle('✅ Setup Completo!')
      .setDescription('O servidor foi configurado automaticamente com as melhores práticas.')
      .setColor(0x22c55e)
      .addFields(
        {
          name: `📁 Canais Criados (${results.created.length})`,
          value: results.created.length > 0
            ? results.created.map(n => `• ${n}`).join('\n')
            : 'Nenhum canal novo (já existiam)',
          inline: true
        },
        {
          name: `⏭️ Já Existentes (${results.skipped.length})`,
          value: results.skipped.length > 0
            ? results.skipped.slice(0, 8).map(n => `• ${n}`).join('\n') + (results.skipped.length > 8 ? `\n...e mais ${results.skipped.length - 8}` : '')
            : 'Todos os canais foram criados',
          inline: true
        },
        {
          name: `⚙️ Módulos Configurados (${results.configured.length})`,
          value: results.configured.map(m => `• ${m}`).join('\n'),
          inline: false
        }
      )
      .setFooter({ text: 'Use /help para ver todos os comandos disponíveis' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    log.info({ guildId: guild.id, created: results.created.length, configured: results.configured.length }, 'Setup completo executado');
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro fatal no setup completo');
    await interaction.editReply({ content: `❌ Erro durante o setup: ${err?.message || 'desconhecido'}` });
  }
}

async function handleSetupCanais(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const guild = interaction.guild;
    const created = [];
    const skipped = [];

    for (const chDef of DEFAULT_CHANNELS) {
      const existing = guild.channels.cache.find(c => c.name === chDef.name);
      if (existing) {
        skipped.push(chDef.name);
        continue;
      }

      try {
        const opts = {
          name: chDef.name,
          type: chDef.type,
          reason: 'CrowBot Setup — Canais'
        };
        if (chDef.topic && chDef.type === ChannelType.GuildText) {
          opts.topic = chDef.topic;
        }
        await guild.channels.create(opts);
        created.push(chDef.name);
      } catch (err) {
        log.warn({ err, channelName: chDef.name }, 'Falha ao criar canal');
        skipped.push(`${chDef.name} (erro)`);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('📁 Canais Configurados')
      .setColor(0x5b8def)
      .addFields(
        { name: `Criados (${created.length})`, value: created.length > 0 ? created.map(n => `• ${n}`).join('\n') : 'Nenhum', inline: true },
        { name: `Já existentes (${skipped.length})`, value: skipped.length > 0 ? skipped.slice(0, 8).map(n => `• ${n}`).join('\n') : 'Todos novos', inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    log.info({ guildId: guild.id, created: created.length }, 'Setup de canais executado');
  } catch (err) {
    log.error({ err }, 'Erro no setup de canais');
    await interaction.editReply({ content: `❌ Erro: ${err?.message || 'desconhecido'}` });
  }
}

async function handleSetupModulos(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const guild = interaction.guild;

    runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
      [guild.id, guild.name]);

    const configured = [];
    // Buscar canais existentes para vincular
    const existingChannels = {};
    for (const chDef of DEFAULT_CHANNELS) {
      const ch = guild.channels.cache.find(c => c.name === chDef.name);
      if (ch) existingChannels[chDef.name] = ch;
    }

    for (const [moduleName, defaultsFn] of Object.entries(MODULE_DEFAULTS)) {
      try {
        const defaults = defaultsFn(existingChannels);
        for (const [key, value] of Object.entries(defaults)) {
          if (value !== null) {
            runSql(
              'INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)',
              [guild.id, moduleName, key, String(value)]
            );
          }
        }
        configured.push(moduleName);
      } catch (err) {
        log.warn({ err, moduleName }, 'Falha ao configurar módulo');
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('⚙️ Módulos Configurados')
      .setDescription(configured.map(m => `• **${m}** — configurado com valores padrão`).join('\n'))
      .setColor(0xf59e0b)
      .setFooter({ text: 'Use /setup completo para criar canais também' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    log.info({ guildId: guild.id, configured: configured.length }, 'Setup de módulos executado');
  } catch (err) {
    log.error({ err }, 'Erro no setup de módulos');
    await interaction.editReply({ content: `❌ Erro: ${err?.message || 'desconhecido'}` });
  }
}

async function handleSetupStatus(interaction) {
  const guild = interaction.guild;

  // Verificar canais
  const channelsFound = DEFAULT_CHANNELS.filter(chDef =>
    guild.channels.cache.find(c => c.name === chDef.name)
  );

  // Verificar módulos configurados
  const { queryAll } = require('../../packages/db');
  const moduleSettings = queryAll(
    'SELECT DISTINCT module FROM settings WHERE guild_id = ?',
    [guild.id]
  );
  const enabledModules = queryAll(
    "SELECT module_name FROM modules WHERE guild_id = ? AND enabled = 1",
    [guild.id]
  );

  const embed = new EmbedBuilder()
    .setTitle(`📊 Status do Servidor — ${guild.name}`)
    .setColor(0x5b8def)
    .addFields(
      {
        name: `📁 Canais Padrão (${channelsFound.length}/${DEFAULT_CHANNELS.length})`,
        value: channelsFound.length === DEFAULT_CHANNELS.length
          ? '✅ Todos os canais existem'
          : `${DEFAULT_CHANNELS.length - channelsFound.length} canal(is) faltando. Use \`/setup canais\``,
        inline: false
      },
      {
        name: `⚙️ Módulos Configurados (${moduleSettings.length})`,
        value: moduleSettings.length > 0
          ? moduleSettings.map(m => `• ${m.module}`).join('\n')
          : 'Nenhum módulo configurado. Use `/setup modulos`',
        inline: true
      },
      {
        name: `🟢 Módulos Ativos (${enabledModules.length})`,
        value: enabledModules.length > 0
          ? enabledModules.map(m => `• ${m.module_name}`).join('\n')
          : 'Nenhum módulo ativo',
        inline: true
      }
    )
    .setFooter({ text: 'Use /setup completo para configurar tudo automaticamente' })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// === Catálogo de Comandos para /help ===
const COMMAND_CATALOG = {
  tickets: {
    emoji: '🎫',
    label: 'Tickets',
    commands: [
      { cmd: '/configurar-tickets', desc: 'Configura categoria, equipe e logs dos tickets' },
      { cmd: '/painel-tickets', desc: 'Publica painel de abertura de tickets em um canal' },
      { cmd: '/ticket assumir', desc: 'Equipe assume o atendimento' },
      { cmd: '/ticket fechar', desc: 'Encerra o ticket atual' },
      { cmd: '/ticket adicionar', desc: 'Adiciona usuário ao ticket' },
      { cmd: '/ticket remover', desc: 'Remove usuário do ticket' },
      { cmd: '/ticket status', desc: 'Exibe detalhes do ticket' }
    ]
  },
  moderation: {
    emoji: '🛡️',
    label: 'Moderação',
    commands: [
      { cmd: '/configurar-mod', desc: 'Define canal de logs da moderação' },
      { cmd: '/moderar avisar', desc: 'Registra advertência em um membro' },
      { cmd: '/moderar avisos', desc: 'Consulta histórico de advertências' },
      { cmd: '/moderar limpar', desc: 'Apaga até 100 mensagens do canal' },
      { cmd: '/moderar timeout', desc: 'Silencia membro temporariamente' },
      { cmd: '/moderar kick', desc: 'Expulsa membro do servidor' },
      { cmd: '/moderar ban', desc: 'Bane membro do servidor' }
    ]
  },
  levels: {
    emoji: '⭐',
    label: 'Níveis & XP',
    commands: [
      { cmd: '/rank', desc: 'Ver seu nível e XP ou de outro usuário' },
      { cmd: '/leaderboard', desc: 'Ranking de níveis do servidor' },
      { cmd: '/configurar-niveis', desc: 'Configura canal de level up e mensagem' }
    ]
  },
  economy: {
    emoji: '💰',
    label: 'Economia',
    commands: [
      { cmd: '/saldo', desc: 'Verifica saldo na carteira e banco' },
      { cmd: '/daily', desc: 'Coleta recompensa diária (streak dá bônus!)' },
      { cmd: '/trabalhar', desc: 'Trabalhe para ganhar moedas' },
      { cmd: '/transferir', desc: 'Envia moedas para outro usuário' },
      { cmd: '/loja ver', desc: 'Visualiza itens da loja' },
      { cmd: '/loja comprar', desc: 'Compra item da loja' },
      { cmd: '/loja adicionar', desc: 'Adiciona item à loja (admin)' },
      { cmd: '/inventario', desc: 'Ver seus itens comprados' },
      { cmd: '/configurar-economia', desc: 'Configura moeda, daily e trabalho' }
    ]
  },
  giveaways: {
    emoji: '🎉',
    label: 'Sorteios',
    commands: [
      { cmd: '/sorteio criar', desc: 'Cria novo sorteio com prêmio e duração' },
      { cmd: '/sorteio listar', desc: 'Lista sorteios ativos e encerrados' },
      { cmd: '/sorteio encerrar', desc: 'Encerra sorteio antecipadamente' },
      { cmd: '/sorteio rerolar', desc: 'Escolhe novo vencedor' }
    ]
  },
  polls: {
    emoji: '📊',
    label: 'Enquetes',
    commands: [
      { cmd: '/enquete', desc: 'Cria enquete com múltiplas opções' }
    ]
  },
  suggestions: {
    emoji: '💡',
    label: 'Sugestões',
    commands: [
      { cmd: '/sugestao enviar', desc: 'Envia nova sugestão com votação' },
      { cmd: '/sugestao listar', desc: 'Lista sugestões por status' },
      { cmd: '/sugestao ver', desc: 'Detalhes de uma sugestão' },
      { cmd: '/sugestao status', desc: 'Altera status (admin)' }
    ]
  },
  'temp-voice': {
    emoji: '🎙️',
    label: 'Voz Temporária',
    commands: [
      { cmd: '/voz-temp configurar', desc: 'Define hub e categoria para salas temporárias' },
      { cmd: '/voz-temp desativar', desc: 'Desativa criação automática' },
      { cmd: '/voz-temp info', desc: 'Ver configuração e canais ativos' }
    ]
  },
  welcome: {
    emoji: '👋',
    label: 'Boas-vindas',
    commands: [
      { cmd: '/configurar-welcome', desc: 'Define canal e mensagem de boas-vindas' }
    ]
  },
  setup: {
    emoji: '⚙️',
    label: 'Setup & Ajuda',
    commands: [
      { cmd: '/setup completo', desc: 'Cria canais e configura tudo automaticamente' },
      { cmd: '/setup canais', desc: 'Cria apenas os canais padrão' },
      { cmd: '/setup modulos', desc: 'Configura módulos com valores padrão' },
      { cmd: '/setup status', desc: 'Ver status da configuração atual' },
      { cmd: '/help', desc: 'Este comando — lista todos os comandos' }
    ]
  }
};

async function handleHelp(interaction) {
  const filter = interaction.options.getString('modulo');

  if (filter && COMMAND_CATALOG[filter]) {
    const cat = COMMAND_CATALOG[filter];
    const lines = cat.commands.map(c => `\`${c.cmd}\` — ${c.desc}`).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`${cat.emoji} Comandos de ${cat.label}`)
      .setDescription(lines)
      .setColor(0x5b8def)
      .setFooter({ text: 'Use /help sem filtro para ver todos os módulos' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // Visão geral de todos os módulos
  const sections = Object.entries(COMMAND_CATALOG).map(([key, cat]) => {
    const cmdList = cat.commands.slice(0, 4).map(c => `\`${c.cmd}\``).join(', ');
    const more = cat.commands.length > 4 ? ` +${cat.commands.length - 4} mais` : '';
    return `**${cat.emoji} ${cat.label}**\n${cmdList}${more}`;
  }).join('\n\n');

  const embed = new EmbedBuilder()
    .setTitle('📖 Guia de Comandos — CrowBot')
    .setDescription(sections)
    .setColor(0x5b8def)
    .setFooter({ text: 'Use /help modulo:<nome> para ver detalhes de cada módulo' })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// === Contrato do Módulo ===
let context = null;

module.exports = {
  name: 'setup',
  getCommands,

  async init(ctx) {
    context = ctx;
    log.info('Módulo Setup inicializado');
  },

  async start() {
    if (!context?.bus) return;

    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;
      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === 'setup') {
        const sub = interaction.options.getSubcommand();
        switch (sub) {
          case 'completo': return handleSetupCompleto(interaction);
          case 'canais': return handleSetupCanais(interaction);
          case 'modulos': return handleSetupModulos(interaction);
          case 'status': return handleSetupStatus(interaction);
        }
      }

      if (interaction.commandName === 'help') {
        return handleHelp(interaction);
      }
    });

    log.info('Módulo Setup iniciado — handlers registrados');
  },

  async stop() {
    log.info('Módulo Setup parado');
  },

  health() {
    return { status: 'ok' };
  }
};