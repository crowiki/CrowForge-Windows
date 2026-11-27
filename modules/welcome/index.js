"use strict";
const { EmbedBuilder, Events } = require('discord.js');
const { createChild, validateChannel, validateBotPermissions } = require('../../packages/core');
const { queryGet, runSql } = require('../../packages/db');

const log = createChild('welcome');

function getGuildSetting(guildId, key) {
 const row = queryGet(
 "SELECT value FROM settings WHERE guild_id = ? AND module = 'welcome' AND key = ?",
 [guildId, key]
 );
 return row?.value || null;
}

// === Comandos Slash ===

function getCommands() {
 const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
 return [
 new SlashCommandBuilder()
 .setName('configurar-boasvindas')
 .setDescription('Configura mensagens de boas-vindas e despedida.')
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
 .addChannelOption(o => o.setName('canal')
 .setDescription('Canal para enviar boas-vindas')
 .addChannelTypes(ChannelType.GuildText).setRequired(true))
 .addStringOption(o => o.setName('mensagem')
 .setDescription('Mensagem de boas-vindas ({user} {server} {count})')
 .setMaxLength(500).setRequired(false))
 .addBooleanOption(o => o.setName('dm')
 .setDescription('Enviar também por DM?').setRequired(false))
 .addStringOption(o => o.setName('despedida')
 .setDescription('Mensagem de despedida ({user} {server})')
 .setMaxLength(500).setRequired(false))
 ];
}

// === Handlers ===

async function handleConfig(interaction) {
 if (!interaction.memberPermissions?.has(0x20)) {
 return interaction.reply({ content: 'Você precisa de Gerenciar Servidor.', flags: 64 });
 }

 const channel = interaction.options.getChannel('canal', true);
 const message = interaction.options.getString('mensagem');
 const sendDm = interaction.options.getBoolean('dm');
 const farewell = interaction.options.getString('despedida');

 // Validar permissões do bot no canal escolhido
 const permCheck = validateBotPermissions(channel, interaction.client.user);
 if (!permCheck.valid) {
 return interaction.reply({ content: `⚠️ ${permCheck.error}`, flags: 64 });
 }

 runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
 [interaction.guildId, interaction.guild.name]);

 // Salvar configurações
 runSql(
 "INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)",
 [interaction.guildId, 'welcome', 'channel_id', channel.id]
 );

 if (message) {
 runSql(
 "INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)",
 [interaction.guildId, 'welcome', 'message', message]
 );
 }

 if (sendDm !== null) {
 runSql(
 "INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)",
 [interaction.guildId, 'welcome', 'send_dm', sendDm ? '1' : '0']
 );
 }

 if (farewell) {
 runSql(
 "INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)",
 [interaction.guildId, 'welcome', 'farewell_message', farewell]
 );
 }

 // Habilitar módulo
 runSql(
 "INSERT OR REPLACE INTO modules (guild_id, module_name, enabled) VALUES (?, ?, 1)",
 [interaction.guildId, 'welcome']
 );

 const parts = [`Canal: ${channel.name}`];
 if (message) parts.push('Mensagem personalizada');
 if (sendDm !== null) parts.push(`DM: ${sendDm ? 'sim' : 'não'}`);
 if (farewell) parts.push('Despedida configurada');

 log.info({ guildId: interaction.guildId }, 'Boas-vindas configuradas');
 return interaction.reply({
 content: `✅ Boas-vindas configuradas! ${parts.join(' | ')}`,
 flags: 64
 });
}

// === Listeners de eventos ===

