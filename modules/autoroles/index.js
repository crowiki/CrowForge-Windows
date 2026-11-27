"use strict";
const {assignable,canConfigure}=require("../../packages/core/role-policy");
const { EmbedBuilder, MessageFlags, Events, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('autoroles');

// Configuração padrão
const DEFAULT_SETTINGS = {
 enabled: false,
 mode: 'all', // 'all' = dá todos os cargos na entrada | 'choice' = painel de escolha
 role_ids: '[]', // JSON array de role IDs
 channel_id: null // canal para painel de escolha (modo 'choice')
};

function getGuildSetting(guildId, key) {
 const row = queryGet(
 "SELECT value FROM settings WHERE guild_id = ? AND module = 'autoroles' AND key = ?",
 [guildId, key]
 );
 return row?.value ?? DEFAULT_SETTINGS[key];
}

function getSettings(guildId) {
 return {
 enabled: getGuildSetting(guildId, 'enabled') === 'true',
 mode: getGuildSetting(guildId, 'mode'),
 role_ids: JSON.parse(getGuildSetting(guildId, 'role_ids')),
 channel_id: getGuildSetting(guildId, 'channel_id')
};
}

// === Seed do schema ===
function ensureSchema() {
 // Usa a tabela settings existente (guild_id, module, key, value)
 // Nenhum schema adicional necessário
}

// === Comandos Slash ===

function getCommands() {
 const { SlashCommandBuilder } = require('discord.js');
 return [
 new SlashCommandBuilder()
 .setName('configurar-autoroles')
 .setDescription('Configura cargos automáticos para novos membros.')
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
 .addBooleanOption(o => o.setName('habilitado').setDescription('Ativar ou desativar cargos automáticos').setRequired(true))
 .addStringOption(o => o.setName('modo').setDescription('Modo de distribuição').addChoices(
 { name: 'Todos na entrada', value: 'all' },
 { name: 'Painel de escolha', value: 'choice' }
 ))
 .addRoleOption(o => o.setName('cargo1').setDescription('Primeiro cargo'))
 .addRoleOption(o => o.setName('cargo2').setDescription('Segundo cargo'))
 .addRoleOption(o => o.setName('cargo3').setDescription('Terceiro cargo'))
 .addRoleOption(o => o.setName('cargo4').setDescription('Quarto cargo'))
 .addRoleOption(o => o.setName('cargo5').setDescription('Quinto cargo'))
 .addChannelOption(o => o.setName('canal').setDescription('Canal para o painel de escolha (modo choice)'))
 ];
}

// === Handlers ===

async function handleConfig(interaction) {
 if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles))
   return interaction.reply({content:'Você precisa gerenciar o servidor e os cargos.',flags:MessageFlags.Ephemeral});
 const enabled = interaction.options.getBoolean('habilitado', true);
 const mode = interaction.options.getString('modo') ?? DEFAULT_SETTINGS.mode;
 const channel = interaction.options.getChannel('canal');

 // Coletar cargos informados
 const roles = [];
 for (let i = 1; i <= 5; i++) {
 const role = interaction.options.getRole(`cargo${i}`);
 if (role && !canConfigure(interaction,role)) return interaction.reply({content:'Escolha um cargo comum abaixo do seu e do bot.',flags:MessageFlags.Ephemeral});
 if (role) roles.push(role.id);
 }

 // Se não informou cargos, manter os existentes
 const existingRoles = JSON.parse(getGuildSetting(interaction.guildId, 'role_ids'));
 const finalRoles = roles.length > 0 ? roles : existingRoles;

 // Garantir que guild existe
 runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
 [interaction.guildId, interaction.guild.name]);

 // Salvar configurações
 const settings = [
 ['enabled', String(enabled)],
 ['mode', mode],
 ['role_ids', JSON.stringify(finalRoles)],
 ['channel_id', channel?.id || getGuildSetting(interaction.guildId, 'channel_id')]
 ];

 for (const [key, value] of settings) {
 runSql(
 'INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)',
 [interaction.guildId, 'autoroles', key, value]
 );
 }

 log.info({ guildId: interaction.guildId, enabled, mode, roles: finalRoles }, 'Auto-roles configurado');

 const status = enabled ? '✅ Ativado' : '❌ Desativado';
 const modeLabel = mode === 'all' ? 'Todos na entrada' : 'Painel de escolha';
 const roleNames = finalRoles.map(id => `<@&${id}>`).join(', ') || 'Nenhum cargo configurado';

 const reply = {
 content: `**Auto-Roles ${status}**\n• Modo: ${modeLabel}\n• Cargos: ${roleNames}${channel ? `\n• Canal do painel: ${channel.name}` : ''}`,
 flags: MessageFlags.Ephemeral
 };

 await interaction.reply(reply);

 // Se modo choice e canal definido, enviar painel
 if (enabled && mode === 'choice' && channel?.id) {
 await sendChoicePanel(interaction.guild, channel, finalRoles);
 }
}

