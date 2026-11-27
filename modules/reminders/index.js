"use strict";
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('reminders');

// === Schema ===
function ensureSchema() {
  runSql('DROP TABLE IF EXISTS reminders');

  runSql(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      remind_at TEXT NOT NULL,
      job_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'pending'
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_reminders_guild ON reminders(guild_id)');
  runSql('CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status)');
}

// === Helpers ===

function getUserReminders(userId) {
  return queryAll(
    "SELECT * FROM reminders WHERE user_id = ? AND status = 'pending' ORDER BY remind_at ASC",
    [userId]
  );
}

function getReminder(id) {
  return queryGet('SELECT * FROM reminders WHERE id = ?', [id]);
}

function parseDuration(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] || 0);
}

// === Comandos Slash ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('lembrete')
      .setDescription('Gerencia lembretes pessoais.')
      .addSubcommand(sub =>
        sub.setName('criar')
          .setDescription('Cria um novo lembrete.')
          .addStringOption(o => o.setName('mensagem').setDescription('O que lembrar').setRequired(true))
          .addStringOption(o => o.setName('tempo').setDescription('Quando lembrar (ex: 5m, 2h, 1d)').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('listar')
          .setDescription('Lista seus lembretes pendentes.')
      )
      .addSubcommand(sub =>
        sub.setName('remover')
          .setDescription('Remove um lembrete.')
          .addIntegerOption(o => o.setName('id').setDescription('ID do lembrete').setRequired(true))
      )
  ];
}

// === Handlers ===

async function handleCriar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta do lembrete');
    return;
  }

  try {
    const message = interaction.options.getString('mensagem', true);
    const timeStr = interaction.options.getString('tempo', true);

    const durationMs = parseDuration(timeStr);
    if (!durationMs || durationMs < 5000) {
      return interaction.editReply({ content: '❌ Tempo inválido. Use formato como `5m`, `2h`, `1d` (mínimo 5 segundos).' });
    }
    if (durationMs > 30 * 86400000) {
      return interaction.editReply({ content: '❌ Tempo máximo é 30 dias.' });
    }

    const remindAt = new Date(Date.now() + durationMs).toISOString();
    const channelId = interaction.channelId;

    runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
      [interaction.guildId, interaction.guild?.name || 'Unknown']);

    runSql(
      'INSERT INTO reminders (guild_id, channel_id, user_id, message, remind_at) VALUES (?, ?, ?, ?, ?)',
      [interaction.guildId, channelId, interaction.user.id, message, remindAt]
    );

    const row = queryGet(
      "SELECT id FROM reminders WHERE user_id = ? AND remind_at = ? ORDER BY id DESC LIMIT 1",
      [interaction.user.id, remindAt]
    );

    if (!row || !row.id) {
      return interaction.editReply({ content: '❌ Falha ao salvar o lembrete.' });
    }

    const reminderId = Number(row.id);

    // Agendar job
    try {
      const { scheduler } = require('../../packages/jobs');
      const jobId = scheduler.schedule(interaction.guildId, 'reminder:fire', { reminderId }, remindAt);
      runSql("UPDATE reminders SET job_id = ? WHERE id = ?", [jobId, reminderId]);
    } catch (err) {
      log.warn({ err, reminderId }, 'Falha ao agendar job do lembrete');
    }

    const timestamp = Math.floor(new Date(remindAt).getTime() / 1000);

    log.info({ reminderId, userId: interaction.user.id, remindAt }, 'Lembrete criado');

    await interaction.editReply({
      content: `✅ Lembrete #${reminderId} criado!\n\n` +
        `📝 **${message}**\n` +
        `⏰ Dispara <t:${timestamp}:R> (<t:${timestamp}:F>)`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao criar lembrete');
    try {
      await interaction.editReply({ content: `❌ Erro ao criar lembrete: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleListar(interaction) {
  const reminders = getUserReminders(interaction.user.id);

  if (reminders.length === 0) {
    return interaction.reply({ content: '⏰ Você não tem lembretes pendentes.', flags: MessageFlags.Ephemeral });
  }

  const list = reminders.slice(0, 15).map(r => {
    const ts = Math.floor(new Date(r.remind_at).getTime() / 1000);
    return `\`#${r.id}\` ${r.message.substring(0, 50)}${r.message.length > 50 ? '...' : ''} — <t:${ts}:R>`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('⏰ Seus Lembretes')
    .setDescription(list)
    .setColor(0x5b8def)
    .setFooter({ text: `${reminders.length} lembrete(s) • Use /lembrete remover id:<número> para cancelar` });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleRemover(interaction) {
  const id = interaction.options.getInteger('id', true);
  const reminder = getReminder(id);

  if (!reminder || reminder.user_id !== interaction.user.id) {
    return interaction.reply({ content: '❌ Lembrete não encontrado ou não pertence a você.', flags: MessageFlags.Ephemeral });
  }

  runSql("UPDATE reminders SET status = 'cancelled' WHERE id = ?", [id]);

  // Cancelar job se existir
  if (reminder.job_id) {
    try {
      const { scheduler } = require('../../packages/jobs');
      scheduler.cancel(reminder.job_id);
    } catch { /* ignora */ }
  }

  log.info({ reminderId: id, userId: interaction.user.id }, 'Lembrete removido');

  return interaction.reply({
    content: `✅ Lembrete #${id} cancelado com sucesso.`,
    flags: MessageFlags.Ephemeral
  });
}

// === Handler de job de disparo ===

async function handleReminderFire(payload, job) {
  const { reminderId } = payload;
  const reminder = getReminder(reminderId);

  if (!reminder || reminder.status !== 'pending') return;

  const channel=await context.client.channels.fetch(reminder.channel_id);
  if (!channel?.isSendable()) throw Error('Canal de lembretes indisponível.');
  const embed=new EmbedBuilder().setTitle('⏰ Lembrete').setDescription(reminder.message).setColor(0x7c3aed).setTimestamp();
  await channel.send({content:'<@'+reminder.user_id+'>',embeds:[embed],allowedMentions:{users:[reminder.user_id]}});
  runSql("UPDATE reminders SET status='fired' WHERE id=?",[reminderId]);
}

// === Contrato do Módulo ===
let context = null;

module.exports = {
  name: 'reminders',
  getCommands,

  async init(ctx) {
    context = ctx;
    ensureSchema();

    // Registrar handler de job
    try {
      const { scheduler } = require('../../packages/jobs');
      scheduler.register('reminder:fire', handleReminderFire);
    } catch (err) {
      log.warn({ err }, 'Falha ao registrar handler de job reminder:fire');
    }

    log.info('Módulo Lembretes inicializado');
  },

  async start() {
    if (!context?.bus) return;

    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'lembrete') return;

      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'criar': return handleCriar(interaction);
        case 'listar': return handleListar(interaction);
        case 'remover': return handleRemover(interaction);
      }
    });

    log.info('Módulo Lembretes iniciado — handlers registrados');
  },

  async stop() {
    log.info('Módulo Lembretes parado');
  },

  health() {
    const pending = queryGet("SELECT COUNT(*) as count FROM reminders WHERE status = 'pending'");
    return {
      status: 'ok',
      pendingReminders: pending?.count ?? 0
    };
  }
};