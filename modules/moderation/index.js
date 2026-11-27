const { authorizeTarget } = require('./permissions');
"use strict";
const {
 EmbedBuilder, MessageFlags, PermissionFlagsBits
} = require('discord.js');
const { createChild, validateChannel, validateBotPermissions } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('moderation');

// === Helpers ===

function ephemeral(content) {
 return { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function getNextCaseNumber(guildId) {
 const row = queryGet(
 'SELECT COALESCE(MAX(case_number), 0) + 1 as next_num FROM moderation_cases WHERE guild_id = ?',
 [guildId]
 );
 return row ? Number(row.next_num) : 1;
}

async function sendLog(guild, logsChannelId, title, detail, color) {
 if (!logsChannelId) return;
 try {
 const channel = await guild.channels.fetch(logsChannelId);
 if (channel?.isTextBased()) {
 await channel.send({
 embeds: [new EmbedBuilder()
 .setTitle(title)
 .setDescription(detail.slice(0, 3500))
 .setColor(color || 0xef4444)
 .setTimestamp()],
 allowedMentions: { parse: [] }
 });
 }
 } catch (err) {
 log.warn({ err, logsChannelId }, 'Falha ao enviar log de moderação');
 }
}

function getGuildSetting(guildId, module, key) {
 const row = queryGet(
 'SELECT value FROM settings WHERE guild_id = ? AND module = ? AND key = ?',
 [guildId, module, key]
 );
 return row?.value || null;
}

// === Comandos Slash ===

function getCommands() {
 const { SlashCommandBuilder } = require('discord.js');
 return [
 new SlashCommandBuilder()
 .setName('moderar')
 .setDescription('Comandos de moderação.')
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
 .addSubcommand(s => s.setName('avisar').setDescription('Registra uma advertência')
 .addUserOption(o => o.setName('usuario').setDescription('Usuário advertido').setRequired(true))
 .addStringOption(o => o.setName('motivo').setDescription('Motivo da advertência').setRequired(true).setMaxLength(400)))
 .addSubcommand(s => s.setName('avisos').setDescription('Consulta advertências de um usuário')
 .addUserOption(o => o.setName('usuario').setDescription('Usuário consultado').setRequired(true)))
 .addSubcommand(s => s.setName('limpar').setDescription('Apaga até 100 mensagens recentes do canal')
 .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade de mensagens (1-100)').setMinValue(1).setMaxValue(100).setRequired(true)))
 .addSubcommand(s => s.setName('timeout').setDescription('Silencia temporariamente um membro')
 .addUserOption(o => o.setName('usuario').setDescription('Membro a silenciar').setRequired(true))
 .addIntegerOption(o => o.setName('duracao').setDescription('Duração em minutos (1-40320 = 28 dias)').setMinValue(1).setMaxValue(40320).setRequired(true))
 .addStringOption(o => o.setName('motivo').setDescription('Motivo do timeout').setRequired(false).setMaxLength(400)))
 .addSubcommand(s => s.setName('kick').setDescription('Expulsa um membro do servidor')
 .addUserOption(o => o.setName('usuario').setDescription('Membro a expulsar').setRequired(true))
 .addStringOption(o => o.setName('motivo').setDescription('Motivo da expulsão').setRequired(false).setMaxLength(400)))
 .addSubcommand(s => s.setName('ban').setDescription('Bane um membro do servidor')
 .addUserOption(o => o.setName('usuario').setDescription('Membro a banir').setRequired(true))
 .addStringOption(o => o.setName('motivo').setDescription('Motivo do banimento').setRequired(false).setMaxLength(400))
 .addIntegerOption(o => o.setName('dias').setDescription('Dias de mensagens a deletar (0-7)').setMinValue(0).setMaxValue(7).setRequired(false)))
 .addSubcommand(s => s.setName('configurar').setDescription('Configura o canal de logs da moderação.')
 .addChannelOption(o => o.setName('canal').setDescription('Canal para enviar logs de moderação').setRequired(true))),

 new SlashCommandBuilder()
 .setName('configurar-mod')
 .setDescription('Configura o canal de logs da moderação.')
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
 .addChannelOption(o => o.setName('canal').setDescription('Canal para enviar logs de moderação').setRequired(true))
 ];
}

// === Handlers ===

async function handleWarn(interaction) {
 const targetUser = interaction.options.getUser('usuario', true);
 const reason = interaction.options.getString('motivo', true).trim();

 if (!reason) {
 return interaction.reply(ephemeral('O motivo não pode ser vazio.'));
 }

 // Garantir que guild existe
 runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
 [interaction.guildId, interaction.guild.name]);

 const caseNum = getNextCaseNumber(interaction.guildId);

 runSql(
 'INSERT INTO moderation_cases (guild_id, case_number, type, target_user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))',
 [interaction.guildId, caseNum, 'warn', targetUser.id, interaction.user.id, reason]
 );

 // Log
 const logsChannelId = getGuildSetting(interaction.guildId, 'moderation', 'logs_channel_id');
 await sendLog(interaction.guild, logsChannelId, `Advertência #${caseNum}`,
 `Membro: <@${targetUser.id}>\nModerador: <@${interaction.user.id}>\nMotivo: ${reason}`);

 log.info({ guildId: interaction.guildId, caseNum, target: targetUser.id }, 'Advertência registrada');
 return interaction.reply(ephemeral(`⚠️ Advertência #${caseNum} registrada para ${targetUser.username}.`));
}

async function handleWarnings(interaction) {
 const targetUser = interaction.options.getUser('usuario', true);

 const cases = queryAll(
 "SELECT * FROM moderation_cases WHERE guild_id = ? AND target_user_id = ? ORDER BY case_number DESC LIMIT 10",
 [interaction.guildId, targetUser.id]
 );

 const totalRow = queryGet(
 "SELECT COUNT(*) as c FROM moderation_cases WHERE guild_id = ? AND target_user_id = ?",
 [interaction.guildId, targetUser.id]
 );
 const total = totalRow ? Number(totalRow.c) : 0;

 if (total === 0) {
 return interaction.reply(ephemeral(`${targetUser.username} não possui registros de moderação.`));
 }

 const lines = cases.map(c =>
 `**#${c.case_number}** [${c.type}] ${c.reason || 'Sem motivo'} — ${(c.created_at || '').slice(0, 10)}`
 ).join('\n');

 const embed = new EmbedBuilder()
 .setTitle(`📋 Registros de ${targetUser.username}`)
 .setDescription(lines.slice(0, 3900))
 .setFooter({ text: `Total: ${total} registro(s)` })
 .setColor(0xf59e0b)
 .setTimestamp();

 return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleClear(interaction) {
 const amount = interaction.options.getInteger('quantidade', true);

 await interaction.deferReply({ flags: MessageFlags.Ephemeral });

 try {
 const deleted = await interaction.channel.bulkDelete(amount, true);

 const logsChannelId = getGuildSetting(interaction.guildId, 'moderation', 'logs_channel_id');
 await sendLog(interaction.guild, logsChannelId, 'Limpeza de mensagens',
 `Canal: <#${interaction.channelId}>\nModerador: <@${interaction.user.id}>\nRemovidas: ${deleted.size}/${amount}`,
 0xf59e0b);

 log.info({ guildId: interaction.guildId, deleted: deleted.size, requested: amount }, 'Mensagens limpas');
 return interaction.editReply(`🧹 ${deleted.size} mensagem(ns) removida(s). Discord não permite remoção em lote de mensagens com mais de 14 dias.`);
 } catch (err) {
 log.error({ err }, 'Erro ao limpar mensagens');
 return interaction.editReply('Erro ao limpar mensagens. Verifique as permissões do bot.');
 }
}

async function handleTimeout(interaction) {
 const targetUser = interaction.options.getUser('usuario', true);
 const durationMin = interaction.options.getInteger('duracao', true);
 const reason = interaction.options.getString('motivo') || 'Timeout aplicado pela equipe';

 // Verificar hierarquia
 const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
 const denied = authorizeTarget(interaction, targetMember, 'timeout');
 if (denied) return interaction.reply(ephemeral(denied));

 try {
 const durationMs = durationMin * 60 * 1000;
 await targetMember.timeout(durationMs, reason);

 runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
 [interaction.guildId, interaction.guild.name]);

 const caseNum = getNextCaseNumber(interaction.guildId);
 runSql(
 'INSERT INTO moderation_cases (guild_id, case_number, type, target_user_id, moderator_id, reason, duration_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))',
 [interaction.guildId, caseNum, 'timeout', targetUser.id, interaction.user.id, reason, durationMin * 60]
 );

 const logsChannelId = getGuildSetting(interaction.guildId, 'moderation', 'logs_channel_id');
 await sendLog(interaction.guild, logsChannelId, `Timeout #${caseNum}`,
 `Membro: <@${targetUser.id}>\nModerador: <@${interaction.user.id}>\nDuração: ${durationMin} min\nMotivo: ${reason}`);

 log.info({ guildId: interaction.guildId, caseNum, target: targetUser.id, durationMin }, 'Timeout aplicado');
 return interaction.reply(ephemeral(`🔇 ${targetUser.username} silenciado por ${durationMin} minuto(s). Caso #${caseNum}.`));
 } catch (err) {
 log.error({ err }, 'Erro ao aplicar timeout');
 return interaction.reply(ephemeral(`Erro ao silenciar: ${err.message}`));
 }
}

async function handleKick(interaction) {
 const targetUser = interaction.options.getUser('usuario', true);
 const reason = interaction.options.getString('motivo') || 'Expulsão aplicada pela equipe';

 const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
 const denied = authorizeTarget(interaction, targetMember, 'kick');
 if (denied) return interaction.reply(ephemeral(denied));

 try {
 await targetMember.kick(reason);

 runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
 [interaction.guildId, interaction.guild.name]);

 const caseNum = getNextCaseNumber(interaction.guildId);
 runSql(
 'INSERT INTO moderation_cases (guild_id, case_number, type, target_user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))',
 [interaction.guildId, caseNum, 'kick', targetUser.id, interaction.user.id, reason]
 );

 const logsChannelId = getGuildSetting(interaction.guildId, 'moderation', 'logs_channel_id');
 await sendLog(interaction.guild, logsChannelId, `Expulsão #${caseNum}`,
 `Membro: <@${targetUser.id}> (${targetUser.username})\nModerador: <@${interaction.user.id}>\nMotivo: ${reason}`);

 log.info({ guildId: interaction.guildId, caseNum, target: targetUser.id }, 'Membro expulso');
 return interaction.reply(ephemeral(`👢 ${targetUser.username} foi expulso. Caso #${caseNum}.`));
 } catch (err) {
 log.error({ err }, 'Erro ao expulsar membro');
 return interaction.reply(ephemeral(`Erro ao expulsar: ${err.message}`));
 }
}

async function handleConfigMod(interaction) {
 const channel = interaction.options.getChannel('canal', true);

 // Validar tipo de canal
 if (!channel.isTextBased()) {
 return interaction.reply(ephemeral('❌ O canal deve ser um canal de texto.'));
 }

 // Validar permissões do bot no canal
 const permCheck = validateBotPermissions(channel, interaction.client.user);
 if (!permCheck.valid) {
 return interaction.reply(ephemeral(`⚠️ ${permCheck.error}`));
 }

 runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
 [interaction.guildId, interaction.guild.name]);

 runSql(
 'INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)',
 [interaction.guildId, 'moderation', 'logs_channel_id', channel.id]
 );

 log.info({ guildId: interaction.guildId, channelId: channel.id }, 'Canal de logs da moderação configurado');
 return interaction.reply(ephemeral(`✅ Canal de logs da moderação definido para <#${channel.id}>.`));
}