async function sendChoicePanel(guild, channel, roleIds) {
 try {
 const targetChannel = await guild.channels.fetch(channel.id || channel);
 if (!targetChannel?.isTextBased()) return;

 const roleNames = roleIds.map(id => {
 const role = guild.roles.cache.get(id);
 return role ? `**${role.name}**` : `cargo desconhecido`;
 });

 const embed = new EmbedBuilder()
 .setTitle('🎭 Escolha seus Cargos')
 .setDescription(`Clique nos botões abaixo para receber seus cargos:\n${roleNames.map((name, i) => `${i + 1}. ${name}`).join('\n')}`)
 .setColor(0x63d2a3)
 .setFooter({ text: 'Clique novamente para remover o cargo' });

 const buttons = roleIds.slice(0, 5).map((roleId, i) => {
 const role = guild.roles.cache.get(roleId);
 return new ButtonBuilder()
 .setCustomId(`autoroles:toggle:${roleId}`)
 .setLabel(role?.name || `Cargo ${i + 1}`)
 .setStyle(ButtonStyle.Secondary)
 .setEmoji(role?.icon ? undefined : '🏷️');
 });

 const row = new ActionRowBuilder().addComponents(buttons);

 await targetChannel.send({ embeds: [embed], components: [row] });
 log.info({ guildId: guild.id, channelId: targetChannel.id }, 'Painel de escolha de cargos enviado');
 } catch (err) {
 log.error({ err }, 'Falha ao enviar painel de escolha');
 }
}

// === Listener de GuildMemberAdd ===

async function handleMemberAdd(member) {
  if (!require("../state").isEnabled(member.guild.id, "autoroles")) return;
 const settings = getSettings(member.guild.id);
 if (!settings.enabled || settings.mode !== 'all') return;
 if (settings.role_ids.length === 0) return;

 for (const roleId of settings.role_ids) {
 try {
 if (!assignable(member.guild.roles.cache.get(roleId))) continue;
 await member.roles.add(roleId, 'Auto-roles: atribuição na entrada');
 } catch (err) {
 log.warn({ err, guildId: member.guild.id, roleId, userId: member.id }, 'Falha ao atribuir cargo automático');
 }
 }

 log.info({ guildId: member.guild.id, userId: member.id, roles: settings.role_ids }, 'Cargos automáticos atribuídos');
}

// === Listener de interação de botão (modo choice) ===

async function handleButtonInteraction(interaction) {
 if (!interaction.customId.startsWith('autoroles:toggle:')) return;

 const roleId = interaction.customId.split(':')[2];
 const settings = getSettings(interaction.guildId);
 if (!settings.enabled || settings.mode !== 'choice') {
 return interaction.reply({ content: 'Auto-roles não está ativo neste servidor.', flags: MessageFlags.Ephemeral });
 }

 if (!settings.role_ids.includes(roleId)) {
 return interaction.reply({ content: 'Este cargo não está mais disponível.', flags: MessageFlags.Ephemeral });
 }

 const member = interaction.member;
 if (!assignable(member.guild.roles.cache.get(roleId))) return interaction.reply({content:'Cargo indisponível.',flags:MessageFlags.Ephemeral});
 const hasRole = member.roles.cache.has(roleId);

 try {
 if (hasRole) {
 await member.roles.remove(roleId, 'Auto-roles: removido via painel');
 const role = interaction.guild.roles.cache.get(roleId);
 return interaction.reply({ content: `Cargo **${role?.name || roleId}** removido.`, flags: MessageFlags.Ephemeral });
 } else {
 await member.roles.add(roleId, 'Auto-roles: adicionado via painel');
 const role = interaction.guild.roles.cache.get(roleId);
 return interaction.reply({ content: `Cargo **${role?.name || roleId}** adicionado!`, flags: MessageFlags.Ephemeral });
 }
 } catch (err) {
 log.error({ err, guildId: interaction.guildId, roleId }, 'Erro ao alternar cargo via painel');
 return interaction.reply({ content: 'Erro ao processar sua solicitação. Tente novamente.', flags: MessageFlags.Ephemeral });
 }
}

// === Contrato do Módulo ===

let context = null;
let _memberAddHandler = null;

module.exports = {
 name: 'autoroles',
 getCommands,

 async init(ctx) {
 context = ctx;
 ensureSchema();
 log.info('Módulo Auto-Roles inicializado');
 },

 async start() {
 if (!context?.client) return;

 _memberAddHandler = (member) => {
 try {
 handleMemberAdd(member);
 } catch (err) {
 log.error({ err }, 'Erro no handler de auto-roles (memberAdd)');
 }
 };
 context.client.on(Events.GuildMemberAdd, _memberAddHandler);

 if (context.bus) {
 context.bus.on('interaction:create', async ({ interaction }) => {
 if (!interaction.inGuild()) return;

 if (interaction.isChatInputCommand() && interaction.commandName === 'configurar-autoroles') {
 return handleConfig(interaction);
 }

 if (interaction.isButton()) {
 return handleButtonInteraction(interaction);
 }
 });
 }

 log.info('Módulo Auto-Roles iniciado — listeners registrados');
 },

 async stop() {
 if (context?.client && _memberAddHandler) {
 context.client.off(Events.GuildMemberAdd, _memberAddHandler);
 _memberAddHandler = null;
 }
 log.info('Módulo Auto-Roles parado');
 },

 health() {
 return {
 status: 'ok'
 };
 }
};