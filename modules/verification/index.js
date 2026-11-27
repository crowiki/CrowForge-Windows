"use strict";
const {assignable,canConfigure}=require("../../packages/core/role-policy");
const { EmbedBuilder, MessageFlags, Events, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('verification');

// Configuração padrão
const DEFAULT_SETTINGS = {
 enabled: false,
 channel_id: null,
 verified_role_id: null,
 unverified_role_id: null, // cargo opcional para não verificados (ex: restringir canais)
 rules_text: '**Regras do Servidor**\n1. Respeite todos os membros\n2. Sem spam ou flood\n3. Conteúdo apropriado\n4. Siga as Diretrizes do Discord\n5. Divirta-se!',
 captcha_enabled: 'true',
 log_channel_id: null
};

// Cache de usuários pendentes (guildId:userId -> {expires, attempts})
const pendingVerifications = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutos

function getGuildSetting(guildId, key) {
 const row = queryGet(
 "SELECT value FROM settings WHERE guild_id = ? AND module = 'verification' AND key = ?",
 [guildId, key]
 );
 return row?.value ?? DEFAULT_SETTINGS[key];
}

function getSettings(guildId) {
 return {
 enabled: getGuildSetting(guildId, 'enabled') === 'true',
 channel_id: getGuildSetting(guildId, 'channel_id'),
 verified_role_id: getGuildSetting(guildId, 'verified_role_id'),
 unverified_role_id: getGuildSetting(guildId, 'unverified_role_id'),
 rules_text: getGuildSetting(guildId, 'rules_text'),
 captcha_enabled: getGuildSetting(guildId, 'captcha_enabled') === 'true',
 log_channel_id: getGuildSetting(guildId, 'log_channel_id')
};
}

// === Comandos Slash ===

function getCommands() {
 const { SlashCommandBuilder } = require('discord.js');
 return [
 new SlashCommandBuilder()
 .setName('configurar-verificacao')
 .setDescription('Configura sistema de verificação e regras do servidor.')
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
 .addBooleanOption(o => o.setName('habilitado').setDescription('Ativar ou desativar verificação').setRequired(true))
 .addChannelOption(o => o.setName('canal').setDescription('Canal onde as regras serão exibidas'))
 .addRoleOption(o => o.setName('cargo-verificado').setDescription('Cargo dado após verificar'))
 .addRoleOption(o => o.setName('cargo-nao-verificado').setDescription('Cargo temporário antes de verificar'))
 .addBooleanOption(o => o.setName('captcha').setDescription('Exigir captcha de verificação'))
 .addStringOption(o => o.setName('regras').setDescription('Texto das regras do servidor'))
 .addChannelOption(o => o.setName('logs').setDescription('Canal para logs de verificação'))
 ];
}

// === Handlers ===

async function handleConfig(interaction) {
 if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles))
   return interaction.reply({content:'Você precisa gerenciar o servidor e os cargos.',flags:MessageFlags.Ephemeral});
 const enabled = interaction.options.getBoolean('habilitado', true);
 const channel = interaction.options.getChannel('canal');
 const verifiedRole = interaction.options.getRole('cargo-verificado');
 const unverifiedRole = interaction.options.getRole('cargo-nao-verificado');
 if ([verifiedRole,unverifiedRole].some(role=>role && !canConfigure(interaction,role)))
 return interaction.reply({content:'Escolha cargos comuns abaixo do seu e do bot.',flags:MessageFlags.Ephemeral});
 const captcha = interaction.options.getBoolean('captcha');
 const rulesText = interaction.options.getString('regras');
 const logChannel = interaction.options.getChannel('logs');

 runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
 [interaction.guildId, interaction.guild.name]);

 const settings = [
 ['enabled', String(enabled)],
 ['channel_id', channel?.id || getGuildSetting(interaction.guildId, 'channel_id')],
 ['verified_role_id', verifiedRole?.id || getGuildSetting(interaction.guildId, 'verified_role_id')],
 ['unverified_role_id', unverifiedRole?.id || getGuildSetting(interaction.guildId, 'unverified_role_id')],
 ['captcha_enabled', String(captcha ?? (getGuildSetting(interaction.guildId, 'captcha_enabled') === 'true'))],
 ['rules_text', rulesText || getGuildSetting(interaction.guildId, 'rules_text')],
 ['log_channel_id', logChannel?.id || getGuildSetting(interaction.guildId, 'log_channel_id')]
 ];

 for (const [key, value] of settings) {
 runSql(
 'INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)',
 [interaction.guildId, 'verification', key, value]
 );
 }

 log.info({ guildId: interaction.guildId, enabled }, 'Verificação configurada');

 const status = enabled ? '✅ Ativado' : '❌ Desativado';
 const captchaLabel = (captcha ?? true) ? '✅ Ativo' : '❌ Desativo';

 await interaction.reply({
 content: `**Verificação/Regras ${status}**\n• Canal: ${channel ? channel.name : 'não definido'}\n• Cargo verificado: ${verifiedRole ? verifiedRole.name : 'não definido'}\n• Captcha: ${captchaLabel}${logChannel ? `\n• Logs: ${logChannel.name}` : ''}`,
 flags: MessageFlags.Ephemeral
 });

 // Enviar painel de regras no canal se informado
 if (enabled && channel?.id) {
 await sendRulesPanel(interaction.guild, channel);
 }
}

