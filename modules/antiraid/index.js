"use strict";
const { EmbedBuilder, MessageFlags, Events, PermissionFlagsBits } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('antiraid');

// Configuração padrão
const DEFAULT_SETTINGS = {
 enabled: false,
 max_joins_per_minute: 10, // Máximo de entradas por minuto
 account_age_days: 7, // Idade mínima da conta em dias
 action: 'kick', // 'kick' | 'ban' | 'timeout'
 log_channel_id: null
};

// Cache de entradas recentes por guild (guildId -> [{userId, timestamp}])
const recentJoins = new Map();

function getGuildSetting(guildId, key) {
 const row = queryGet(
 "SELECT value FROM settings WHERE guild_id = ? AND module = 'antiraid' AND key = ?",
 [guildId, key]
 );
 return row?.value ?? DEFAULT_SETTINGS[key];
}

function getSettings(guildId) {
 return {
 enabled: getGuildSetting(guildId, 'enabled') === 'true',
 max_joins_per_minute: Number(getGuildSetting(guildId, 'max_joins_per_minute')),
 account_age_days: Number(getGuildSetting(guildId, 'account_age_days')),
 action: getGuildSetting(guildId, 'action'),
 log_channel_id: getGuildSetting(guildId, 'log_channel_id')
};
}

async function logRaidEvent(guild, settings, member, reason) {
 if (!settings.log_channel_id) return;
 try {
 const channel = await guild.channels.fetch(settings.log_channel_id);
 if (!channel?.isTextBased()) return;

 const embed = new EmbedBuilder()
 .setTitle('🛡️ Anti-Raid: Ação Executada')
 .setDescription(`**Usuário:** ${member.user.tag} (${member.id})\n**Motivo:** ${reason}\n**Ação:** ${settings.action}`)
 .setColor(0xf87171)
 .setTimestamp()
 .setThumbnail(member.user.displayAvatarURL({ size: 128 }));

 await channel.send({ embeds: [embed] });
 } catch (err) {
 log.warn({ err, guildId: guild.id }, 'Falha ao enviar log de anti-raid');
 }
}

function isAccountTooNew(user, minDays) {
 const accountAge = Date.now() - user.createdTimestamp;
 const minAgeMs = minDays * 24 * 60 * 60 * 1000;
 return accountAge < minAgeMs;
}

function checkJoinFlood(guildId, userId) {
 const now = Date.now();
 const window = 60 * 1000; // 1 minuto

 if (!recentJoins.has(guildId)) {
 recentJoins.set(guildId, []);
 }

 const joins = recentJoins.get(guildId);

 // Remover entradas antigas (mais de 1 minuto)
 while (joins.length > 0 && joins[0].timestamp < now - window) {
 joins.shift();
 }

 // Adicionar entrada atual
 joins.push({ userId, timestamp: now });

 return joins.length;
}

// === Comandos Slash ===

function getCommands() {
 const { SlashCommandBuilder } = require('discord.js');
 return [
 new SlashCommandBuilder()
 .setName('configurar-antiraid')
 .setDescription('Configura proteção contra ataques de entrada em massa.')
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
 .addBooleanOption(o => o.setName('habilitado').setDescription('Ativar ou desativar o anti-raid').setRequired(true))
 .addIntegerOption(o => o.setName('max-entradas').setDescription('Máximo de entradas por minuto (padrão: 10)').setMinValue(1).setMaxValue(100))
 .addIntegerOption(o => o.setName('idade-minima').setDescription('Idade mínima da conta em dias (padrão: 7)').setMinValue(0).setMaxValue(365))
 .addStringOption(o => o.setName('acao').setDescription('Ação a tomar (padrão: kick)').addChoices(
 { name: 'Expulsar (Kick)', value: 'kick' },
 { name: 'Banir (Ban)', value: 'ban' },
 { name: 'Timeout (1h)', value: 'timeout' }
 ))
 .addChannelOption(o => o.setName('logs').setDescription('Canal para logs de eventos anti-raid'))
 ];
}

// === Handlers ===

