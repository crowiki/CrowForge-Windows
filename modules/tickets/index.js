"use strict";
const crypto = require('node:crypto');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
  MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { createChild, validateChannel, validateRole, validateBotPermissions } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('tickets');

// Estado em memória para debounce de criação
const openingLocks = new Set();

// === Helpers ===

function ephemeral(content) {
  return { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function isStaff(interaction, staffRoleId) {
  if (isAdmin(interaction)) return true;
  const roles = interaction.member?.roles;
  if (!staffRoleId || !roles) return false;
  return Array.isArray(roles) ? roles.includes(staffRoleId) : Boolean(roles.cache?.has(staffRoleId));
}

function safeName(name) {
  return (name || 'usuario')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-').slice(0, 20) || 'usuario';
}

function getGuildSetting(guildId, key) {
  const row = queryGet(
    "SELECT value FROM settings WHERE guild_id = ? AND module = 'tickets' AND key = ?",
    [guildId, key]
  );
  return row?.value || null;
}

function getNextTicketSeq(guildId) {
  const row = queryGet(
    'SELECT COALESCE(MAX(ticket_seq), 0) + 1 as next_seq FROM tickets WHERE guild_id = ?',
    [guildId]
  );
  return row ? Number(row.next_seq) : 1;
}

async function sendLog(guild, logsChannelId, title, detail) {
  if (!logsChannelId) return;
  try {
    const channel = await guild.channels.fetch(logsChannelId);
    if (channel?.isTextBased()) {
      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle(title)
          .setDescription(detail.slice(0, 3500))
          .setColor(0x22c55e)
          .setTimestamp()],
        allowedMentions: { parse: [] }
      });
    }
  } catch (err) {
    log.warn({ err, logsChannelId }, 'Falha ao enviar log de ticket');
  }
}

// === Comandos Slash ===

function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('configurar-tickets')
      .setDescription('Configura categoria, equipe e logs dos tickets.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption(o => o.setName('categoria')
        .setDescription('Categoria onde serão criados os tickets')
        .addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addRoleOption(o => o.setName('equipe')
        .setDescription('Cargo da equipe de suporte').setRequired(true))
      .addChannelOption(o => o.setName('logs')
        .setDescription('Canal opcional para logs')
        .addChannelTypes(ChannelType.GuildText).setRequired(false)),

    new SlashCommandBuilder()
      .setName('painel-tickets')
      .setDescription('Publica painel de abertura de tickets.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption(o => o.setName('canal')
        .setDescription('Canal para publicar painel')
        .addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('titulo')
        .setDescription('Título do painel (até 80 caracteres)').setMaxLength(80)),

    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Ações dentro de um atendimento.')
      .addSubcommand(s => s.setName('assumir').setDescription('Equipe assume o ticket'))
      .addSubcommand(s => s.setName('fechar').setDescription('Encerra o ticket'))
      .addSubcommand(s => s.setName('adicionar').setDescription('Adiciona um usuário ao ticket')
        .addUserOption(o => o.setName('usuario').setDescription('Membro que poderá acessar').setRequired(true)))
      .addSubcommand(s => s.setName('remover').setDescription('Remove um usuário do ticket')
        .addUserOption(o => o.setName('usuario').setDescription('Membro que perderá acesso').setRequired(true)))
      .addSubcommand(s => s.setName('status').setDescription('Exibe detalhes do ticket atual'))
  ];
}

// === Handlers de Interação ===

