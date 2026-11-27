"use strict";
const { createChild } = require('../core/logger');
const { queryAll, queryGet, runSql } = require('../db');

const log = createChild('jobs');

/**
 * Sistema de jobs persistentes baseado em SQLite.
 * Usa a tabela scheduled_jobs do schema para garantir durabilidade
 * entre reinícios do processo. Polling a cada 30s por padrão.
 */
class JobScheduler {
 constructor() {
 this.handlers = new Map();
 this.interval = null;
 this.pollIntervalMs = 30_000;
 this.running = false;
 }

 /**
 * Registra um handler para um tipo de job.
 * @param {string} jobType - Tipo do job (ex: 'giveaway:end', 'reminder:fire')
 * @param {Function} handler - Função async (payload, job) => void
 */
 register(jobType, handler) {
 if (typeof handler !== 'function') {
 throw new Error(`Handler para '${jobType}' deve ser uma função`);
 }
 this.handlers.set(jobType, handler);
 log.info({ jobType }, 'Handler de job registrado');
 }

 /**
 * Agenda um novo job.
 * @param {string} guildId
 * @param {string} jobType
 * @param {object} payload - Dados serializáveis em JSON
 * @param {Date|string} runAt - Quando executar
 * @returns {number} ID do job
 */
 schedule(guildId, jobType, payload, runAt) {
 const runAtStr = runAt instanceof Date ? runAt.toISOString() : String(runAt);
 const payloadJson = JSON.stringify(payload);

 // Garantir que a guild existe (FK constraint)
 runSql(
 'INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
 [guildId, null]
 );

 runSql(
 'INSERT INTO scheduled_jobs (guild_id, job_type, payload_json, run_at) VALUES (?, ?, ?, ?)',
 [guildId, jobType, payloadJson, runAtStr]
 );

 const row = queryGet('SELECT last_insert_rowid() as id');
 const jobId = row ? Number(row.id) : 0;

 log.info({ jobId, jobType, guildId, runAt: runAtStr }, 'Job agendado');
 return jobId;
 }

 /**
 * Cancela um job pendente.
 */
 cancel(jobId) {
 runSql(
 "UPDATE scheduled_jobs SET status = 'cancelled' WHERE id = ? AND status = 'pending'",
 [jobId]
 );
 log.info({ jobId }, 'Job cancelado');
 }

 /**
 * Lista jobs pendentes para um guild.
 */
 listPending(guildId) {
 return queryAll(
 "SELECT * FROM scheduled_jobs WHERE guild_id = ? AND status = 'pending' ORDER BY run_at ASC",
 [guildId]
 );
 }

 /**
 * Inicia o polling de jobs vencidos.
 */
 start() {
 if (this.running) return;
 this.running = true;

 // M04: Recuperar jobs que ficaram com status 'executing' após crash/reinício
 const staleExecuting = queryAll(
 "SELECT id, run_at FROM scheduled_jobs WHERE status = 'executing'"
 );
 for (const job of staleExecuting) {
 runSql(
 "UPDATE scheduled_jobs SET status = 'pending' WHERE id = ?",
 [job.id]
 );
 log.warn({ jobId: job.id }, 'Job executing órfão recuperado para reprocessamento');
 }

 // Processar jobs vencidos imediatamente na partida (catch-up após reinício)
 this.processDueJobs();

 this.interval = setInterval(() => {
 this.processDueJobs();
 }, this.pollIntervalMs);

 log.info({ intervalMs: this.pollIntervalMs }, 'JobScheduler iniciado');
 }

 stop() {
 if (this.interval) {
 clearInterval(this.interval);
 this.interval = null;
 }
 this.running = false;
 log.info('JobScheduler parado');
 }

 /**
 * Processa todos os jobs vencidos (run_at <= now).
 * Async: aguarda cada handler para capturar rejeições de Promise.
 */
 async processDueJobs() {
 const now = new Date().toISOString();
 const dueJobs = queryAll(
 "SELECT * FROM scheduled_jobs WHERE status = 'pending' AND run_at <= ? AND (job_type NOT IN ('giveaway:end','poll:end','reminder:fire') OR EXISTS (SELECT 1 FROM modules m WHERE m.guild_id=scheduled_jobs.guild_id AND m.module_name=CASE job_type WHEN 'giveaway:end' THEN 'giveaways' WHEN 'poll:end' THEN 'polls' WHEN 'reminder:fire' THEN 'reminders' END AND m.enabled=1)) ORDER BY run_at ASC LIMIT 50",
 [now]
 );

 if (dueJobs.length === 0) return;

 log.info({ count: dueJobs.length }, 'Jobs vencidos encontrados');

 for (const job of dueJobs) {
 const handler = this.handlers.get(job.job_type);

 if (!handler) {
 log.warn({ jobType: job.job_type, jobId: job.id }, 'Sem handler para tipo de job — marcando como erro');
 runSql(
 "UPDATE scheduled_jobs SET status = 'error', error = ?, executed_at = datetime('now') WHERE id = ?",
 [`Nenhum handler registrado para '${job.job_type}'`, job.id]
 );
 continue;
 }

 // Marcar como executando antes de processar (evita duplicação)
 const claimed=runSql(
 "UPDATE scheduled_jobs SET status = 'executing' WHERE id = ? AND status = 'pending'",
 [job.id]
 );

 if (!claimed.changes) continue;
 try {
 let payload = {};
 try {
 payload = JSON.parse(job.payload_json || '{}');
 } catch {
 log.warn({ jobId: job.id }, 'Payload JSON inválido, usando objeto vazio');
 }

 // await garante que handlers async que rejeitam sejam capturados pelo try/catch
 await handler(payload, job);

 runSql(
 "UPDATE scheduled_jobs SET status = 'completed', executed_at = datetime('now') WHERE id = ?",
 [job.id]
 );
 log.info({ jobId: job.id, jobType: job.job_type }, 'Job executado com sucesso');
 } catch (err) {
 runSql(
 "UPDATE scheduled_jobs SET status = 'error', error = ?, executed_at = datetime('now') WHERE id = ?",
 [err.message, job.id]
 );
 log.error({ err, jobId: job.id, jobType: job.job_type }, 'Erro ao executar job');
 }
 }
 }

 health() {
 return {
 running: this.running,
 handlers: [...this.handlers.keys()],
 pollIntervalMs: this.pollIntervalMs
 };
 }
}

const scheduler = new JobScheduler();

module.exports = { JobScheduler, scheduler };