"use strict";
const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('economy');

const DEFAULT_SETTINGS = {
  enabled: 'true',
  currency_name: 'CrowCoins',
  currency_symbol: '🪙',
  daily_amount: 500,
  work_min: 50,
  work_max: 200,
  work_cooldown_minutes: 30,
  starting_balance: 100
};

function getGuildSetting(guildId, key) {
  const row = queryGet(
    "SELECT value FROM settings WHERE guild_id = ? AND module = 'economy' AND key = ?",
    [guildId, key]
  );
  return row?.value ?? DEFAULT_SETTINGS[key];
}

function getSettings(guildId) {
  return {
    enabled: getGuildSetting(guildId, 'enabled') === 'true',
    currency_name: getGuildSetting(guildId, 'currency_name'),
    currency_symbol: getGuildSetting(guildId, 'currency_symbol'),
    daily_amount: Number(getGuildSetting(guildId, 'daily_amount')),
    work_min: Number(getGuildSetting(guildId, 'work_min')),
    work_max: Number(getGuildSetting(guildId, 'work_max')),
    work_cooldown_minutes: Number(getGuildSetting(guildId, 'work_cooldown_minutes')),
    starting_balance: Number(getGuildSetting(guildId, 'starting_balance'))
  };
}

function ensureSchema() {
  runSql(`
    CREATE TABLE IF NOT EXISTS economy_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0,
      bank INTEGER NOT NULL DEFAULT 0,
      last_daily TEXT,
      daily_streak INTEGER NOT NULL DEFAULT 0,
      last_work TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(guild_id, user_id)
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS economy_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      from_user TEXT,
      to_user TEXT,
      amount INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS economy_shop (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      item_description TEXT,
      price INTEGER NOT NULL,
      role_reward_id TEXT,
      stock INTEGER DEFAULT -1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS economy_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES economy_shop(id)
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_economy_wallets ON economy_wallets(guild_id, user_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_economy_transactions ON economy_transactions(guild_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_economy_shop ON economy_shop(guild_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_economy_inventory ON economy_inventory(guild_id, user_id)');
}

function getOrCreateWallet(guildId, userId, startingBalance = 0) {
  let wallet = queryGet(
    'SELECT * FROM economy_wallets WHERE guild_id = ? AND user_id = ?',
    [guildId, userId]
  );

  if (!wallet) {
    runSql(
      'INSERT INTO economy_wallets (guild_id, user_id, balance) VALUES (?, ?, ?)',
      [guildId, userId, startingBalance]
    );
    wallet = queryGet(
      'SELECT * FROM economy_wallets WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );
  }

  return wallet;
}

function addBalance(guildId, userId, amount, type, description = null) {
  const wallet = getOrCreateWallet(guildId, userId);
  const newBalance = wallet.balance + amount;

  runSql(
    'UPDATE economy_wallets SET balance = ? WHERE guild_id = ? AND user_id = ?',
    [newBalance, guildId, userId]
  );

  runSql(
    'INSERT INTO economy_transactions (guild_id, to_user, amount, type, description) VALUES (?, ?, ?, ?, ?)',
    [guildId, userId, amount, type, description]
  );

  return newBalance;
}

function removeBalance(guildId, userId, amount, type, description = null) {
  const wallet = getOrCreateWallet(guildId, userId);

  if (wallet.balance < amount) {
    return { success: false, reason: 'Saldo insuficiente', balance: wallet.balance };
  }

  const newBalance = wallet.balance - amount;

  runSql(
    'UPDATE economy_wallets SET balance = ? WHERE guild_id = ? AND user_id = ?',
    [newBalance, guildId, userId]
  );

  runSql(
    'INSERT INTO economy_transactions (guild_id, from_user, amount, type, description) VALUES (?, ?, ?, ?, ?)',
    [guildId, userId, amount, type, description]
  );

  return { success: true, balance: newBalance };
}

// === Comandos Slash ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('saldo')
      .setDescription('Verifica seu saldo ou o de outro usuário.')
      .addUserOption(o => o.setName('usuario').setDescription('Usuário para verificar o saldo')),

    new SlashCommandBuilder()
      .setName('daily')
      .setDescription('Recompensa diária de moedas.'),

    new SlashCommandBuilder()
      .setName('trabalhar')
      .setDescription('Trabalhe para ganhar moedas.'),

    new SlashCommandBuilder()
      .setName('transferir')
      .setDescription('Transfere moedas para outro usuário.')
      .addUserOption(o => o.setName('usuario').setDescription('Usuário destinatário').setRequired(true))
      .addIntegerOption(o => o.setName('quantia').setDescription('Quantia a transferir').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
      .setName('loja')
      .setDescription('Gerencia a loja do servidor.')
      .addSubcommand(sub =>
        sub.setName('ver')
          .setDescription('Visualiza os itens da loja.')
      )
      .addSubcommand(sub =>
        sub.setName('comprar')
          .setDescription('Compra um item da loja.')
          .addIntegerOption(o => o.setName('item').setDescription('ID do item').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('adicionar')
          .setDescription('Adiciona um item à loja (requer permissão de gerenciamento).')
          .addStringOption(o => o.setName('nome').setDescription('Nome do item').setRequired(true))
          .addIntegerOption(o => o.setName('preco').setDescription('Preço do item').setMinValue(1).setRequired(true))
          .addStringOption(o => o.setName('descricao').setDescription('Descrição do item'))
          .addRoleOption(o => o.setName('cargo').setDescription('Cargo dado ao comprar'))
          .addIntegerOption(o => o.setName('estoque').setDescription('Estoque (-1 = ilimitado)').setMinValue(-1))
      ),

    new SlashCommandBuilder()
      .setName('inventario')
      .setDescription('Visualiza seu inventário.'),

    new SlashCommandBuilder()
      .setName('configurar-economia')
      .setDescription('Configura o sistema de economia.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addBooleanOption(o => o.setName('habilitado').setDescription('Ativar ou desativar economia').setRequired(true))
      .addStringOption(o => o.setName('moeda').setDescription('Nome da moeda'))
      .addStringOption(o => o.setName('simbolo').setDescription('Símbolo da moeda'))
      .addIntegerOption(o => o.setName('daily').setDescription('Valor do daily').setMinValue(1))
      .addIntegerOption(o => o.setName('trabalho-min').setDescription('Valor mínimo do trabalho').setMinValue(1))
      .addIntegerOption(o => o.setName('trabalho-max').setDescription('Valor máximo do trabalho').setMinValue(1))
      .addIntegerOption(o => o.setName('cooldown-trabalho').setDescription('Cooldown do trabalho em minutos').setMinValue(1))
  ];
}

// === Handlers ===

async function handleSaldo(interaction) {
  const settings = getSettings(interaction.guildId);
  if (!settings.enabled) {
    return interaction.reply({ content: '❌ Economia não está ativa neste servidor.', flags: MessageFlags.Ephemeral });
  }

  const targetUser = interaction.options.getUser('usuario') || interaction.user;
  const wallet = getOrCreateWallet(interaction.guildId, targetUser.id, settings.starting_balance);

  const embed = new EmbedBuilder()
    .setTitle(`${settings.currency_symbol} Saldo de ${targetUser.displayName}`)
    .setDescription(`**Carteira:** ${wallet.balance.toLocaleString()} ${settings.currency_name}\n**Banco:** ${wallet.bank.toLocaleString()} ${settings.currency_name}\n**Total:** ${(wallet.balance + wallet.bank).toLocaleString()} ${settings.currency_name}`)
    .setColor(0x63d2a3)
    .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleDaily(interaction) {
  const settings = getSettings(interaction.guildId);
  if (!settings.enabled) {
    return interaction.reply({ content: '❌ Economia não está ativa neste servidor.', flags: MessageFlags.Ephemeral });
  }

  const wallet = getOrCreateWallet(interaction.guildId, interaction.user.id, settings.starting_balance);
  const now = new Date();
  const lastDaily = wallet.last_daily ? new Date(wallet.last_daily) : null;

  if (lastDaily) {
    const hoursSince = (now - lastDaily) / (1000 * 60 * 60);
    if (hoursSince < 24) {
      const hoursLeft = Math.ceil(24 - hoursSince);
      return interaction.reply({
        content: `⏰ Você já coletou seu daily hoje! Próximo disponível em **${hoursLeft}h**.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  // Calcular streak
  let streak = wallet.daily_streak || 0;
  if (lastDaily) {
    const daysSince = Math.floor((now - lastDaily) / (1000 * 60 * 60 * 24));
    if (daysSince <= 2) {
      streak += 1;
    } else {
      streak = 1; // Reset streak se passou mais de 2 dias
    }
  } else {
    streak = 1;
  }

  // Bônus por streak (max 7x)
  const streakMultiplier = Math.min(streak, 7);
  const reward = settings.daily_amount * streakMultiplier;

  runSql(
    "UPDATE economy_wallets SET balance = balance + ?, last_daily = datetime('now'), daily_streak = ? WHERE guild_id = ? AND user_id = ?",
    [reward, streak, interaction.guildId, interaction.user.id]
  );

  runSql(
    'INSERT INTO economy_transactions (guild_id, to_user, amount, type, description) VALUES (?, ?, ?, ?, ?)',
    [interaction.guildId, interaction.user.id, reward, 'daily', `Streak: ${streak}x`]
  );

  const embed = new EmbedBuilder()
    .setTitle(`${settings.currency_symbol} Daily Coletado!`)
    .setDescription(`Você recebeu **${reward.toLocaleString()} ${settings.currency_name}**!\n🔥 Streak: **${streak}x** (bônus: ${streakMultiplier}x)\n\nVolte amanhã para manter sua streak!`)
    .setColor(0x63d2a3)
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleTrabalhar(interaction) {
  const settings = getSettings(interaction.guildId);
  if (!settings.enabled) {
    return interaction.reply({ content: '❌ Economia não está ativa neste servidor.', flags: MessageFlags.Ephemeral });
  }

  const wallet = getOrCreateWallet(interaction.guildId, interaction.user.id, settings.starting_balance);
  const now = new Date();
  const lastWork = wallet.last_work ? new Date(wallet.last_work) : null;

  if (lastWork) {
    const minutesSince = (now - lastWork) / (1000 * 60);
    if (minutesSince < settings.work_cooldown_minutes) {
      const minutesLeft = Math.ceil(settings.work_cooldown_minutes - minutesSince);
      return interaction.reply({
        content: `⏰ Você precisa descansar! Trabalhe novamente em **${minutesLeft} minutos**.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  const earnings = Math.floor(Math.random() * (settings.work_max - settings.work_min + 1)) + settings.work_min;

  runSql(
    "UPDATE economy_wallets SET balance = balance + ?, last_work = datetime('now') WHERE guild_id = ? AND user_id = ?",
    [earnings, interaction.guildId, interaction.user.id]
  );

  runSql(
    'INSERT INTO economy_transactions (guild_id, to_user, amount, type, description) VALUES (?, ?, ?, ?, ?)',
    [interaction.guildId, interaction.user.id, earnings, 'work', 'Trabalho']
  );

  const jobs = [
    'Programador', 'Designer', 'Moderador', 'Streamer', 'Chef',
    'Médico', 'Professor', 'Artista', 'Engenheiro', 'Músico'
  ];
  const job = jobs[Math.floor(Math.random() * jobs.length)];

  const embed = new EmbedBuilder()
    .setTitle(`💼 Trabalho Concluído!`)
    .setDescription(`Você trabalhou como **${job}** e ganhou **${earnings.toLocaleString()} ${settings.currency_name}**!`)
    .setColor(0x63d2a3)
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleTransferir(interaction) {
  const settings = getSettings(interaction.guildId);
  if (!settings.enabled) {
    return interaction.reply({ content: '❌ Economia não está ativa neste servidor.', flags: MessageFlags.Ephemeral });
  }

  const targetUser = interaction.options.getUser('usuario', true);
  const amount = interaction.options.getInteger('quantia', true);

  if (targetUser.id === interaction.user.id) {
    return interaction.reply({ content: '❌ Você não pode transferir para si mesmo.', flags: MessageFlags.Ephemeral });
  }

  if (targetUser.bot) {
    return interaction.reply({ content: '❌ Não é possível transferir para bots.', flags: MessageFlags.Ephemeral });
  }

  const result = removeBalance(interaction.guildId, interaction.user.id, amount, 'transfer_out', `Transferência para ${targetUser.id}`);

  if (!result.success) {
    return interaction.reply({
      content: `❌ ${result.reason}. Seu saldo: **${result.balance.toLocaleString()} ${settings.currency_name}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  addBalance(interaction.guildId, targetUser.id, amount, 'transfer_in', `Transferência de ${interaction.user.id}`);

  const embed = new EmbedBuilder()
    .setTitle(`${settings.currency_symbol} Transferência Realizada!`)
    .setDescription(`Você enviou **${amount.toLocaleString()} ${settings.currency_name}** para ${targetUser}!\nSeu novo saldo: **${result.balance.toLocaleString()} ${settings.currency_name}**`)
    .setColor(0x63d2a3)
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleLoja(interaction) {
  const settings = getSettings(interaction.guildId);
  if (!settings.enabled) {
    return interaction.reply({ content: '❌ Economia não está ativa neste servidor.', flags: MessageFlags.Ephemeral });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'ver') {
    const items = queryAll('SELECT * FROM economy_shop WHERE guild_id = ? ORDER BY price ASC', [interaction.guildId]);

    if (items.length === 0) {
      return interaction.reply({ content: '🏪 A loja está vazia. Um administrador precisa adicionar itens.', flags: MessageFlags.Ephemeral });
    }

    const itemList = items.map(item => {
      const stockText = item.stock === -1 ? '∞' : item.stock;
      const roleText = item.role_reward_id ? ` → <@&${item.role_reward_id}>` : '';
      return `\`${item.id}\`. **${item.item_name}** — ${item.price.toLocaleString()} ${settings.currency_symbol} (Estoque: ${stockText})${roleText}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`🏪 Loja do Servidor`)
      .setDescription(itemList)
      .setColor(0x63d2a3)
      .setFooter({ text: 'Use /loja comprar item:<ID> para comprar' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === 'comprar') {
    const itemId = interaction.options.getInteger('item', true);
    const item = queryGet('SELECT * FROM economy_shop WHERE id = ? AND guild_id = ?', [itemId, interaction.guildId]);

    if (!item) {
      return interaction.reply({ content: '❌ Item não encontrado na loja.', flags: MessageFlags.Ephemeral });
    }

    if (item.stock === 0) {
      return interaction.reply({ content: '❌ Este item está esgotado.', flags: MessageFlags.Ephemeral });
    }

    if (item.role_reward_id && !require('../../packages/core/role-policy').assignable(interaction.guild.roles.cache.get(item.role_reward_id))) {
      return interaction.reply({content:'O cargo deste item está indisponível. Nenhuma moeda foi debitada.',flags:MessageFlags.Ephemeral});
    }
    const result = removeBalance(interaction.guildId, interaction.user.id, item.price, 'purchase', `Compra: ${item.item_name}`);

    if (!result.success) {
      return interaction.reply({
        content: `❌ ${result.reason}. Preço: **${item.price.toLocaleString()} ${settings.currency_name}**. Seu saldo: **${result.balance.toLocaleString()} ${settings.currency_name}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // Adicionar ao inventário
    runSql(
      'INSERT INTO economy_inventory (guild_id, user_id, item_id) VALUES (?, ?, ?)',
      [interaction.guildId, interaction.user.id, itemId]
    );

    // Atualizar estoque
    if (item.stock > 0) {
      runSql('UPDATE economy_shop SET stock = stock - 1 WHERE id = ?', [itemId]);
    }

    // Dar cargo se configurado
    if (item.role_reward_id) {
      try {
        await interaction.member.roles.add(item.role_reward_id, 'Economia: compra na loja');
      } catch (err) {
        log.warn({ err, roleId: item.role_reward_id }, 'Falha ao dar cargo de recompensa');
        return interaction.reply({content:'Compra registrada no inventário. A entrega do cargo precisa de atendimento pela equipe.',flags:MessageFlags.Ephemeral});
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`✅ Compra Realizada!`)
      .setDescription(`Você comprou **${item.item_name}** por **${item.price.toLocaleString()} ${settings.currency_name}**!\nSaldo restante: **${result.balance.toLocaleString()} ${settings.currency_name}**`)
      .setColor(0x63d2a3)
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (sub === 'adicionar') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({content:'Você precisa gerenciar o servidor para adicionar itens.',flags:MessageFlags.Ephemeral});
    }
    const name = interaction.options.getString('nome', true);
    const price = interaction.options.getInteger('preco', true);
    const desc = interaction.options.getString('descricao') || '';
    const role = interaction.options.getRole('cargo');
    const stock = interaction.options.getInteger('estoque') ?? -1;

    if (role && !require('../../packages/core/role-policy').canConfigure(interaction,role)) {
      return interaction.reply({content:'Escolha um cargo que você e o bot possam atribuir.',flags:MessageFlags.Ephemeral});
    }
    const result = runSql(
      'INSERT INTO economy_shop (guild_id, item_name, item_description, price, role_reward_id, stock) VALUES (?, ?, ?, ?, ?, ?)',
      [interaction.guildId, name, desc, price, role?.id || null, stock]
    );

    const newItemId = result.lastInsertRowid;

    const embed = new EmbedBuilder()
      .setTitle(`🏪 Item Adicionado à Loja`)
      .setDescription(`**${name}** adicionado com sucesso!\n• Preço: ${price.toLocaleString()} ${settings.currency_symbol}\n• Estoque: ${stock === -1 ? 'Ilimitado' : stock}\n• ID: \`${newItemId}\``)
      .setColor(0x63d2a3)
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

async function handleInventario(interaction) {
  const settings = getSettings(interaction.guildId);
  if (!settings.enabled) {
    return interaction.reply({ content: '❌ Economia não está ativa neste servidor.', flags: MessageFlags.Ephemeral });
  }

  const items = queryAll(
    `SELECT ei.*, es.item_name, es.item_description
     FROM economy_inventory ei
     JOIN economy_shop es ON ei.item_id = es.id
     WHERE ei.guild_id = ? AND ei.user_id = ?
     ORDER BY ei.purchased_at DESC`,
    [interaction.guildId, interaction.user.id]
  );

  if (items.length === 0) {
    return interaction.reply({ content: '🎒 Seu inventário está vazio.', flags: MessageFlags.Ephemeral });
  }

  const itemList = items.map(item =>
    `• **${item.item_name}**${item.item_description ? ` — ${item.item_description}` : ''} (comprado em ${new Date(item.purchased_at).toLocaleDateString('pt-BR')})`
  ).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🎒 Inventário de ${interaction.user.displayName}`)
    .setDescription(itemList)
    .setColor(0x63d2a3)
    .setFooter({ text: `${items.length} itens no total` })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleConfigurar(interaction) {
  const enabled = interaction.options.getBoolean('habilitado', true);
  const currencyName = interaction.options.getString('moeda');
  const symbol = interaction.options.getString('simbolo');
  const dailyAmount = interaction.options.getInteger('daily');
  const workMin = interaction.options.getInteger('trabalho-min');
  const workMax = interaction.options.getInteger('trabalho-max');
  const workCooldown = interaction.options.getInteger('cooldown-trabalho');

  runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
    [interaction.guildId, interaction.guild.name]);

  const settings = [
    ['enabled', String(enabled)],
    ...(currencyName ? [['currency_name', currencyName]] : []),
    ...(symbol ? [['currency_symbol', symbol]] : []),
    ...(dailyAmount ? [['daily_amount', String(dailyAmount)]] : []),
    ...(workMin ? [['work_min', String(workMin)]] : []),
    ...(workMax ? [['work_max', String(workMax)]] : []),
    ...(workCooldown ? [['work_cooldown_minutes', String(workCooldown)]] : [])
  ];

  for (const [key, value] of settings) {
    runSql(
      'INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)',
      [interaction.guildId, 'economy', key, value]
    );
  }

  log.info({ guildId: interaction.guildId, enabled }, 'Economia configurada');

  const status = enabled ? '✅ Ativado' : '❌ Desativado';
  const s = getSettings(interaction.guildId);

  await interaction.reply({
    content: `**Economia ${status}**\n• Moeda: ${s.currency_symbol} ${s.currency_name}\n• Daily: ${s.daily_amount.toLocaleString()}\n• Trabalho: ${s.work_min}-${s.work_max} (cooldown: ${s.work_cooldown_minutes}min)`,
    flags: MessageFlags.Ephemeral
  });
}

// === Contrato do Módulo ===
let context = null;

module.exports = {
  name: 'economy',
  getCommands,

  async init(ctx) {
    context = ctx;
    ensureSchema();
    log.info('Módulo Economia inicializado');
  },

  async start() {
    if (!context?.bus) return;

    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild() || !interaction.isChatInputCommand()) return;

      switch (interaction.commandName) {
        case 'saldo': return handleSaldo(interaction);
        case 'daily': return handleDaily(interaction);
        case 'trabalhar': return handleTrabalhar(interaction);
        case 'transferir': return handleTransferir(interaction);
        case 'loja': return handleLoja(interaction);
        case 'inventario': return handleInventario(interaction);
        case 'configurar-economia': return handleConfigurar(interaction);
      }
    });

    log.info('Módulo Economia iniciado — handlers registrados');
  },

  async stop() {
    log.info('Módulo Economia parado');
  },

  health() {
    const wallets = queryGet('SELECT COUNT(*) as count FROM economy_wallets');
    return {
      status: 'ok',
      totalWallets: wallets?.count ?? 0
    };
  }
};