async function handleConfig(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.reply(ephemeral('Você precisa de Gerenciar Servidor.'));
  }

  const category = interaction.options.getChannel('categoria', true);
  const role = interaction.options.getRole('equipe', true);
  const logs = interaction.options.getChannel('logs');

  if (role.id === interaction.guild.id) {
    return interaction.reply(ephemeral('Selecione um cargo de equipe específico, não @everyone.'));
  }
  if (logs && logs.id === category.id) {
    return interaction.reply(ephemeral('Canal de logs inválido.'));
  }

  // Validar permissões do bot no canal de logs
  if (logs) {
    const permCheck = validateBotPermissions(logs, interaction.client.user);
    if (!permCheck.valid) {
      return interaction.reply(ephemeral(`⚠️ ${permCheck.error}`));
    }
  }

  // Garantir que guild existe
  runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
    [interaction.guildId, interaction.guild.name]);

  // Salvar configurações
  const settings = [
    ['category_id', category.id],
    ['staff_role_id', role.id],
    ['logs_channel_id', logs?.id || null]
  ];

  for (const [key, value] of settings) {
    runSql(
      'INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)',
      [interaction.guildId, 'tickets', key, value]
    );
  }

  // Habilitar módulo
  runSql(
    'INSERT OR REPLACE INTO modules (guild_id, module_name, enabled) VALUES (?, ?, 1)',
    [interaction.guildId, 'tickets']
  );

  log.info({ guildId: interaction.guildId }, 'Tickets configurados');

  return interaction.reply(ephemeral(
    `✅ Configurado! Categoria: ${category.name}; equipe: ${role.name}; logs: ${logs?.name || 'desativados'}. Use /painel-tickets.`
  ));
}

async function handlePanel(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.reply(ephemeral('Você precisa de Gerenciar Servidor.'));
  }

  const categoryId = getGuildSetting(interaction.guildId, 'category_id');
  if (!categoryId) {
    return interaction.reply(ephemeral('Use /configurar-tickets primeiro.'));
  }

  const target = interaction.options.getChannel('canal', true);
  if (!target.isTextBased()) {
    return interaction.reply(ephemeral('Escolha um canal de texto.'));
  }

  const title = interaction.options.getString('titulo') || 'Central de Atendimento';

  await target.send({
    embeds: [new EmbedBuilder()
      .setTitle('🎫 ' + title)
      .setDescription('Precisa de ajuda? Clique no botão abaixo e descreva o motivo.\nSerá criado um canal privado para você e a equipe.')
      .setColor(0x22c55e)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('crow:ticket:open')
        .setLabel('Abrir ticket')
        .setEmoji('🎫')
        .setStyle(ButtonStyle.Primary)
    )],
    allowedMentions: { parse: [] }
  });

  return interaction.reply(ephemeral(`Painel publicado no canal ${target.name}.`));
}

