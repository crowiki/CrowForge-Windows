"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolar dados de teste
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crowbot-core-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.LOG_LEVEL = 'silent';

const { logger, createChild, bus, manager } = require('../../packages/core');
const { initDatabase, closeDatabase, queryAll, queryGet, runSql, execRaw, Repository } = require('../../packages/db');

// === LOGGER ===
test('logger: cria child com nome do módulo', () => {
 const child = createChild('test-module');
 assert.ok(child);
 assert.equal(typeof child.info, 'function');
 assert.equal(typeof child.error, 'function');
 assert.equal(typeof child.warn, 'function');
 assert.equal(typeof child.debug, 'function');
});

test('logger: não lança erro em chamadas básicas', () => {
 const log = createChild('test-silent');
 assert.doesNotThrow(() => log.info('mensagem de teste'));
 assert.doesNotThrow(() => log.warn({ key: 'value' }, 'aviso'));
 assert.doesNotThrow(() => log.error(new Error('teste'), 'erro'));
});

// === EVENT BUS ===
test('event-bus: emite e recebe eventos', async () => {
 let received = null;
 bus.on('test:event', (data) => { received = data; });
 bus.emit('test:event', { value: 42 });
 await new Promise(r => setImmediate(r));
 assert.deepEqual(received, { value: 42 });
 bus.removeAllListeners('test:event');
});

test('event-bus: handler com erro não derruba emissão', async () => {
 bus.on('test:error', () => { throw new Error('handler falhou'); });
 assert.doesNotThrow(() => bus.emit('test:error'));
 await new Promise(r => setImmediate(r));
 bus.removeAllListeners('test:error');
});

test('event-bus: once executa apenas uma vez', async () => {
 let count = 0;
 bus.once('test:once', () => { count++; });
 bus.emit('test:once');
 bus.emit('test:once');
 await new Promise(r => setImmediate(r));
 assert.equal(count, 1);
 bus.removeAllListeners('test:once');
});

// === MODULE MANAGER ===
test('module-manager: registra módulo válido', () => {
 const mockModule = {
 init: async () => {},
 start: async () => {},
 stop: async () => {},
 health: () => ({ status: 'ok' })
 };
 const mgr = new (require('../../packages/core/module-manager').ModuleManager)();
 assert.doesNotThrow(() => mgr.register('test-mod', mockModule));
 assert.equal(mgr.list().length, 1);
 assert.equal(mgr.list()[0].name, 'test-mod');
 assert.equal(mgr.list()[0].status, 'registered');
});

test('module-manager: rejeita módulo sem contrato completo', () => {
 const incomplete = { init: async () => {}, start: async () => {} };
 const mgr = new (require('../../packages/core/module-manager').ModuleManager)();
 assert.throws(() => mgr.register('bad-mod', incomplete), /não implementa/);
});

test('module-manager: rejeita registro duplicado', () => {
 const mod = { init: async () => {}, start: async () => {}, stop: async () => {}, health: () => 'ok' };
 const mgr = new (require('../../packages/core/module-manager').ModuleManager)();
 mgr.register('dup-mod', mod);
 assert.throws(() => mgr.register('dup-mod', mod), /já registrado/);
});

test('module-manager: initAll e startAll executam na ordem', async () => {
 const order = [];
 const mod = {
 init: async () => { order.push('init'); },
 start: async () => { order.push('start'); },
 stop: async () => { order.push('stop'); },
 health: () => 'ok'
 };
 const mgr = new (require('../../packages/core/module-manager').ModuleManager)();
 mgr.register('order-mod', mod);
 await mgr.initAll({});
 await mgr.startAll();
 assert.deepEqual(order, ['init', 'start']);
 await mgr.stopAll();
 assert.deepEqual(order, ['init', 'start', 'stop']);
});

test('module-manager: falha em init não impede outros módulos', async () => {
 const results = [];
 const failMod = {
 init: async () => { throw new Error('fail'); },
 start: async () => {},
 stop: async () => {},
 health: () => 'ok'
 };
 const okMod = {
 init: async () => { results.push('ok-init'); },
 start: async () => { results.push('ok-start'); },
 stop: async () => {},
 health: () => 'ok'
 };
 const mgr = new (require('../../packages/core/module-manager').ModuleManager)();
 mgr.register('fail-mod', failMod);
 mgr.register('ok-mod', okMod);
 await mgr.initAll({});
 await mgr.startAll();
 assert.ok(results.includes('ok-init'));
 assert.ok(results.includes('ok-start'));
 const list = mgr.list();
 const failEntry = list.find(m => m.name === 'fail-mod');
 assert.equal(failEntry.status, 'init_failed');
});

