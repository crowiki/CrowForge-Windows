"use strict";
const { EmbedBuilder, MessageFlags, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('store');

// === Schema ===
function ensureSchema() {
  runSql('DROP TABLE IF EXISTS store_products');
  runSql('DROP TABLE IF EXISTS store_transactions');
  runSql('DROP TABLE IF EXISTS store_config');

  runSql(`
    CREATE TABLE IF NOT EXISTS store_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL UNIQUE,
      channel_id TEXT,
      log_channel_id TEXT,
      currency_symbol TEXT NOT NULL DEFAULT 'R$',
      payment_method TEXT NOT NULL DEFAULT 'pix',
      payment_info TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS store_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      creator_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'digital',
      delivery_type TEXT NOT NULL DEFAULT 'role',
      delivery_value TEXT NOT NULL DEFAULT '',
      stock INTEGER NOT NULL DEFAULT -1,
      image_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS store_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_ref TEXT,
      delivered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES store_products(id)
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_store_products_guild ON store_products(guild_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_store_products_active ON store_products(active)');
  runSql('CREATE INDEX IF NOT EXISTS idx_store_transactions_guild ON store_transactions(guild_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_store_transactions_user ON store_transactions(user_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_store_transactions_status ON store_transactions(status)');
}

// === Helpers ===

function getConfig(guildId) {
  return queryGet('SELECT * FROM store_config WHERE guild_id = ?', [guildId]);
}

function getProducts(guildId, activeOnly = true) {
  if (activeOnly) {
    return queryAll('SELECT * FROM store_products WHERE guild_id = ? AND active = 1 ORDER BY category, name', [guildId]);
  }
  return queryAll('SELECT * FROM store_products WHERE guild_id = ? ORDER BY category, name', [guildId]);
}

function getProduct(productId) {
  return queryGet('SELECT * FROM store_products WHERE id = ?', [productId]);
}

function getUserTransactions(guildId, userId) {
  return queryAll(
    "SELECT * FROM store_transactions WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC",
    [guildId, userId]
  );
}

function getPendingTransactions(guildId) {
  return queryAll(
    "SELECT * FROM store_transactions WHERE guild_id = ? AND (status = 'pending' OR (status = 'confirmed' AND delivered = 0)) ORDER BY created_at ASC",
    [guildId]
  );
}

// === Comandos Slash ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('shop')
      .setDescription('Gerencia a loja de produtos digitais do servidor.')
      .addSubcommand(sub =>
        sub.setName('configurar')
          .setDescription('Configura a loja do servidor (requer permissão de gerenciamento).')
          .addChannelOption(o => o.setName('canal').setDescription('Canal da loja'))
          .addChannelOption(o => o.setName('logs').setDescription('Canal de logs de vendas'))
          .addStringOption(o => o.setName('moeda').setDescription('Símbolo da moeda (ex: R$, $)'))
          .addStringOption(o => o.setName('pagamento').setDescription('Método de pagamento').addChoices(
            { name: 'PIX', value: 'pix' },
            { name: 'Mercado Pago', value: 'mercadopago' },
            { name: 'Stripe', value: 'stripe' },
            { name: 'PayPal', value: 'paypal' },
            { name: 'Outro', value: 'other' }
          ))
          .addStringOption(o => o.setName('info').setDescription('Informações de pagamento (chave PIX, link, etc.)'))
      )
      .addSubcommand(sub =>
        sub.setName('produto')
          .setDescription('Gerencia produtos da loja (requer permissão de gerenciamento).')
          .addStringOption(o => o.setName('acao').setDescription('Ação').setRequired(true).addChoices(
            { name: '➕ Adicionar', value: 'add' },
            { name: '✏️ Editar', value: 'edit' },
            { name: '🗑️ Remover', value: 'remove' },
            { name: '📋 Listar todos', value: 'list' }
          ))
          .addStringOption(o => o.setName('nome').setDescription('Nome do produto'))
          .addNumberOption(o => o.setName('preco').setDescription('Preço do produto'))
          .addStringOption(o => o.setName('descricao').setDescription('Descrição do produto'))
          .addStringOption(o => o.setName('categoria').setDescription('Categoria (ex: cargo, premium, item)'))
          .addStringOption(o => o.setName('entrega').setDescription('Tipo de entrega').addChoices(
            { name: '🎭 Cargo', value: 'role' },
            { name: '💬 Mensagem DM', value: 'dm' },
            { name: '🔑 Código/Link', value: 'code' },
            { name: '📦 Manual', value: 'manual' }
          ))
          .addStringOption(o => o.setName('valor_entrega').setDescription('ID do cargo, mensagem ou código a entregar'))
          .addIntegerOption(o => o.setName('estoque').setDescription('Estoque disponível (-1 = ilimitado)'))
          .addStringOption(o => o.setName('imagem').setDescription('URL da imagem do produto'))
      )
      .addSubcommand(sub =>
        sub.setName('catalogo')
          .setDescription('Visualiza o catálogo de produtos disponíveis.')
      )
      .addSubcommand(sub =>
        sub.setName('comprar')
          .setDescription('Inicia a compra de um produto.')
          .addIntegerOption(o => o.setName('id').setDescription('ID do produto').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('minhas-compras')
          .setDescription('Visualiza suas compras.')
      )
      .addSubcommand(sub =>
        sub.setName('confirmar')
          .setDescription('Confirma pagamento e entrega produto (requer permissão de gerenciamento).')
          .addIntegerOption(o => o.setName('transacao').setDescription('ID da transação').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('entregue')
          .setDescription('Registra que a equipe concluiu a entrega de uma compra confirmada.')
          .addIntegerOption(o => o.setName('transacao').setDescription('ID da transação').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('pendentes')
          .setDescription('Lista pagamentos ou entregas pendentes (requer permissão de gerenciamento).')
      )
  ];
}

// === Helpers de Segurança ===

function hasAdminPermission(interaction) {
  return interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild) === true;
}

// === Handlers ===

async function handleConfigurar(interaction) {
  // FIX #1: Verificação de permissão administrativa
  if (!hasAdminPermission(interaction)) {
    return interaction.reply({ content: '❌ Você não tem permissão para configurar a loja.', flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de configuração da loja');
    return;
  }

  try {
    const channel = interaction.options.getChannel('canal');
    const logChannel = interaction.options.getChannel('logs');
    const currency = interaction.options.getString('moeda') || 'R$';
    const paymentMethod = interaction.options.getString('pagamento') || 'pix';
    const paymentInfo = interaction.options.getString('info') || '';

    runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
      [interaction.guildId, interaction.guild?.name || 'Unknown']);

    const existing = getConfig(interaction.guildId);
    if (existing) {
      runSql(
        'UPDATE store_config SET channel_id = ?, log_channel_id = ?, currency_symbol = ?, payment_method = ?, payment_info = ?, enabled = 1 WHERE guild_id = ?',
        [channel?.id || null, logChannel?.id || null, currency, paymentMethod, paymentInfo, interaction.guildId]
      );
    } else {
      runSql(
        'INSERT INTO store_config (guild_id, channel_id, log_channel_id, currency_symbol, payment_method, payment_info, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)',
        [interaction.guildId, channel?.id || null, logChannel?.id || null, currency, paymentMethod, paymentInfo]
      );
    }

    log.info({ guildId: interaction.guildId }, 'Loja configurada');

    const methodLabels = { pix: 'PIX', mercadopago: 'Mercado Pago', stripe: 'Stripe', paypal: 'PayPal', other: 'Outro' };

    // FIX #5: Não ecoar info de pagamento na resposta (dados sensíveis)
    await interaction.editReply({
      content: `✅ Loja configurada!\n\n` +
        `• **Canal:** ${channel ? `<#${channel.id}>` : 'Não definido'}\n` +
        `• **Canal de logs:** ${logChannel ? `<#${logChannel.id}>` : 'Não definido'}\n` +
        `• **Moeda:** ${currency}\n` +
        `• **Método de pagamento:** ${methodLabels[paymentMethod] || paymentMethod}\n` +
        `• **Info de pagamento:** ${paymentInfo ? '(configurada)' : 'Não definida'}\n\n` +
        `Use \`/shop produto acao:add\` para adicionar produtos à loja.`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao configurar loja');
    try {
      await interaction.editReply({ content: `❌ Erro ao configurar: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleProduto(interaction) {
  // FIX #1: Verificação de permissão administrativa
  if (!hasAdminPermission(interaction)) {
    return interaction.reply({ content: '❌ Você não tem permissão para gerenciar produtos.', flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de produto');
    return;
  }

  try {
    const acao = interaction.options.getString('acao', true);

    if (acao === 'list') {
      const products = getProducts(interaction.guildId, false);
      if (products.length === 0) {
        return interaction.editReply({ content: '📦 Nenhum produto cadastrado. Use `/shop produto acao:add` para criar.' });
      }

      const list = products.map(p => {
        const stockLabel = p.stock == null || p.stock === -1 ? '∞' : String(p.stock);
        const statusEmoji = p.active ? '✅' : '❌';
        return `\`#${p.id}\` ${statusEmoji} **${p.name}** — ${p.price.toFixed(2)} | Estoque: ${stockLabel} | Categoria: ${p.category}`;
      }).join('\n');

      const embed = new EmbedBuilder()
        .setTitle('📦 Produtos da Loja')
        .setDescription(list)
        .setColor(0x5b8def);

      return interaction.editReply({ embeds: [embed] });
    }

    if (acao === 'add') {
      const name = interaction.options.getString('nome');
      const price = interaction.options.getNumber('preco');
      const description = interaction.options.getString('descricao') || '';
      const category = interaction.options.getString('categoria') || 'digital';
      const deliveryType = interaction.options.getString('entrega') || 'manual';
      const deliveryValue = interaction.options.getString('valor_entrega') || '';
      const stock = interaction.options.getInteger('estoque') ?? -1;
      const imageUrl = interaction.options.getString('imagem');

      if (!name || price === null) {
        return interaction.editReply({ content: '❌ Nome e preço são obrigatórios para adicionar um produto.' });
      }

      // FIX #3: Validar preço não negativo
      if (deliveryType==='role' && !require('../../packages/core/role-policy').canConfigure(interaction,interaction.guild.roles.cache.get(deliveryValue)))
        return interaction.editReply({content:'Selecione um cargo comum que você e o bot possam gerenciar.'});
      if (price < 0) {
        return interaction.editReply({ content: '❌ O preço do produto não pode ser negativo.' });
      }

      runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
        [interaction.guildId, interaction.guild?.name || 'Unknown']);

      runSql(
        'INSERT INTO store_products (guild_id, creator_id, name, description, price, category, delivery_type, delivery_value, stock, image_url, price_cents) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ROUND(?5*100))',
        [interaction.guildId, interaction.user.id, name, description, price, category, deliveryType, deliveryValue, stock, imageUrl]
      );

      const row = queryGet(
        "SELECT id FROM store_products WHERE guild_id = ? AND name = ? ORDER BY id DESC LIMIT 1",
        [interaction.guildId, name]
      );

      log.info({ guildId: interaction.guildId, name, price }, 'Produto adicionado à loja');

      await interaction.editReply({
        content: `✅ Produto **${name}** adicionado com sucesso! (ID: #${row?.id || '?'})`
      });
      return;
    }

    if (acao === 'edit') {
      const name = interaction.options.getString('nome');
      const price = interaction.options.getNumber('preco');
      const description = interaction.options.getString('descricao');

      if (!name) {
        return interaction.editReply({ content: '❌ Informe o nome do produto para editar.' });
      }

      const product = queryGet('SELECT * FROM store_products WHERE guild_id = ? AND name = ?', [interaction.guildId, name]);
      if (!product) {
        return interaction.editReply({ content: `❌ Produto "${name}" não encontrado.` });
      }

      const updates = [];
      const values = [];
      if (price !== null) {
        if (!Number.isFinite(price) || price < 0) return interaction.editReply({content:'Informe um preço positivo ou zero.'});
        updates.push('price = ?', 'price_cents = ROUND(? * 100)'); values.push(price,price);
      }
      if (description !== null) { updates.push('description = ?'); values.push(description); }

      if (updates.length === 0) {
        return interaction.editReply({ content: '❌ Nenhum campo para atualizar.' });
      }

      values.push(product.id);
      runSql(`UPDATE store_products SET ${updates.join(', ')} WHERE id = ?`, values);

      log.info({ guildId: interaction.guildId, productId: product.id }, 'Produto editado');

      await interaction.editReply({ content: `✅ Produto **${name}** atualizado!` });
      return;
    }

    if (acao === 'remove') {
      const name = interaction.options.getString('nome');
      if (!name) {
        return interaction.editReply({ content: '❌ Informe o nome do produto para remover.' });
      }

      const product = queryGet('SELECT * FROM store_products WHERE guild_id = ? AND name = ?', [interaction.guildId, name]);
      if (!product) {
        return interaction.editReply({ content: `❌ Produto "${name}" não encontrado.` });
      }

      runSql('UPDATE store_products SET active = 0 WHERE id = ?', [product.id]);

      log.info({ guildId: interaction.guildId, productId: product.id }, 'Produto removido');

      await interaction.editReply({ content: `✅ Produto **${name}** removido da loja.` });
      return;
    }
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao gerenciar produto');
    try {
      await interaction.editReply({ content: `❌ Erro: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleCatalogo(interaction) {
  const config = getConfig(interaction.guildId);
  if (!config || !config.enabled) {
    return interaction.reply({ content: '🛒 A loja não está configurada neste servidor.', flags: MessageFlags.Ephemeral });
  }

  const products = getProducts(interaction.guildId, true);
  if (products.length === 0) {
    return interaction.reply({ content: '📦 Nenhum produto disponível no momento.', flags: MessageFlags.Ephemeral });
  }

  const currency = config.currency_symbol || 'R$';

  const embed = new EmbedBuilder()
    .setTitle('🛒 Catálogo da Loja')
    .setDescription('Use `/shop comprar id:<número>` para adquirir um produto.')
    .setColor(0x5b8def)
    .setTimestamp();

  // Agrupar por categoria
  const categories = {};
  products.forEach(p => {
    if (!categories[p.category]) categories[p.category] = [];
    const stockLabel = p.stock == null || p.stock === -1 ? '∞' : String(p.stock);
    categories[p.category].push(`\`#${p.id}\` **${p.name}** — ${currency} ${p.price.toFixed(2)} *(estoque: ${stockLabel})*`);
  });

  for (const [cat, items] of Object.entries(categories)) {
    embed.addFields({
      name: `📂 ${cat.charAt(0).toUpperCase() + cat.slice(1)}`,
      value: items.join('\n'),
      inline: false
    });
  }

  return interaction.reply({ embeds: [embed] });
}

async function handleComprar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de compra');
    return;
  }

  try {
    const productId = interaction.options.getInteger('id', true);
    const config = getConfig(interaction.guildId);

    if (!config || !config.enabled) {
      return interaction.editReply({ content: '❌ A loja não está configurada neste servidor.' });
    }

    const product = getProduct(productId);
    if (!product || product.guild_id !== interaction.guildId || !product.active) {
      return interaction.editReply({ content: '❌ Produto não encontrado ou indisponível.' });
    }

    if (product.stock === 0) {
      return interaction.editReply({ content: '❌ Produto esgotado.' });
    }

    // Criar transação pendente
    runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
      [interaction.guildId, interaction.guild?.name || 'Unknown']);

    runSql(
      'INSERT INTO store_transactions (guild_id, product_id, user_id, amount, status) VALUES (?, ?, ?, ?, ?)',
      [interaction.guildId, productId, interaction.user.id, product.price, 'pending']
    );

    const txRow = queryGet(
      "SELECT id FROM store_transactions WHERE guild_id = ? AND product_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1",
      [interaction.guildId, productId, interaction.user.id]
    );

    if (!txRow) {
      return interaction.editReply({ content: '❌ Falha ao criar transação.' });
    }

    const currency = config.currency_symbol || 'R$';
    const methodLabels = { pix: 'PIX', mercadopago: 'Mercado Pago', stripe: 'Stripe', paypal: 'PayPal', other: 'Outro' };

    const embed = new EmbedBuilder()
      .setTitle('🛒 Compra Iniciada')
      .setDescription(
        `**Produto:** ${product.name}\n` +
        `**Valor:** ${currency} ${product.price.toFixed(2)}\n` +
        `**Método:** ${methodLabels[config.payment_method] || config.payment_method}\n\n` +
        `**Informações de pagamento:**\n${config.payment_info || 'Contate a equipe para obter dados de pagamento.'}\n\n` +
        `Após realizar o pagamento, aguarde a confirmação da equipe. Sua transação ID é \`#${txRow.id}\`.`
      )
      .setColor(0xf59e0b)
      .setFooter({ text: `Transação #${txRow.id}` })
      .setTimestamp();

    log.info({ guildId: interaction.guildId, productId, userId: interaction.user.id, txId: txRow.id }, 'Compra iniciada');

    // Notificar no canal de logs
    if (config.log_channel_id) {
      try {
        const logChannel = await interaction.guild.channels.fetch(config.log_channel_id);
        if (logChannel && typeof logChannel.send === 'function') {
          const logEmbed = new EmbedBuilder()
            .setTitle('🛒 Nova Compra')
            .setDescription(`<@${interaction.user.id}> iniciou compra de **${product.name}** (${currency} ${product.price.toFixed(2)})`)
            .setColor(0xf59e0b)
            .setFooter({ text: `Transação #${txRow.id}` })
            .setTimestamp();

          // FIX #4: Incluir guild_id no customId para evitar cross-guild abuse
          const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`store:confirm:${interaction.guildId}:${txRow.id}`)
              .setLabel('✅ Confirmar Pagamento')
              .setStyle(ButtonStyle.Success)
          );

          await logChannel.send({ embeds: [logEmbed], components: [buttons] });
        }
      } catch { /* ignora falha de log */ }
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao processar compra');
    try {
      await interaction.editReply({ content: `❌ Erro ao processar compra: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleMinhasCompras(interaction) {
  const transactions = getUserTransactions(interaction.guildId, interaction.user.id);

  if (transactions.length === 0) {
    return interaction.reply({ content: '📦 Você não possui compras neste servidor.', flags: MessageFlags.Ephemeral });
  }

  const list = transactions.slice(0, 15).map(tx => {
    const product = getProduct(tx.product_id);
    const statusEmoji = tx.status === 'confirmed' ? '✅' : tx.status === 'pending' ? '⏳' : '❌';
    const deliveredEmoji = tx.delivered ? '📦' : '⏳';
    return `\`#${tx.id}\` ${statusEmoji} **${product?.name || 'Produto removido'}** — ${tx.amount.toFixed(2)} ${deliveredEmoji}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('📦 Minhas Compras')
    .setDescription(list)
    .setColor(0x5b8def)
    .setFooter({ text: `${transactions.length} compra(s)` });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleConfirmar(interaction,buttonTxId) {
  // FIX #1: Verificação de permissão administrativa
  if (!hasAdminPermission(interaction)) {
    return interaction.reply({ content: '❌ Você não tem permissão para confirmar pagamentos.', flags: MessageFlags.Ephemeral });
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de confirmação');
    return;
  }

  try {
    const txId = buttonTxId ?? interaction.options.getInteger('transacao', true);
    const tx = queryGet('SELECT * FROM store_transactions WHERE id = ? AND guild_id = ?', [txId, interaction.guildId]);

    if (!tx) {
      return interaction.editReply({ content: '❌ Transação não encontrada.' });
    }

    if (tx.status !== 'pending') {
      return interaction.editReply({ content: '❌ Esta transação já foi processada.' });
    }

    const product = getProduct(tx.product_id);
    if (!product) {
      return interaction.editReply({ content: '❌ Produto associado não encontrado.' });
    }

    const roles=require('../../packages/core/role-policy');
    if (product.delivery_type==='role' && !roles.canConfigure(interaction,interaction.guild.roles.cache.get(product.delivery_value)))
      return interaction.editReply({content:'Cargo indisponível ou acima das permissões do operador.'});
    const sql=require('../../packages/db').getDb();
    sql.run('BEGIN');
    try {
      if (product.stock!==null && product.stock>=0) {
        sql.run('UPDATE store_products SET stock=stock-1 WHERE id=? AND stock>0',[product.id]);
        if (!sql.getRowsModified()) {sql.run('ROLLBACK');return interaction.editReply({content:'Produto esgotado.'});}
      }
      sql.run("UPDATE store_transactions SET status='confirmed' WHERE id=? AND status='pending'",[txId]);
      if (!sql.getRowsModified()) {sql.run('ROLLBACK');return interaction.editReply({content:'Transação já processada.'});}
      sql.run('COMMIT');
    } catch(err) {sql.run('ROLLBACK');throw err;}
    require('../../packages/db').saveDatabase();
    let deliveryResult='Entrega manual pendente.';
    if (['role','dm','code'].includes(product.delivery_type) && product.delivery_value) {
      try {
        if (product.delivery_type==='role') {
          const member=await interaction.guild.members.fetch(tx.user_id);
          await member.roles.add(product.delivery_value,'Compra na loja');
        } else {
          const user=await interaction.client.users.fetch(tx.user_id);
          await user.send(product.delivery_value);
        }
        runSql('UPDATE store_transactions SET delivered=1 WHERE id=?',[txId]);
        deliveryResult='Produto entregue.';
      } catch(err) {
        log.warn({txId,code:err.code},'Entrega pendente de atendimento');
        deliveryResult='Pagamento confirmado. Entrega pendente de atendimento pela equipe.';
      }
    }

    // Notificar comprador
    try {
      const user = await interaction.client.users.fetch(tx.user_id);
      if (user) {
        const embed = new EmbedBuilder()
          .setTitle('✅ Compra Confirmada!')
          .setDescription(`Sua compra de **${product.name}** foi confirmada.\n\n${deliveryResult}`)
          .setColor(0x63d2a3)
          .setFooter({ text: `Transação #${txId}` })
          .setTimestamp();
        await user.send({ embeds: [embed] }).catch(() => {});
      }
    } catch { /* ignora falha de DM */ }

    log.info({ txId, productId: product.id, userId: tx.user_id }, 'Transação confirmada');

    await interaction.editReply({
      content: `✅ Transação #${txId} confirmada!\n**Produto:** ${product.name}\n**Comprador:** <@${tx.user_id}>\n**Entrega:** ${deliveryResult}`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao confirmar transação');
    try {
      await interaction.editReply({ content: `❌ Erro: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handlePendentes(interaction) {
  // FIX #1: Verificação de permissão administrativa
  if (!hasAdminPermission(interaction)) {
    return interaction.reply({ content: '❌ Você não tem permissão para ver transações pendentes.', flags: MessageFlags.Ephemeral });
  }

  const pending = getPendingTransactions(interaction.guildId);

  if (pending.length === 0) {
    return interaction.reply({ content: '✅ Nenhuma transação pendente.', flags: MessageFlags.Ephemeral });
  }

  const list = pending.slice(0, 15).map(tx => {
    const product = getProduct(tx.product_id);
    return `\`#${tx.id}\` **${product?.name || '?'}** — <@${tx.user_id}> — ${tx.amount.toFixed(2)} · ${tx.status==='confirmed'?'Entrega pendente':'Pagamento pendente'}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('⏳ Transações Pendentes')
    .setDescription(list)
    .setColor(0xf59e0b)
    .setFooter({ text: `${pending.length} pendente(s) • Pagamento: /shop confirmar • Entrega manual: /shop entregue` });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// === Handler de botão de confirmação ===

async function handleStoreButton(interaction) {
  if (!interaction.customId.startsWith('store:')) return false;

  const parts = interaction.customId.split(':');
  const action = parts[1];
  // FIX #4: Novo formato store:confirm:<guildId>:<txId>
  const guildIdFromButton = parts[2];
  const txId = Number(parts[3]);

  // Verificar se o botão pertence a esta guild
  if (guildIdFromButton !== interaction.guildId) {
    await interaction.reply({ content: '❌ Este botão não pertence a este servidor.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === 'confirm') {
    // Verificar permissão
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: '❌ Você não tem permissão para confirmar pagamentos.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const tx = queryGet('SELECT * FROM store_transactions WHERE id = ? AND guild_id = ?', [txId, interaction.guildId]);
    if (!tx || tx.status !== 'pending') {
      await interaction.reply({ content: '❌ Transação não encontrada ou já processada.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await handleConfirmar(interaction,txId);
    return true;
  }

  return false;
}

// === Contrato do Módulo ===
let context = null;

module.exports = {
  name: 'store',
  getCommands,

  async init(ctx) {
    context = ctx;
    ensureSchema();
    log.info('Módulo Loja inicializado');
  },

  async start() {
    if (!context?.bus) return;

    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;

      if (interaction.isButton()) {
        const handled = await handleStoreButton(interaction);
        if (handled) return;
      }

      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'shop') return;

      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'configurar': return handleConfigurar(interaction);
        case 'produto': return handleProduto(interaction);
        case 'catalogo': return handleCatalogo(interaction);
        case 'comprar': return handleComprar(interaction);
        case 'minhas-compras': return handleMinhasCompras(interaction);
        case 'confirmar': return handleConfirmar(interaction);
        case 'entregue': {
          if (!hasAdminPermission(interaction)) return interaction.reply({content:'Apenas a equipe pode registrar a entrega.',flags:MessageFlags.Ephemeral});
          const id=interaction.options.getInteger('transacao',true);
          const result=runSql("UPDATE store_transactions SET delivered=1 WHERE guild_id=? AND id=? AND status='confirmed' AND delivered=0",[interaction.guildId,id]);
          return interaction.reply({content:result.changes?'Entrega registrada.':'Nenhuma entrega pendente para essa transação.',flags:MessageFlags.Ephemeral});
        }
        case 'pendentes': return handlePendentes(interaction);
      }
    });

    log.info('Módulo Loja iniciado — handlers registrados');
  },

  async stop() {
    log.info('Módulo Loja parado');
  },

  health() {
    const products = queryGet("SELECT COUNT(*) as count FROM store_products WHERE active = 1");
    const pending = queryGet("SELECT COUNT(*) as count FROM store_transactions WHERE status = 'pending'");
    return {
      status: 'ok',
      activeProducts: products?.count ?? 0,
      pendingTransactions: pending?.count ?? 0
    };
  }
};