async function showOpeningModal(interaction) {
  const categoryId = getGuildSetting(interaction.guildId, 'category_id');
  if (!categoryId) {
    return interaction.reply(ephemeral('A equipe ainda não configurou o sistema de tickets.'));
  }

  const modal = new ModalBuilder()
    .setCustomId('crow:ticket:reason')
    .setTitle('Novo atendimento');

  const input = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Por que você precisa de atendimento?')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(5)
    .setMaxLength(700)
    .setRequired(true)
    .setPlaceholder('Descreva seu problema ou dúvida...');

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function createTicket(interaction, client) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const lockKey = `${guildId}:${userId}`;

  // Debounce: prevenir cliques duplos
  if (openingLocks.has(lockKey)) {
    return interaction.reply(ephemeral('Seu ticket já está sendo criado. Aguarde...'));
  }

  // Verificar ticket aberto (persistente no SQLite — sobrevive a reinícios)
  const existing = queryGet(
    "SELECT channel_id FROM tickets WHERE guild_id = ? AND owner_id = ? AND status = 'open'",
    [guildId, userId]
  );
  if (existing) {
    return interaction.reply(ephemeral(`Você já tem um ticket aberto: <#${existing.channel_id}>`));
  }

  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (!reason) {
    return interaction.reply(ephemeral('O motivo não pode ser vazio.'));
  }

  openingLocks.add(lockKey);

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const categoryId = getGuildSetting(guildId, 'category_id');
    const staffRoleId = getGuildSetting(guildId, 'staff_role_id');
    const logsChannelId = getGuildSetting(guildId, 'logs_channel_id');

    if (!categoryId) {
      openingLocks.delete(lockKey);
      return interaction.editReply('Configuração de tickets não encontrada. Contate um administrador.');
    }

    // Gerar sequência e nome do canal
    const seq = getNextTicketSeq(guildId);
    const channelName = `ticket-${seq}-${safeName(interaction.user.username)}`;

    // Criar canal com permissões corretas
    const guild = interaction.guild;
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks] },
        { id: userId, allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.AddReactions
        ]},
        ...(staffRoleId ? [{ id: staffRoleId, allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.AddReactions
        ]}] : [])
      ]
    });

    // Persistir ticket no SQLite
    runSql(
      `INSERT INTO tickets (guild_id, channel_id, ticket_seq, owner_id, type, status, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [guildId, channel.id, seq, userId, 'support', 'open', reason]
    );

    // Registrar evento de criação
    const ticketRow = queryGet("SELECT id FROM tickets WHERE channel_id = ?", [channel.id]);
    const ticketId = ticketRow ? Number(ticketRow.id) : 0;
    runSql(
      "INSERT INTO ticket_events (ticket_id, event_type, actor_id, detail) VALUES (?, ?, ?, ?)",
      [ticketId, 'created', userId, reason]
    );

    // Mensagem inicial no canal do ticket
    const embed = new EmbedBuilder()
      .setTitle(`🎫 Ticket #${seq}`)
      .setDescription(`**Motivo:** ${reason}\n\nOlá <@${userId}>! A equipe foi notificada e responderá em breve.\nEnquanto isso, descreva mais detalhes se necessário.`)
      .setColor(0x22c55e)
      .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('crow:ticket:claim')
        .setLabel('Assumir')
        .setEmoji('🙋')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('crow:ticket:close')
        .setLabel('Fechar')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger)
    );

    const controls = await channel.send({
      content: `<@${userId}> ${staffRoleId ? `<@&${staffRoleId}>` : ''}`,
      embeds: [embed],
      components: [buttons],
      allowedMentions: { parse: ['users', 'roles'] }
    });

    runSql('INSERT INTO ticket_controls(ticket_id,message_id) VALUES (?,?)',[ticketId,controls.id]);

    // Log
    await sendLog(guild, logsChannelId, 'Ticket criado',
      `Canal: ${channel.name}\nUsuário: <@${userId}>\nMotivo: ${reason}`);

    log.info({ guildId, channelId: channel.id, seq, userId }, 'Ticket criado');
    await interaction.editReply(`Ticket criado: ${channel}`);
  } catch (err) {
    log.error({ err, guildId, userId }, 'Erro ao criar ticket');
    try {
      await interaction.editReply('Erro ao criar ticket. Tente novamente ou contate um administrador.');
    } catch { /* ignore */ }
  } finally {
    openingLocks.delete(lockKey);
  }
}

async function claimTicket(interaction) {
  const staffRoleId = getGuildSetting(interaction.guildId, 'staff_role_id');
  if (!isStaff(interaction, staffRoleId)) {
    return interaction.reply(ephemeral('Apenas a equipe pode assumir tickets.'));
  }

  const ticket = queryGet(
    "SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'",
    [interaction.channelId]
  );
  if (!ticket) {
    return interaction.reply(ephemeral('Este canal não é um ticket aberto.'));
  }
  if (ticket.claimed_by) {
    return interaction.reply(ephemeral(`Ticket já assumido por <@${ticket.claimed_by}>.`));
  }

  runSql(
    "UPDATE tickets SET claimed_by = ?, updated_at = datetime('now') WHERE id = ?",
    [interaction.user.id, ticket.id]
  );
  runSql(
    "INSERT INTO ticket_events (ticket_id, event_type, actor_id, detail) VALUES (?, ?, ?, ?)",
    [ticket.id, 'claimed', interaction.user.id, null]
  );

  log.info({ ticketId: ticket.id, claimedBy: interaction.user.id }, 'Ticket assumido');
  return interaction.reply({ content: `🙋 <@${interaction.user.id}> assumiu este ticket.`, allowedMentions: { parse: ['users'] } });
}

