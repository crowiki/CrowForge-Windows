"use strict";
const { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('giveaways');

function getGuildSetting(guildId, key) {
 const row = queryGet(
 "SELECT value FROM settings WHERE guild_id = ? AND module = 'giveaways' AND key = ?",
 [guildId, key]
 );
 return row?.value || null;
}

// === Comandos Slash ===

function getCommands() {
 const { SlashCommandBuilder } = require('discord.js');
 return [
 new SlashCommandBuilder()
 .setName('sorteio')
 .setDescription('Gerencia sorteios no servidor.')
 .addSubcommand(s => s.setName('criar').setDescription('Cria um novo sorteio')
 .addStringOption(o => o.setName('premio').setDescription('Prêmio do sorteio').setRequired(true).setMaxLength(200))
 .addIntegerOption(o => o.setName('duracao').setDescription('Duração em minutos (1-10080)').setMinValue(1).setMaxValue(10080).setRequired(true))
 .addIntegerOption(o => o.setName('vencedores').setDescription('Número de vencedores (1-50)').setMinValue(1).setMaxValue(50).setRequired(false))
 .addChannelOption(o => o.setName('canal').setDescription('Canal do sorteio (padrão: canal atual)').setRequired(false)))
 .addSubcommand(s => s.setName('encerrar').setDescription('Encerra um sorteio antecipadamente')
 .addStringOption(o => o.setName('id').setDescription('ID do sorteio').setRequired(true)))
 .addSubcommand(s => s.setName('listar').setDescription('Lista sorteios ativos'))
 ];
}

// === Handlers ===

async function handleCreate(interaction) {
 if (!interaction.memberPermissions?.has(0x20)) {
 return interaction.reply({ content: 'Você precisa de Gerenciar Servidor.', flags: MessageFlags.Ephemeral });
 }

 const prize = interaction.options.getString('premio', true);
 const durationMin = interaction.options.getInteger('duracao', true);
 const winnersCount = interaction.options.getInteger('vencedores') || 1;
 const channel = interaction.options.getChannel('canal') || interaction.channel;

 if (!channel.isTextBased()) {
 return interaction.reply({ content: 'O canal deve ser de texto.', flags: MessageFlags.Ephemeral });
 }

 const endsAt = new Date(Date.now() + durationMin * 60_000).toISOString();

 runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
 [interaction.guildId, interaction.guild.name]);

 // Criar embed do sorteio
 const embed = new EmbedBuilder()
 .setTitle(`🎉 ${prize}`)
 .setDescription(`Clique no botão abaixo para participar!\n\n**Vencedores:** ${winnersCount}\n**Encerra em:** <t:${Math.floor(new Date(endsAt).getTime() / 1000)}:R>\n\n*Criado por <@${interaction.user.id}>*`)
 .setColor(0xf59e0b)
 .setTimestamp(new Date(endsAt));

 const button = new ActionRowBuilder().addComponents(
 new ButtonBuilder()
 .setCustomId('crow:giveaway:enter')
 .setLabel('Participar')
 .setEmoji('🎉')
 .setStyle(ButtonStyle.Primary)
 );

 const message = await channel.send({ embeds: [embed], components: [button] });

 // Persistir sorteio
 runSql(
 'INSERT INTO giveaways (guild_id, channel_id, message_id, prize, winners_count, ends_at, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))',
 [interaction.guildId, channel.id, message.id, prize, winnersCount, endsAt, 'active', interaction.user.id]
 );

 const giveawayRow = queryGet("SELECT id FROM giveaways WHERE message_id = ?", [message.id]);
 const giveawayId = giveawayRow ? Number(giveawayRow.id) : 0;

 // Agendar job para encerrar automaticamente
 if (context?.scheduler) {
 context.scheduler.schedule(interaction.guildId, 'giveaway:end', { giveawayId }, endsAt);
 }

 log.info({ guildId: interaction.guildId, giveawayId, prize, endsAt }, 'Sorteio criado');

 return interaction.reply({
 content: `✅ Sorteio criado em ${channel}! ID: \`${giveawayId}\``,
 flags: MessageFlags.Ephemeral
 });
}

async function handleEnd(interaction) {
 if (!interaction.memberPermissions?.has(0x20)) {
 return interaction.reply({ content: 'Você precisa de Gerenciar Servidor.', flags: MessageFlags.Ephemeral });
 }

 const giveawayId = parseInt(interaction.options.getString('id', true), 10);
 const giveaway = queryGet('SELECT * FROM giveaways WHERE id = ? AND guild_id = ?', [giveawayId, interaction.guildId]);

 if (!giveaway) {
 return interaction.reply({ content: 'Sorteio não encontrado.', flags: MessageFlags.Ephemeral });
 }
 if (giveaway.status !== 'active') {
 return interaction.reply({ content: 'Este sorteio já foi encerrado.', flags: MessageFlags.Ephemeral });
 }

 await endGiveaway(giveaway);
 return interaction.reply({ content: `✅ Sorteio #${giveawayId} encerrado manualmente!`, flags: MessageFlags.Ephemeral });
}