async function handleBan(interaction) {
 const targetUser = interaction.options.getUser('usuario', true);
 const reason = interaction.options.getString('motivo') || 'Banimento aplicado pela equipe';
 const deleteDays = interaction.options.getInteger('dias') || 0;

 // Verificar hierarquia mesmo para membros fora do servidor
 const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
 const denied = authorizeTarget(interaction, targetMember, 'ban');
 if (denied) return interaction.reply(ephemeral(denied));

 try {
 await interaction.guild.members.ban(targetUser, {
 deleteMessageSeconds: deleteDays * 86400,
 reason
 });

 runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
 [interaction.guildId, interaction.guild.name]);

 const caseNum = getNextCaseNumber(interaction.guildId);
 runSql(
 'INSERT INTO moderation_cases (guild_id, case_number, type, target_user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))',
 [interaction.guildId, caseNum, 'ban', targetUser.id, interaction.user.id, reason]
 );

 const logsChannelId = getGuildSetting(interaction.guildId, 'moderation', 'logs_channel_id');
 await sendLog(interaction.guild, logsChannelId, `Banimento #${caseNum}`,
 `Membro: <@${targetUser.id}> (${targetUser.username})\nModerador: <@${interaction.user.id}>\nDias de mensagens deletadas: ${deleteDays}\nMotivo: ${reason}`);

 log.info({ guildId: interaction.guildId, caseNum, target: targetUser.id }, 'Membro banido');
 return interaction.reply(ephemeral(`🔨 ${targetUser.username} foi banido. Caso #${caseNum}.`));
 } catch (err) {
 log.error({ err }, 'Erro ao banir membro');
 return interaction.reply(ephemeral(`Erro ao banir: ${err.message}`));
 }
}