test('module-manager: healthCheck retorna status de todos', async () => {
 const mod = {
 init: async () => {},
 start: async () => {},
 stop: async () => {},
 health: () => ({ uptime: 123 })
 };
 const mgr = new (require('../../packages/core/module-manager').ModuleManager)();
 mgr.register('health-mod', mod);
 await mgr.initAll({});
 await mgr.startAll();
 const health = mgr.healthCheck();
 assert.ok(health['health-mod']);
 assert.equal(health['health-mod'].status, 'running');
 assert.deepEqual(health['health-mod'].health, { uptime: 123 });
});

// === DATABASE (sql.js — assíncrono) ===
test('database: inicializa SQLite e aplica schema', async () => {
 await initDatabase(process.env.DATABASE_PATH);
 const tables = queryAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
 const names = tables.map(t => t.name);
 assert.ok(names.includes('guilds'), 'tabela guilds existe');
 assert.ok(names.includes('settings'), 'tabela settings existe');
 assert.ok(names.includes('tickets'), 'tabela tickets existe');
 assert.ok(names.includes('moderation_cases'), 'tabela moderation_cases existe');
 assert.ok(names.includes('schema_migrations'), 'tabela schema_migrations existe');
 assert.ok(names.includes('level_profiles'), 'tabela level_profiles existe');
 assert.ok(names.includes('giveaways'), 'tabela giveaways existe');
 assert.ok(names.includes('store_products'), 'tabela store_products existe');
 assert.ok(names.includes('audit_events'), 'tabela audit_events existe');
});

test('database: migração inicial registrada', () => {
 const row = queryGet("SELECT * FROM schema_migrations WHERE version = '1.0.0'");
 assert.ok(row);
 assert.equal(row.version, '1.0.0');
});

test('database: insere e consulta guild + settings', () => {
 runSql("INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)", ['G1', 'Test Server']);
 runSql("INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)",
 ['G1', 'tickets', 'category_id', '123456']);
 const setting = queryGet("SELECT * FROM settings WHERE guild_id = ? AND module = ? AND key = ?",
 ['G1', 'tickets', 'category_id']);
 assert.ok(setting);
 assert.equal(setting.value, '123456');
});

test('database: isolamento por guild_id', () => {
 runSql("INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)", ['G2', 'Outro Server']);
 runSql("INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)",
 ['G2', 'tickets', 'category_id', '999999']);
 const g1 = queryGet("SELECT value FROM settings WHERE guild_id = 'G1' AND module = 'tickets' AND key = 'category_id'");
 const g2 = queryGet("SELECT value FROM settings WHERE guild_id = 'G2' AND module = 'tickets' AND key = 'category_id'");
 assert.equal(g1.value, '123456');
 assert.equal(g2.value, '999999');
});

test('database: Repository base funciona', () => {
 runSql("INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)", ['G3', 'Repo Test']);
 class GuildRepo extends Repository {
 constructor() { super('guilds'); }
 }
 const repo = new GuildRepo();
 const count = repo.count('G3');
 assert.equal(count, 1);
});

test('database: foreign keys ativadas', () => {
 const fk = queryGet('PRAGMA foreign_keys');
 assert.equal(fk.foreign_keys, 1);
});

test('database: persiste em disco e recarrega', async () => {
 // Escrever dado, fechar, reabrir e verificar
 runSql("INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)", ['GPERSIST', 'Persist Test']);
 closeDatabase();
 assert.ok(fs.existsSync(process.env.DATABASE_PATH), 'arquivo .db existe em disco');
 await initDatabase(process.env.DATABASE_PATH);
 const row = queryGet("SELECT * FROM guilds WHERE guild_id = 'GPERSIST'");
 assert.ok(row);
 assert.equal(row.name, 'Persist Test');
});

test.after(() => {
 closeDatabase();
 fs.rmSync(tmpDir, { recursive: true, force: true });
});