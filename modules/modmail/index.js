"use strict";
const { EmbedBuilder, MessageFlags, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('modmail');

// === Schema ===
function ensureSchema() {
  runSql('DROP TABLE IF EXISTS modmail_config');
  runSql('DROP TABLE IF EXISTS modmail_tickets');
  runSql('DROP TABLE IF EXISTS modmail_messages');

  runSql(`
    CREATE TABLE IF NOT EXISTS modmail_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL UNIQUE,
      category_id TEXT,
      log_channel_id TEXT,
      staff_role_id TEXT,
      welcome_message TEXT NOT NULL DEFAULT 'Olá! Sua mensagem foi enviada à equipe. Aguarde a resposta.',
      close_message TEXT NOT NULL DEFAULT 'Este atendimento foi encerrado. Obrigado!',
      enabled INTEGER NOT NULL DEFAULT 1
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS modmail_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT
    )
  `);

  runSql(`
    CREATE TABLE IF NOT EXISTS modmail_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      sender_id TEXT NOT NULL,
      sender_type TEXT NOT NULL DEFAULT 'user',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ticket_id) REFERENCES modmail_tickets(id)
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_modmail_tickets_guild ON modmail_tickets(guild_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_modmail_tickets_user ON modmail_tickets(user_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_modmail_tickets_status ON modmail_tickets(status)');
  runSql('CREATE INDEX IF NOT EXISTS idx_modmail_messages_ticket ON modmail_messages(ticket_id)');
}

// === Helpers ===

function getConfig(guildId) {
  return queryGet('SELECT * FROM modmail_config WHERE guild_id = ?', [guildId]);
}

function getOpenTicket(guildId, userId) {
  return queryGet(
    "SELECT * FROM modmail_tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'",
    [guildId, userId]
  );
}

function getTicket(ticketId) {
  return queryGet('SELECT * FROM modmail_tickets WHERE id = ?', [ticketId]);
}

function getTicketByChannel(channelId) {
  return queryGet('SELECT * FROM modmail_tickets WHERE channel_id = ?', [channelId]);
}

function getTicketMessages(ticketId) {
  return queryAll(
    'SELECT * FROM modmail_messages WHERE ticket_id = ? ORDER BY created_at ASC',
    [ticketId]
  );
}

// === Comandos Slash ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('modmail')
      .setDescription('Gerencia o sistema de ModMail do servidor.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(sub =>
        sub.setName('configurar')
          .setDescription('Configura o sistema de ModMail.')
          .addChannelOption(o => o.setName('categoria').setDescription('Categoria para criar canais de atendimento'))
          .addChannelOption(o => o.setName('logs').setDescription('Canal de logs de ModMail'))
          .addRoleOption(o => o.setName('cargo').setDescription('Cargo da equipe que atende'))
      )
      .addSubcommand(sub =>
        sub.setName('desativar')
          .setDescription('Desativa o sistema de ModMail.')
      )
      .addSubcommand(sub =>
        sub.setName('fechar')
          .setDescription('Fecha o canal de ModMail atual.')
      )
      .addSubcommand(sub =>
        sub.setName('responder')
          .setDescription('Responde ao usuário via ModMail (use no canal do atendimento).')
          .addStringOption(o => o.setName('mensagem').setDescription('Mensagem para enviar ao usuário').setRequired(true))
      )
  ];
}

// === Handlers ===

async function handleConfigurar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de configuração ModMail');
    return;
  }

  try {
    const category = interaction.options.getChannel('categoria');
    const logChannel = interaction.options.getChannel('logs');
    const staffRole = interaction.options.getRole('cargo');

    runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
      [interaction.guildId, interaction.guild?.name || 'Unknown']);

    const existing = getConfig(interaction.guildId);
    if (existing) {
      runSql(
        'UPDATE modmail_config SET category_id = ?, log_channel_id = ?, staff_role_id = ?, enabled = 1 WHERE guild_id = ?',
        [category?.id || null, logChannel?.id || null, staffRole?.id || null, interaction.guildId]
      );
    } else {
      runSql(
        'INSERT INTO modmail_config (guild_id, category_id, log_channel_id, staff_role_id, enabled) VALUES (?, ?, ?, ?, 1)',
        [interaction.guildId, category?.id || null, logChannel?.id || null, staffRole?.id || null]
      );
    }

    log.info({ guildId: interaction.guildId }, 'ModMail configurado');

    const catMention = category ? `<#${category.id}>` : 'Sem categoria';
    const logMention = logChannel ? `<#${logChannel.id}>` : 'Sem canal de logs';
    const roleMention = staffRole ? `<@&${staffRole.id}>` : 'Todos os admins';

    await interaction.editReply({
      content: `✅ ModMail configurado!\n\n` +
        `• **Categoria:** ${catMention}\n` +
        `• **Canal de logs:** ${logMention}\n` +
        `• **Cargo da equipe:** ${roleMention}\n\n` +
        `Usuários podem enviar DM ao bot para abrir um atendimento. A equipe responde pelo canal criado.`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao configurar ModMail');
    try {
      await interaction.editReply({ content: `❌ Erro ao configurar: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleDesativar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de desativação ModMail');
    return;
  }

  try {
    const config = getConfig(interaction.guildId);
    if (!config || !config.enabled) {
      return interaction.editReply({ content: '❌ ModMail já está desativado.' });
    }

    runSql('UPDATE modmail_config SET enabled = 0 WHERE guild_id = ?', [interaction.guildId]);

    log.info({ guildId: interaction.guildId }, 'ModMail desativado');

    await interaction.editReply({ content: '✅ ModMail desativado. Mensagens DM não criarão mais atendimentos.' });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao desativar ModMail');
    try {
      await interaction.editReply({ content: `❌ Erro ao desativar: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleFechar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de fechar ModMail');
    return;
  }

  try {
    const ticket = getTicketByChannel(interaction.channelId);
    if (!ticket || ticket.status !== 'open') {
      return interaction.editReply({ content: '❌ Este canal não é um atendimento ModMail ativo.' });
    }

    runSql("UPDATE modmail_tickets SET status = 'closed', closed_at = datetime('now') WHERE id = ?", [ticket.id]);

    const config = getConfig(interaction.guildId);

    // Notificar usuário via DM
    try {
      const user = await interaction.client.users.fetch(ticket.user_id);
      if (user) {
        const embed = new EmbedBuilder()
          .setTitle('📬 Atendimento Encerrado')
          .setDescription(config?.close_message || 'Seu atendimento foi encerrado. Obrigado!')
          .setColor(0xf87171)
          .setFooter({ text: `Ticket #${ticket.id}` })
          .setTimestamp();

        await user.send({ embeds: [embed] }).catch(() => {});
      }
    } catch { /* ignora falha de DM */ }

    // Log de encerramento
    if (config?.log_channel_id) {
      try {
        const logChannel = await interaction.guild.channels.fetch(config.log_channel_id);
        if (logChannel && typeof logChannel.send === 'function') {
          const messages = getTicketMessages(ticket.id);
          const transcript = messages.slice(-20).map(m => {
            const sender = m.sender_type === 'staff' ? '👮 Equipe' : '👤 Usuário';
            return `${sender}: ${m.content}`;
          }).join('\n') || 'Sem mensagens';

          const logEmbed = new EmbedBuilder()
            .setTitle(`📬 Ticket #${ticket.id} Encerrado`)
            .setDescription(`**Usuário:** <@${ticket.user_id}>\n**Fechado por:** <@${interaction.user.id}>\n\n**Últimas mensagens:**\n${transcript.substring(0, 3000)}`)
            .setColor(0xf87171)
            .setTimestamp();

          await logChannel.send({ embeds: [logEmbed] });
        }
      } catch { /* ignora falha de log */ }
    }

    log.info({ guildId: interaction.guildId, ticketId: ticket.id }, 'ModMail fechado');

    await interaction.editReply({ content: `✅ Atendimento #${ticket.id} encerrado. O canal será deletado em 5 segundos.` });

    // Deletar canal após 5 segundos
    setTimeout(async () => {
      try {
        const channel = await interaction.guild.channels.fetch(interaction.channelId);
        if (channel) await channel.delete('ModMail fechado');
      } catch { /* ignora */ }
    }, 5000);
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao fechar ModMail');
    try {
      await interaction.editReply({ content: `❌ Erro ao fechar: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleResponder(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta ModMail');
    return;
  }

  try {
    const ticket = getTicketByChannel(interaction.channelId);
    if (!ticket || ticket.status !== 'open') {
      return interaction.editReply({ content: '❌ Este canal não é um atendimento ModMail ativo.' });
    }

    const message = interaction.options.getString('mensagem', true);

    // Salvar mensagem
    runSql(
      'INSERT INTO modmail_messages (ticket_id, sender_id, sender_type, content) VALUES (?, ?, ?, ?)',
      [ticket.id, interaction.user.id, 'staff', message]
    );

    // Enviar ao usuário via DM
    try {
      const user = await interaction.client.users.fetch(ticket.user_id);
      if (user) {
        const embed = new EmbedBuilder()
          .setTitle('📬 Resposta da Equipe')
          .setDescription(message)
          .setColor(0x63d2a3)
          .setFooter({ text: `Ticket #${ticket.id} • ${interaction.user.displayName}` })
          .setTimestamp();

        await user.send({ embeds: [embed] });
      }
    } catch (err) {
      log.warn({ err, userId: ticket.user_id }, 'Falha ao enviar DM de resposta ModMail');
      return interaction.editReply({ content: '❌ Não foi possível enviar DM ao usuário. Verifique se o DM está aberto.' });
    }

    log.info({ ticketId: ticket.id, staffId: interaction.user.id }, 'Resposta ModMail enviada');

    await interaction.editReply({ content: `✅ Mensagem enviada ao usuário com sucesso!` });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao responder ModMail');
    try {
      await interaction.editReply({ content: `❌ Erro ao responder: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

// === Handler de DM para criar atendimento ===

async function handleDMMessage(message) {
  if (message.author.bot || message.guild) return;

  // Encontrar guilds compartilhadas com o bot
  const sharedGuilds = [];
  if (context?.client) {
    for (const guild of context.client.guilds.cache.values()) {
      try {
        if (process.env.GUILD_ID && guild.id !== process.env.GUILD_ID) continue;
        if (!queryGet("SELECT enabled FROM modules WHERE guild_id=? AND module_name='modmail'",[guild.id])?.enabled) continue;
        const member = await guild.members.fetch(message.author.id).catch(() => null);
        if (member) {
          const config = getConfig(guild.id);
          if (config && config.enabled) {
            sharedGuilds.push({ guild, config });
          }
        }
      } catch { /* ignora */ }
    }
  }

  if (sharedGuilds.length !== 1) return;

  // Usar a primeira guild com ModMail ativo (ou a principal configurada no .env)
  const targetGuildId = process.env.GUILD_ID || sharedGuilds[0].guild.id;
  const target = sharedGuilds.find(g => g.guild.id === targetGuildId) || sharedGuilds[0];
  const { guild, config } = target;

  // Verificar se já tem ticket aberto
  let ticket = getOpenTicket(guild.id, message.author.id);

  if (!ticket) {
    // Criar novo ticket
    try {
      const channelName = `modmail-${message.author.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').substring(0, 50);

      const overwrites = [
        { id: guild.id, deny: ['ViewChannel'] }
      ];
      if (config.staff_role_id) {
        overwrites.push({ id: config.staff_role_id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] });
      } else {
        overwrites.push({ id: guild.roles.everyone, deny: ['ViewChannel'] });
      }

      const newChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: config.category_id || undefined,
        permissionOverwrites: overwrites
      });

      runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
        [guild.id, guild.name]);

      runSql(
        'INSERT INTO modmail_tickets (guild_id, user_id, channel_id) VALUES (?, ?, ?)',
        [guild.id, message.author.id, newChannel.id]
      );

      const ticketRow = queryGet(
        "SELECT id FROM modmail_tickets WHERE guild_id = ? AND user_id = ? AND channel_id = ?",
        [guild.id, message.author.id, newChannel.id]
      );

      if (!ticketRow) {
        await newChannel.delete('Falha ao criar ticket ModMail');
        return;
      }

      ticket = getTicket(ticketRow.id);

      // Enviar mensagem de abertura no canal
      const openEmbed = new EmbedBuilder()
        .setTitle(`📬 Novo Atendimento — ${message.author.tag}`)
        .setDescription(`**Usuário:** <@${message.author.id}>\n**ID:** ${message.author.id}\n**Conta criada:** <t:${Math.floor(message.author.createdTimestamp / 1000)}:R>\n\n**Primeira mensagem:**\n${message.content || '*(sem texto)*'}`)
        .setColor(0x5b8def)
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `Ticket #${ticket.id}` })
        .setTimestamp();

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`modmail:close:${ticket.id}`)
          .setLabel('🔒 Fechar Atendimento')
          .setStyle(ButtonStyle.Danger)
      );

      await newChannel.send({ embeds: [openEmbed], components: [buttons] });

      // Ping staff role se configurado
      if (config.staff_role_id) {
        await newChannel.send(`<@&${config.staff_role_id}>`);
      }

      // Log
      if (config.log_channel_id) {
        try {
          const logChannel = await guild.channels.fetch(config.log_channel_id);
          if (logChannel && typeof logChannel.send === 'function') {
            const logEmbed = new EmbedBuilder()
              .setTitle('📬 Novo ModMail')
              .setDescription(`<@${message.author.id}> abriu um atendimento.`)
              .setColor(0x5b8def)
              .setFooter({ text: `Ticket #${ticket.id} • Canal: <#${newChannel.id}>` })
              .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
          }
        } catch { /* ignora */ }
      }

      log.info({ guildId: guild.id, userId: message.author.id, ticketId: ticket.id }, 'Ticket ModMail criado');
    } catch (err) {
      log.error({ err, stack: err?.stack }, 'Erro ao criar ticket ModMail');
      return;
    }
  } else {
    // Ticket já existe — adicionar mensagem
    runSql(
      'INSERT INTO modmail_messages (ticket_id, sender_id, sender_type, content) VALUES (?, ?, ?, ?)',
      [ticket.id, message.author.id, 'user', message.content || '*(sem texto)*']
    );

    // Enviar mensagem no canal
    try {
      const channel = await guild.channels.fetch(ticket.channel_id);
      if (channel) {
        const msgEmbed = new EmbedBuilder()
          .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
          .setDescription(message.content || '*(sem texto)*')
          .setColor(0x5b8def)
          .setTimestamp();

        if (message.attachments.size > 0) {
          const firstAttachment = message.attachments.first();
          if (firstAttachment && firstAttachment.contentType?.startsWith('image/')) {
            msgEmbed.setImage(firstAttachment.url);
          }
        }

        await channel.send({ embeds: [msgEmbed] });
      }
    } catch (err) {
      log.warn({ err, ticketId: ticket.id }, 'Falha ao enviar mensagem ModMail ao canal');
    }
  }

  // Confirmar recebimento ao usuário
  try {
    const confirmEmbed = new EmbedBuilder()
      .setTitle('📬 Mensagem Recebida')
      .setDescription(config?.welcome_message || 'Sua mensagem foi enviada à equipe. Aguarde a resposta.')
      .setColor(0x5b8def)
      .setFooter({ text: `Ticket #${ticket.id}` })
      .setTimestamp();

    await message.reply({ embeds: [confirmEmbed] });
  } catch { /* ignora falha de confirmação */ }
}

// === Handler de resposta da staff no canal ===

async function handleStaffMessage(message) {
  if (!require("../state").isEnabled(message.guild?.id, "modmail")) return;
  if (!message.guild || message.author.bot) return;

  const ticket = getTicketByChannel(message.channel.id);
  if (!ticket || ticket.status !== 'open') return;

  // Se a mensagem é um comando (começa com /), ignorar
  if (message.content.startsWith('/')) return;

  // Salvar mensagem da staff
  runSql(
    'INSERT INTO modmail_messages (ticket_id, sender_id, sender_type, content) VALUES (?, ?, ?, ?)',
    [ticket.id, message.author.id, 'staff', message.content || '*(sem texto)*']
  );

  // Enviar ao usuário via DM
  try {
    const user = await message.client.users.fetch(ticket.user_id);
    if (user) {
      const embed = new EmbedBuilder()
        .setTitle('📬 Resposta da Equipe')
        .setDescription(message.content || '*(sem texto)*')
        .setColor(0x63d2a3)
        .setFooter({ text: `Ticket #${ticket.id} • ${message.author.displayName}` })
        .setTimestamp();

      if (message.attachments.size > 0) {
        const firstAttachment = message.attachments.first();
        if (firstAttachment && firstAttachment.contentType?.startsWith('image/')) {
          embed.setImage(firstAttachment.url);
        }
      }

      await user.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err) {
    log.warn({ err, userId: ticket.user_id }, 'Falha ao enviar resposta ModMail via DM');
  }
}

// === Contrato do Módulo ===
let context = null;
let _messageHandler = null;

module.exports = {
  name: 'modmail',
  getCommands,

  async init(ctx) {
    context = ctx;
    ensureSchema();
    log.info('Módulo ModMail inicializado');
  },

  async start() {
    if (!context?.bus) return;

    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'modmail') return;

      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'configurar': return handleConfigurar(interaction);
        case 'desativar': return handleDesativar(interaction);
        case 'fechar': return handleFechar(interaction);
        case 'responder': return handleResponder(interaction);
      }
    });

    // Listeners de mensagens
    if (context.client) {
      _messageHandler = async (message) => {
        if (!message.guild) {
          await handleDMMessage(message);
        } else {
          if (process.env.GUILD_ID && message.guild.id !== process.env.GUILD_ID) return;
          await handleStaffMessage(message);
        }
      };
      context.client.on('messageCreate', _messageHandler);
    }

    log.info('Módulo ModMail iniciado — handlers e listeners registrados');
  },

  async stop() {
    if (context?.client && _messageHandler) {
      context.client.off('messageCreate', _messageHandler);
      _messageHandler = null;
    }
    log.info('Módulo ModMail parado');
  },

  health() {
    const open = queryGet("SELECT COUNT(*) as count FROM modmail_tickets WHERE status = 'open'");
    return {
      status: 'ok',
      openTickets: open?.count ?? 0
    };
  }
};