// === Contrato do Módulo ===

let context = null;

module.exports = {
 name: 'moderation',
 getCommands,

 async init(ctx) {
 context = ctx;
 log.info('Módulo Moderação inicializado');
 },

 async start() {
 if (!context?.bus) return;

 context.bus.on('interaction:create', async ({ interaction }) => {
 if (!interaction.inGuild()) return;
 if (!interaction.isChatInputCommand()) return;

 // Comando standalone /configurar-mod
 if (interaction.commandName === 'configurar-mod') {
 return handleConfigMod(interaction);
 }

 if (interaction.commandName !== 'moderar') return;

 const sub = interaction.options.getSubcommand();

 // Subcommand configurar dentro de /moderar
 if (sub === 'configurar') {
 return handleConfigMod(interaction);
 }

 if (['avisar', 'avisos', 'limpar'].includes(sub) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages))
 return interaction.reply(ephemeral('Você precisa da permissão Gerenciar mensagens.'));
 switch (sub) {
 case 'avisar': return handleWarn(interaction);
 case 'avisos': return handleWarnings(interaction);
 case 'limpar': return handleClear(interaction);
 case 'timeout': return handleTimeout(interaction);
 case 'kick': return handleKick(interaction);
 case 'ban': return handleBan(interaction);
 }
 });

 log.info('Módulo Moderação iniciado — handlers registrados');
 },

 async stop() {
 log.info('Módulo Moderação parado');
 },

 health() {
 const totalCases = queryGet("SELECT COUNT(*) as c FROM moderation_cases");
 return {
 status: 'ok',
 totalCases: totalCases ? Number(totalCases.c) : 0
 };
 }
};