async function handleMemberJoin(member) {
 const guildId = member.guild.id;

 // Verificar se módulo está habilitado
 const modRow = queryGet(
 "SELECT enabled FROM modules WHERE guild_id = ? AND module_name = 'welcome'",
 [guildId]
 );
 if (!modRow || !modRow.enabled) return;

 const channelId = getGuildSetting(guildId, 'channel_id');
 if (!channelId) return;

 const customMsg = getGuildSetting(guildId, 'message');
 const sendDm = getGuildSetting(guildId, 'send_dm') === '1';

 const msgTemplate = customMsg || '👋 Bem-vindo(a) {user} ao **{server}**! Agora somos **{count}** membros!';
 const msg = msgTemplate
 .replace('{user}', `<@${member.user.id}>`)
 .replace('{server}', member.guild.name)
 .replace('{count}', member.guild.memberCount.toLocaleString());

 const embed = new EmbedBuilder()
 .setDescription(msg)
 .setColor(0x22c55e)
 .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
 .setTimestamp();

 try {
 const channel = await member.guild.channels.fetch(channelId);
 if (channel?.isTextBased()) {
 await channel.send({ embeds: [embed], allowedMentions: { parse: ['users'] } });
 }
 } catch (err) {
 log.warn({ err, guildId, channelId }, 'Falha ao enviar boas-vindas no canal');
 }

 // Enviar DM se configurado
 if (sendDm) {
 try {
 const dmMsg = customMsg
 ? msgTemplate.replace('{user}', member.user.username).replace('{server}', member.guild.name).replace('{count}', member.guild.memberCount.toLocaleString())
 : `Olá ${member.user.username}! Bem-vindo(a) ao servidor **${member.guild.name}**!`;
 await member.send(dmMsg);
 } catch {
 // Usuário pode ter DMs desativadas — não é erro crítico
 log.debug({ guildId, userId: member.user.id }, 'DM de boas-vindas não enviada (usuário bloqueou)');
 }
 }

 log.info({ guildId, userId: member.user.id }, 'Boas-vindas enviadas');
}

async function handleMemberLeave(member) {
 const guildId = member.guild.id;

 const modRow = queryGet(
 "SELECT enabled FROM modules WHERE guild_id = ? AND module_name = 'welcome'",
 [guildId]
 );
 if (!modRow || !modRow.enabled) return;

 const channelId = getGuildSetting(guildId, 'channel_id');
 const farewellMsg = getGuildSetting(guildId, 'farewell_message');

 if (!channelId || !farewellMsg) return;

 const msg = farewellMsg
 .replace('{user}', member.user.tag)
 .replace('{server}', member.guild.name);

 try {
 const channel = await member.guild.channels.fetch(channelId);
 if (channel?.isTextBased()) {
 await channel.send({ content: msg, allowedMentions: { parse: [] } });
 }
 } catch (err) {
 log.warn({ err, guildId }, 'Falha ao enviar despedida');
 }
}

// === Contrato do Módulo ===

let context = null;
let _memberAddHandler = null;
let _memberRemoveHandler = null;

module.exports = {
 name: 'welcome',
 getCommands,

 async init(ctx) {
 context = ctx;
 log.info('Módulo Boas-vindas inicializado');
 },

 async start() {
 if (!context?.client) return;

 _memberAddHandler = (member) => {
      if (process.env.GUILD_ID && member.guild?.id !== process.env.GUILD_ID) return;
 handleMemberJoin(member).catch(err =>
 log.error({ err, guildId: member.guild.id }, 'Erro em boas-vindas')
 );
 };
 context.client.on(Events.GuildMemberAdd, _memberAddHandler);

 _memberRemoveHandler = (member) => {
      if (process.env.GUILD_ID && member.guild?.id !== process.env.GUILD_ID) return;
 handleMemberLeave(member).catch(err =>
 log.error({ err, guildId: member.guild.id }, 'Erro em despedida')
 );
 };
 context.client.on(Events.GuildMemberRemove, _memberRemoveHandler);

 if (context.bus) {
 context.bus.on('interaction:create', async ({ interaction }) => {
 if (!interaction.inGuild() || !interaction.isChatInputCommand()) return;
 if (interaction.commandName === 'configurar-boasvindas') {
 return handleConfig(interaction);
 }
 });
 }

 log.info('Módulo Boas-vindas iniciado — listeners registrados');
 },

 async stop() {
 if (context?.client) {
 if (_memberAddHandler) {
 context.client.off(Events.GuildMemberAdd, _memberAddHandler);
 _memberAddHandler = null;
 }
 if (_memberRemoveHandler) {
 context.client.off(Events.GuildMemberRemove, _memberRemoveHandler);
 _memberRemoveHandler = null;
 }
 }
 log.info('Módulo Boas-vindas parado');
 },

 health() {
 return { status: 'ok' };
 }
};