async function closeTicket(interaction) {
  const staffRoleId = getGuildSetting(interaction.guildId, 'staff_role_id');
  const ticket = queryGet(
    "SELECT * FROM tickets WHERE channel_id = ?",
    [interaction.channelId]
  );

  if (!ticket) {
    return interaction.reply(ephemeral('Este canal não é um ticket.'));
  }
  if (ticket.status !== 'open') {
    return interaction.reply(ephemeral('Este ticket já está fechado.'));
  }

  // Dono ou staff podem fechar
  const canClose = interaction.user.id === ticket.owner_id || isStaff(interaction, staffRoleId);
  if (!canClose) {
    return interaction.reply(ephemeral('Apenas o autor ou a equipe podem fechar o ticket.'));
  }

  await interaction.deferReply();

  // Remover permissão de envio do dono (preserva leitura do histórico)
  try {
    await interaction.channel.permissionOverwrites.edit(ticket.owner_id, {
      SendMessages: false
    });
  } catch (err) {
    log.warn({ err, channelId: interaction.channelId }, 'Falha ao remover permissão de envio do dono');
    return interaction.editReply('Não foi possível ajustar o acesso do autor. Confira as permissões e tente fechar novamente.');
  }

  // Atualizar botões (desabilitar)
  try {
    const disabledButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('crow:ticket:claim')
        .setLabel('Assumir')
        .setEmoji('🙋')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('crow:ticket:close')
        .setLabel('Fechado')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true)
    );
    const stored = queryGet('SELECT message_id FROM ticket_controls WHERE ticket_id=?',[ticket.id]);
    const matches = message => message?.author?.id === interaction.client.user.id &&
      message.components.some(row => row.components.some(button => button.customId === 'crow:ticket:close'));
    let message;
    if (stored) {
      try { message = await interaction.channel.messages.fetch(stored.message_id); }
      catch (err) { if (err.code !== 10008) throw err; }
    } else if (matches(interaction.message)) {
      message = interaction.message;
    } else {
      const first = await interaction.channel.messages.fetch({limit:100, after:'0'});
      message = first.find(matches);
    }
    if (message) await message.edit({components:[disabledButtons]});
  } catch (err) {
    log.warn({err,channelId:interaction.channelId},'Falha ao atualizar os controles');
    return interaction.editReply('Não foi possível atualizar os botões. Tente fechar o ticket novamente.');
  }

  const change = runSql(
    "UPDATE tickets SET status = 'closed', closed_at = datetime('now'), closed_by = ?, updated_at = datetime('now') WHERE id = ? AND status = 'open'",
    [interaction.user.id, ticket.id]
  );
  if (!change.changes) return interaction.editReply('Este ticket já está fechado.');
  runSql(
    "INSERT INTO ticket_events (ticket_id, event_type, actor_id, detail) VALUES (?, ?, ?, ?)",
    [ticket.id, 'closed', interaction.user.id, null]
  );

  const logsChannelId = getGuildSetting(interaction.guildId, 'logs_channel_id');
  await sendLog(interaction.guild, logsChannelId, 'Ticket fechado',
    `Canal: <#${interaction.channelId}>\nFechado por: <@${interaction.user.id}>`);

  log.info({ ticketId: ticket.id, closedBy: interaction.user.id }, 'Ticket fechado');
  await interaction.editReply('🔒 Ticket encerrado. O histórico permanece disponível para consulta.');
}

async function changeParticipant(interaction, remove) {
  const staffRoleId = getGuildSetting(interaction.guildId, 'staff_role_id');
  if (!isStaff(interaction, staffRoleId)) {
    return interaction.reply(ephemeral('Apenas a equipe pode alterar participantes.'));
  }

  const ticket = queryGet(
    "SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'",
    [interaction.channelId]
  );
  if (!ticket) {
    return interaction.reply(ephemeral('Este canal não é um ticket aberto.'));
  }

  const targetUser = interaction.options.getUser('usuario', true);

  if (remove) {
    if (targetUser.id === ticket.owner_id) {
      return interaction.reply(ephemeral('Não é possível remover o dono do ticket.'));
    }
    try {
      await interaction.channel.permissionOverwrites.delete(targetUser.id);
    } catch { /* ignore */ }
    runSql("DELETE FROM ticket_participants WHERE ticket_id = ? AND user_id = ?", [ticket.id, targetUser.id]);
    runSql(
      "INSERT INTO ticket_events (ticket_id, event_type, actor_id, detail) VALUES (?, ?, ?, ?)",
      [ticket.id, 'participant_removed', interaction.user.id, targetUser.id]
    );
    return interaction.reply(ephemeral(`${targetUser.username} removido do ticket.`));
  } else {
    try {
      await interaction.channel.permissionOverwrites.edit(targetUser.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        AddReactions: true
      });
    } catch (err) {
      log.warn({ err }, 'Falha ao adicionar permissões de participante');
      return interaction.reply(ephemeral('Falha ao adicionar participante. Verifique as permissões do bot.'));
    }
    runSql(
      'INSERT OR IGNORE INTO ticket_participants (ticket_id, user_id, added_by) VALUES (?, ?, ?)',
      [ticket.id, targetUser.id, interaction.user.id]
    );
    runSql(
      "INSERT INTO ticket_events (ticket_id, event_type, actor_id, detail) VALUES (?, ?, ?, ?)",
      [ticket.id, 'participant_added', interaction.user.id, targetUser.id]
    );
    return interaction.reply(ephemeral(`${targetUser.username} adicionado ao ticket.`));
  }
}