async function sendRulesPanel(guild, channel) {
 try {
 const targetChannel = await guild.channels.fetch(channel.id || channel);
 if (!targetChannel?.isTextBased()) return;

 const settings = getSettings(guild.id);

 const embed = new EmbedBuilder()
 .setTitle('📜 Verificação do Servidor')
 .setDescription(settings.rules_text)
 .setColor(0x63d2a3)
 .setFooter({ text: 'Clique no botão abaixo para confirmar que leu e aceita as regras' })
 .setTimestamp();

 const button = new ButtonBuilder()
 .setCustomId('verification:start')
 .setLabel('✅ Aceitar Regras')
 .setStyle(ButtonStyle.Primary)
 .setEmoji('📜');

 const row = new ActionRowBuilder().addComponents(button);

 await targetChannel.send({ embeds: [embed], components: [row] });
 log.info({ guildId: guild.id, channelId: targetChannel.id }, 'Painel de regras enviado');
 } catch (err) {
 log.error({ err }, 'Falha ao enviar painel de regras');
 }
}

// Gera captcha simples (soma de 2 números pequenos)
function generateCaptcha() {
 const a = Math.floor(Math.random() * 10) + 1;
 const b = Math.floor(Math.random() * 10) + 1;
 return {
 question: `Quanto é ${a} + ${b}?`,
 answer: String(a + b)
 };
}

async function handleButtonStart(interaction) {
 const settings = getSettings(interaction.guildId);
 if (!settings.enabled) {
 return interaction.reply({ content: 'Verificação não está ativa neste servidor.', flags: MessageFlags.Ephemeral });
 }

 const member = interaction.member;
 if (settings.verified_role_id && member.roles.cache.has(settings.verified_role_id)) {
 return interaction.reply({ content: 'Você já está verificado!', flags: MessageFlags.Ephemeral });
 }

 if (!settings.captcha_enabled) {
 // Verificação direta sem captcha
 await completeVerification(interaction, settings, member);
 return;
 }

 // Gerar captcha
 const captcha = generateCaptcha();
 const key = `${interaction.guildId}:${interaction.user.id}`;
 pendingVerifications.set(key, {
 answer: captcha.answer,
 expires: Date.now() + PENDING_TTL_MS,
 attempts: 0
 });

 const modal = new (require('discord.js').ModalBuilder)()
 .setCustomId('verification:captcha')
 .setTitle('🔐 Captcha de Verificação');

 const input = new (require('discord.js').TextInputBuilder)()
 .setCustomId('captcha_answer')
 .setLabel(captcha.question)
 .setStyle(require('discord.js').TextInputStyle.Short)
 .setMinLength(1)
 .setMaxLength(3)
 .setRequired(true)
 .setPlaceholder('Digite apenas o número');

 const actionRow = new (require('discord.js').ActionRowBuilder)().addComponents(input);
 modal.addComponents(actionRow);

 return interaction.showModal(modal);
}

async function handleModalSubmit(interaction) {
 if (interaction.customId !== 'verification:captcha') return;

 const key = `${interaction.guildId}:${interaction.user.id}`;
 const pending = pendingVerifications.get(key);

 if (!pending || pending.expires < Date.now()) {
 pendingVerifications.delete(key);
 return interaction.reply({ content: 'Captcha expirado. Clique em "Aceitar Regras" novamente.', flags: MessageFlags.Ephemeral });
 }

 const answer = interaction.fields.getTextInputValue('captcha_answer').trim();

 if (answer !== pending.answer) {
 pending.attempts++;
 if (pending.attempts >= 3) {
 pendingVerifications.delete(key);
 return interaction.reply({ content: '❌ Muitas tentativas incorretas. Aguarde e tente novamente.', flags: MessageFlags.Ephemeral });
 }
 return interaction.reply({ content: `❌ Resposta incorreta. Tente novamente (tentativa ${pending.attempts}/3).`, flags: MessageFlags.Ephemeral });
 }

 pendingVerifications.delete(key);
 const settings = getSettings(interaction.guildId);
 await completeVerification(interaction, settings, interaction.member);
}