async function handleList(interaction) {
 const active = queryAll(
 "SELECT * FROM giveaways WHERE guild_id = ? AND status = 'active' ORDER BY ends_at ASC",
 [interaction.guildId]
 );

 if (active.length === 0) {
 return interaction.reply({ content: 'Nenhum sorteio ativo no momento.', flags: MessageFlags.Ephemeral });
 }

 const lines = active.map(g =>
 `**#${g.id}** — ${g.prize} | 🏆 ${g.winners_count} vencedor(es) | ⏰ <t:${Math.floor(new Date(g.ends_at).getTime() / 1000)}:R>`
 ).join('\n');

 const embed = new EmbedBuilder()
 .setTitle('🎉 Sorteios Ativos')
 .setDescription(lines)
 .setColor(0xf59e0b)
 .setTimestamp();

 return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function endGiveaway(giveaway) {
 // Coletar participantes
 const entries = queryAll(
 'SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?',
 [giveaway.id]
 );

 // Marcar como encerrado
 runSql(
 "UPDATE giveaways SET status = 'ended', ended_at = datetime('now') WHERE id = ?",
 [giveaway.id]
 );

 if (entries.length === 0) {
 log.info({ giveawayId: giveaway.id }, 'Sorteio encerrado sem participantes');
 try {
 const channel = await context?.client?.channels?.fetch(giveaway.channel_id);
 if (channel?.isTextBased()) {
 await channel.send(`🎉 O sorteio **${giveaway.prize}** encerrou, mas ninguém participou.`);
 }
 } catch { /* ignore */ }
 return;
 }

 // Selecionar vencedores usando Fisher-Yates para distribuição uniforme
 const participants = entries.map(e => e.user_id);
 for (let i = participants.length - 1; i > 0; i--) {
 const j = Math.floor(Math.random() * (i + 1));
 [participants[i], participants[j]] = [participants[j], participants[i]];
 }
 const winners = participants.slice(0, giveaway.winners_count).map(userId => ({ user_id: userId }));

 // Marcar vencedores
 for (const winner of winners) {
 runSql(
 "UPDATE giveaway_entries SET winner = 1 WHERE giveaway_id = ? AND user_id = ?",
 [giveaway.id, winner.user_id]
 );
 }

 const winnerMentions = winners.map(w => `<@${w.user_id}>`).join(', ');

 // Anunciar resultado
 try {
 const channel = await context?.client?.channels?.fetch(giveaway.channel_id);
 if (channel?.isTextBased()) {
 const embed = new EmbedBuilder()
 .setTitle(`🎉 Sorteio Encerrado: ${giveaway.prize}`)
 .setDescription(`Parabéns aos vencedores: ${winnerMentions}\n\nTotal de participantes: **${entries.length}**`)
 .setColor(0x22c55e)
 .setTimestamp();

 await channel.send({ content: winnerMentions, embeds: [embed], allowedMentions: { parse: ['users'] } });
 }
 } catch (err) {
 log.error({ err, giveawayId: giveaway.id }, 'Falha ao anunciar resultado do sorteio');
 }

 log.info({ giveawayId: giveaway.id, winners: winners.length, participants: entries.length }, 'Sorteio encerrado');
}

async function handleEnterButton(interaction) {
 const message = interaction.message;
 const giveaway = queryGet(
 "SELECT * FROM giveaways WHERE message_id = ? AND status = 'active'",
 [message.id]
 );

 if (!giveaway) {
 return interaction.reply({ content: 'Este sorteio não está mais ativo.', flags: MessageFlags.Ephemeral });
 }

 // Verificar se já participou
 const existing = queryGet(
 'SELECT id FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?',
 [giveaway.id, interaction.user.id]
 );
 if (existing) {
 return interaction.reply({ content: 'Você já está participando deste sorteio!', flags: MessageFlags.Ephemeral });
 }

 runSql(
 'INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)',
 [giveaway.id, interaction.user.id]
 );

 return interaction.reply({ content: '🎉 Você entrou no sorteio! Boa sorte!', flags: MessageFlags.Ephemeral });
}

// === Contrato do Módulo ===

let context = null;

module.exports = {
 name: 'giveaways',
 getCommands,

 async init(ctx) {
 context = ctx;

 // Registrar handler de job para encerrar sorteios automaticamente
 if (ctx?.scheduler) {
 const { scheduler } = require('../../packages/jobs');
 scheduler.register('giveaway:end', async (payload) => {
 const giveaway = queryGet('SELECT * FROM giveaways WHERE id = ? AND status = \'active\'', [payload.giveawayId]);
 if (giveaway) {
 await endGiveaway(giveaway);
 }
 });
 }

 log.info('Módulo Sorteios inicializado');
 },

 async start() {
 if (!context?.bus) return;

 context.bus.on('interaction:create', async ({ interaction }) => {
 if (!interaction.inGuild()) return;

 if (interaction.isButton() && interaction.customId === 'crow:giveaway:enter') {
 return handleEnterButton(interaction);
 }

 if (!interaction.isChatInputCommand() || interaction.commandName !== 'sorteio') return;

 const sub = interaction.options.getSubcommand();
 switch (sub) {
 case 'criar': return handleCreate(interaction);
 case 'encerrar': return handleEnd(interaction);
 case 'listar': return handleList(interaction);
 }
 });

 log.info('Módulo Sorteios iniciado — handlers registrados');
 },

 async stop() {
 log.info('Módulo Sorteios parado');
 },

 health() {
 const active = queryGet("SELECT COUNT(*) as c FROM giveaways WHERE status = 'active'");
 return {
 status: 'ok',
 activeGiveaways: active ? Number(active.c) : 0
 };
 }
};