async function ticketStatus(interaction) {
  const ticket = queryGet(
    "SELECT * FROM tickets WHERE channel_id = ?",
    [interaction.channelId]
  );
  if (!ticket) {
    return interaction.reply(ephemeral('Este canal não é um ticket.'));
  }

  const participants = queryAll(
    'SELECT user_id FROM ticket_participants WHERE ticket_id = ?',
    [ticket.id]
  );
  const events = queryAll(
    'SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 10',
    [ticket.id]
  );

  const embed = new EmbedBuilder()
    .setTitle(`📋 Ticket #${ticket.ticket_seq}`)
    .addFields(
      { name: 'Status', value: ticket.status === 'open' ? '🟢 Aberto' : '🔴 Fechado', inline: true },
      { name: 'Prioridade', value: ticket.priority || 'normal', inline: true },
      { name: 'Autor', value: `<@${ticket.owner_id}>`, inline: true },
      { name: 'Assumido por', value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : '—', inline: true },
      { name: 'Criado em', value: ticket.created_at?.slice(0, 19).replace('T', ' ') || '—', inline: true },
      { name: 'Participantes', value: participants.length > 0 ? participants.map(p => `<@${p.user_id}>`).join(', ') : '—' },
      { name: 'Motivo', value: (ticket.reason || '—').slice(0, 1024) }
    )
    .setColor(ticket.status === 'open' ? 0x22c55e : 0x8b8fa3)
    .setTimestamp();

  if (events.length > 0) {
    const eventLog = events.map(e =>
      `\`${e.event_type}\` por <@${e.actor_id}> em ${(e.created_at || '').slice(0, 16)}`
    ).join('\n');
    embed.addFields({ name: 'Histórico recente', value: eventLog.slice(0, 1024) });
  }

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// === Contrato do Módulo ===

let context = null;

module.exports = {
  name: 'tickets',
  getCommands,

  async init(ctx) {
    context = ctx;
    log.info('Módulo Tickets inicializado');
  },

  async start() {
    if (!context?.bus) return;

    // Roteamento de interações via event bus
    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;

      // Botões
      if (interaction.isButton()) {
        if (interaction.customId === 'crow:ticket:open') return showOpeningModal(interaction);
        if (interaction.customId === 'crow:ticket:claim') return claimTicket(interaction);
        if (interaction.customId === 'crow:ticket:close') return closeTicket(interaction);
        return;
      }

      // Modal de criação
      if (interaction.isModalSubmit() && interaction.customId === 'crow:ticket:reason') {
        return createTicket(interaction, context.client);
      }

      // Comandos slash
      if (!interaction.isChatInputCommand()) return;

      switch (interaction.commandName) {
        case 'configurar-tickets': return handleConfig(interaction);
        case 'painel-tickets': return handlePanel(interaction);
        case 'ticket': {
          const sub = interaction.options.getSubcommand();
          switch (sub) {
            case 'assumir': return claimTicket(interaction);
            case 'fechar': return closeTicket(interaction);
            case 'adicionar': return changeParticipant(interaction, false);
            case 'remover': return changeParticipant(interaction, true);
            case 'status': return ticketStatus(interaction);
          }
        }
      }
    });

    log.info('Módulo Tickets iniciado — handlers registrados');
  },

  async stop() {
    log.info('Módulo Tickets parado');
  },

  health() {
    const openCount = queryGet("SELECT COUNT(*) as c FROM tickets WHERE status = 'open'");
    return {
      status: 'ok',
      openTickets: openCount ? Number(openCount.c) : 0,
      locksActive: openingLocks.size
    };
  }
};