async function completeVerification(interaction, settings, member) {
 try {
 // Adicionar cargo verificado
 if (settings.verified_role_id) {
 if (!assignable(member.guild.roles.cache.get(settings.verified_role_id))) return interaction.reply({content:"Cargo de verificação indisponível.",flags:MessageFlags.Ephemeral});
 await member.roles.add(settings.verified_role_id, 'Verificação: regras aceitas');
 }

 // Remover cargo de não verificado se existir
 if (settings.unverified_role_id && member.roles.cache.has(settings.unverified_role_id)) {
 await member.roles.remove(settings.unverified_role_id, 'Verificação: concluída');
 }

 await interaction.reply({
 content: '✅ **Verificação concluída!** Bem-vindo ao servidor. Você agora tem acesso aos canais.',
 flags: MessageFlags.Ephemeral
 });

 // Log
 if (settings.log_channel_id) {
 try {
 const logChannel = await interaction.guild.channels.fetch(settings.log_channel_id);
 if (logChannel?.isTextBased()) {
 const embed = new EmbedBuilder()
 .setTitle('✅ Verificação Concluída')
 .setDescription(`**Usuário:** ${member.user.tag} (${member.id})`)
 .setColor(0x63d2a3)
 .setTimestamp();
 await logChannel.send({ embeds: [embed] });
 }
 } catch (err) {
 log.warn({ err }, 'Falha ao enviar log de verificação');
 }
 }

 log.info({ guildId: interaction.guildId, userId: member.id }, 'Usuário verificado com sucesso');
 } catch (err) {
 log.error({ err, guildId: interaction.guildId }, 'Erro ao completar verificação');
 await interaction.reply({ content: 'Erro ao processar verificação. Contate um administrador.', flags: MessageFlags.Ephemeral });
 }
}

// === Listener de GuildMemberAdd ===

async function handleMemberAdd(member) {
  if (!require("../state").isEnabled(member.guild.id, "verification")) return;
 const settings = getSettings(member.guild.id);
 if (!settings.enabled) return;

 // Adicionar cargo de não verificado (opcional)
 if (settings.unverified_role_id) {
 try {
 if (!assignable(member.guild.roles.cache.get(settings.unverified_role_id))) return;
 await member.roles.add(settings.unverified_role_id, 'Verificação: cargo inicial');
 } catch (err) {
 log.warn({ err, guildId: member.guild.id }, 'Falha ao adicionar cargo de não verificado');
 }
 }

 // Enviar DM com instruções
 if (settings.channel_id) {
 try {
 const channel = await member.guild.channels.fetch(settings.channel_id);
 const dmEmbed = new EmbedBuilder()
 .setTitle(`Bem-vindo ao ${member.guild.name}!`)
 .setDescription(`Para ter acesso completo ao servidor, leia as regras em <#${settings.channel_id}> e clique em **Aceitar Regras**.`)
 .setColor(0x63d2a3);
 await member.send({ embeds: [dmEmbed] }).catch(() => {
 // DMs bloqueadas, ignora
 });
 } catch (err) {
 // ignora
 }
 }
}

// === Contrato do Módulo ===

let context = null;
let _memberAddHandler = null;
let _cleanupInterval = null;

module.exports = {
 name: 'verification',
 getCommands,

 async init(ctx) {
 context = ctx;
 log.info('Módulo Verificação/Regras inicializado');
 },

 async start() {
 if (!context?.client) return;

 _memberAddHandler = (member) => {
 try {
 handleMemberAdd(member);
 } catch (err) {
 log.error({ err }, 'Erro no handler de verificação (memberAdd)');
 }
 };
 context.client.on(Events.GuildMemberAdd, _memberAddHandler);

 if (context.bus) {
 context.bus.on('interaction:create', async ({ interaction }) => {
 if (!interaction.inGuild()) return;

 if (interaction.isChatInputCommand() && interaction.commandName === 'configurar-verificacao') {
 return handleConfig(interaction);
 }

 if (interaction.isButton() && interaction.customId === 'verification:start') {
 return handleButtonStart(interaction);
 }

 if (interaction.isModalSubmit() && interaction.customId === 'verification:captcha') {
 return handleModalSubmit(interaction);
 }
 });
 }

 log.info('Módulo Verificação/Regras iniciado — listeners registrados');

 // Limpeza periódica de verificações pendentes expiradas
 _cleanupInterval = setInterval(() => {
 const now = Date.now();
 for (const [key, data] of pendingVerifications) {
 if (data.expires < now) pendingVerifications.delete(key);
 }
 }, 60_000);
 },

 async stop() {
 if (context?.client && _memberAddHandler) {
 context.client.off(Events.GuildMemberAdd, _memberAddHandler);
 _memberAddHandler = null;
 }
 if (_cleanupInterval) {
 clearInterval(_cleanupInterval);
 _cleanupInterval = null;
 }
 pendingVerifications.clear();
 log.info('Módulo Verificação/Regras parado');
 },

 health() {
 return {
 status: 'ok',
 pendingVerifications: pendingVerifications.size
 };
 }
};