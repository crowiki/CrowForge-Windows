"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolar dados de teste
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crowbot-jobs-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.LOG_LEVEL = 'silent';

const { initDatabase, closeDatabase, queryAll, queryGet } = require('../../packages/db');
const { JobScheduler } = require('../../packages/jobs');

test.before(async () => {
 await initDatabase(process.env.DATABASE_PATH);
});

test.after(() => {
 closeDatabase();
 fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('jobs: registra handler sem erro', () => {
 const sched = new JobScheduler();
 assert.doesNotThrow(() => sched.register('test:job', async () => {}));
 assert.ok(sched.handlers.has('test:job'));
});

test('jobs: rejeita handler não-função', () => {
 const sched = new JobScheduler();
 assert.throws(() => sched.register('bad:job', 'not-a-function'), /deve ser uma função/);
});

test('jobs: agenda job e persiste no SQLite', () => {
 const sched = new JobScheduler();
 const runAt = new Date(Date.now() + 60000).toISOString();
 const jobId = sched.schedule('G1', 'reminder:fire', { message: 'teste' }, runAt);
 assert.ok(jobId > 0);

 const row = queryGet('SELECT * FROM scheduled_jobs WHERE id = ?', [jobId]);
 assert.ok(row);
 assert.equal(row.guild_id, 'G1');
 assert.equal(row.job_type, 'reminder:fire');
 assert.equal(row.status, 'pending');
 assert.equal(JSON.parse(row.payload_json).message, 'teste');
});

test('jobs: cancela job pendente', () => {
 const sched = new JobScheduler();
 const runAt = new Date(Date.now() + 3600000).toISOString();
 const jobId = sched.schedule('G1', 'cancel:test', {}, runAt);
 sched.cancel(jobId);

 const row = queryGet('SELECT status FROM scheduled_jobs WHERE id = ?', [jobId]);
 assert.equal(row.status, 'cancelled');
});

test('jobs: lista jobs pendentes por guild', () => {
 const sched = new JobScheduler();
 const future = new Date(Date.now() + 7200000).toISOString();
 sched.schedule('GLIST', 'list:test1', {}, future);
 sched.schedule('GLIST', 'list:test2', {}, future);
 sched.schedule('GOTHER', 'list:test3', {}, future);

 const pending = sched.listPending('GLIST');
 assert.equal(pending.length, 2);
 assert.ok(pending.every(j => j.guild_id === 'GLIST'));
});

test('jobs: processDueJobs executa handler e marca completed', async () => {
 const sched = new JobScheduler();
 let executed = false;
 sched.register('exec:test', async (payload) => {
 executed = true;
 assert.equal(payload.key, 'value');
 });

 // Agendar job no passado para ser processado imediatamente
 const past = new Date(Date.now() - 1000).toISOString();
 sched.schedule('GEXEC', 'exec:test', { key: 'value' }, past);

 await sched.processDueJobs();
 assert.ok(executed);

 const row = queryGet("SELECT status FROM scheduled_jobs WHERE guild_id = 'GEXEC' AND job_type = 'exec:test'");
 assert.equal(row.status, 'completed');
});

test('jobs: handler com erro marca job como error', async () => {
 const sched = new JobScheduler();
 sched.register('error:test', async () => { throw new Error('boom'); });

 const past = new Date(Date.now() - 1000).toISOString();
 sched.schedule('GERR', 'error:test', {}, past);

 await sched.processDueJobs();

 const row = queryGet("SELECT * FROM scheduled_jobs WHERE guild_id = 'GERR' AND job_type = 'error:test'");
 assert.equal(row.status, 'error');
 assert.ok(row.error.includes('boom'));
});

test('jobs: job sem handler marca como error', () => {
 const sched = new JobScheduler();
 // Não registrar handler para 'missing:type'
 const past = new Date(Date.now() - 1000).toISOString();
 sched.schedule('GMISS', 'missing:type', {}, past);

 sched.processDueJobs();

 const row = queryGet("SELECT * FROM scheduled_jobs WHERE guild_id = 'GMISS' AND job_type = 'missing:type'");
 assert.equal(row.status, 'error');
 assert.ok(row.error.includes('Nenhum handler'));
});

test('jobs: start/stop controlam polling', () => {
 const sched = new JobScheduler();
 sched.pollIntervalMs = 60000; // longo para não interferir
 sched.start();
 assert.ok(sched.running);
 assert.ok(sched.interval !== null);
 sched.stop();
 assert.ok(!sched.running);
 assert.equal(sched.interval, null);
});

test('jobs: health retorna estado correto', () => {
 const sched = new JobScheduler();
 sched.register('health:test', async () => {});
 const h = sched.health();
 assert.equal(h.running, false);
 assert.ok(h.handlers.includes('health:test'));
 assert.equal(typeof h.pollIntervalMs, 'number');
});

test('jobs: catch-up após reinício processa jobs vencidos', () => {
 const sched = new JobScheduler();
 let catchUpExecuted = false;
 sched.register('catchup:test', async () => { catchUpExecuted = true; });

 // Simular job vencido deixado por instância anterior
 const past = new Date(Date.now() - 5000).toISOString();
 sched.schedule('GCATCH', 'catchup:test', {}, past);

 // start() deve processar jobs vencidos imediatamente
 sched.start();
 assert.ok(catchUpExecuted);
 sched.stop();
});