async function handleConfig(interaction) {
 const enabled = interaction.options.getBoolean('habilitado', true);
 const maxJoins = interaction.options.getInteger('max-entradas') ?? DEFAULT_SETTINGS.max_joins_per_minute;
 const minAge = interaction.options.getInteger('idade-minima') ?? DEFAULT_SETTINGS.account_age_days;
 const action = interaction.options.getString('acao') ?? DEFAULT_SETTINGS.action;
 const required={kick:PermissionFlagsBits.KickMembers,ban:PermissionFlagsBits.BanMembers,timeout:PermissionFlagsBits.ModerateMembers}[action];
 if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || !required || !interaction.memberPermissions.has(required))
 return interaction.reply({content:'Você precisa da permissão correspondente à ação escolhida.',flags:MessageFlags.Ephemeral});
 const logChannel = interaction.options.getChannel('logs');

 // Garantir que guild existe
 runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
 [interaction.guildId, interaction.guild.name]);

 // Salvar configurações
 const settings = [
 ['enabled', String(enabled)],
 ['max_joins_per_minute', String(maxJoins)],
 ['account_age_days', String(minAge)],
 ['action', action],
 ['log_channel_id', logChannel?.id || null]
 ];

 for (const [key, value] of settings) {
 runSql(
 'INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)',
 [interaction.guildId, 'antiraid', key, value]
 );
 }

 log.info({ guildId: interaction.guildId, enabled }, 'Anti-Raid configurado');

 const status = enabled ? '✅ Ativado' : '❌ Desativado';
 const logInfo = logChannel ? `Logs: ${logChannel.name}` : 'Logs desativados';

 return interaction.reply({
 content: `**Anti-Raid ${status}**\n• Máximo de entradas: ${maxJoins}/min\n• Idade mínima: ${minAge} dias\n• Ação: ${action}\n• ${logInfo}`,
 flags: MessageFlags.Ephemeral
 });
}

// === Listener de GuildMemberAdd ===

async function handleMemberJoin(member) {
  if (!require("../state").isEnabled(member.guild.id, "antiraid")) return;
 const settings = getSettings(member.guild.id);
 if (!settings.enabled) return;

 // Verificar idade da conta
 if (isAccountTooNew(member.user, settings.account_age_days)) {
 const ageDays = Math.floor((Date.now() - member.user.createdTimestamp) / (24 * 60 * 60 * 1000));
 const reason = `Conta muito nova (${ageDays} dias, mínimo: ${settings.account_age_days})`;

 try {
 if (settings.action === 'kick') {
 await member.kick(reason);
 } else if (settings.action === 'ban') {
 await member.ban({ reason, deleteMessageSeconds: 0 });
 } else if (settings.action === 'timeout') {
 await member.timeout(60 * 60 * 1000, reason); // 1 hora
 }
 await logRaidEvent(member.guild, settings, member, reason);
 log.warn({ guildId: member.guild.id, userId: member.id, reason }, 'Anti-Raid: ação executada');
 } catch (err) {
 log.error({ err, guildId: member.guild.id, userId: member.id }, 'Falha ao executar ação anti-raid');
 }
 return;
 }

 // Verificar flood de entradas
 const joinCount = checkJoinFlood(member.guild.id, member.id);
 if (joinCount > settings.max_joins_per_minute) {
 const reason = `Flood de entradas detectado (${joinCount} entradas em 1 minuto, máximo: ${settings.max_joins_per_minute})`;

 try {
 if (settings.action === 'kick') {
 await member.kick(reason);
 } else if (settings.action === 'ban') {
 await member.ban({ reason, deleteMessageSeconds: 0 });
 } else if (settings.action === 'timeout') {
 await member.timeout(60 * 60 * 1000, reason);
 }
 await logRaidEvent(member.guild, settings, member, reason);
 log.warn({ guildId: member.guild.id, userId: member.id, reason }, 'Anti-Raid: flood detectado');
 } catch (err) {
 log.error({ err, guildId: member.guild.id, userId: member.id }, 'Falha ao executar ação anti-raid (flood)');
 }
 }
}

// === Contrato do Módulo ===

let context = null;
let _memberAddHandler = null;

module.exports = {
 name: 'antiraid',
 getCommands,

 async init(ctx) {
 context = ctx;
 log.info('Módulo Anti-Raid inicializado');
 },

 async start() {
 if (!context?.client) return;

 _memberAddHandler = (member) => {
 try {
 handleMemberJoin(member);
 } catch (err) {
 log.error({ err }, 'Erro no handler de anti-raid');
 }
 };
 context.client.on(Events.GuildMemberAdd, _memberAddHandler);

 if (context.bus) {
 context.bus.on('interaction:create', async ({ interaction }) => {
 if (!interaction.inGuild() || !interaction.isChatInputCommand()) return;
 if (interaction.commandName === 'configurar-antiraid') {
 return handleConfig(interaction);
 }
 });
 }

 log.info('Módulo Anti-Raid iniciado — listeners registrados');
 },

 async stop() {
 if (context?.client && _memberAddHandler) {
 context.client.off(Events.GuildMemberAdd, _memberAddHandler);
 _memberAddHandler = null;
 }
 recentJoins.clear();
 log.info('Módulo Anti-Raid parado');
 },

 health() {
 return {
 status: 'ok',
 activeGuilds: recentJoins.size
 };
 }
};