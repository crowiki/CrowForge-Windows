"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolar dados de teste
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crowbot-modules-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.LOG_LEVEL = 'silent';

const { initDatabase, closeDatabase, queryGet, queryAll, runSql } = require('../../packages/db');
const { modules, getAllCommands } = require('../../modules');

test.before(async () => {
 await initDatabase(process.env.DATABASE_PATH);
});

test.after(() => {
 closeDatabase();
 fs.rmSync(tmpDir, { recursive: true, force: true });
});

// === Registro de módulos ===

test('modules: registra todos os módulos do catálogo', () => {
 const names = modules.map(m => m.name);
 assert.ok(names.includes('tickets'), 'módulo tickets registrado');
 assert.ok(names.includes('moderation'), 'módulo moderation registrado');
 assert.ok(names.includes('levels'), 'módulo levels registrado');
 assert.ok(names.includes('giveaways'), 'módulo giveaways registrado');
 assert.ok(names.includes('welcome'), 'módulo welcome registrado');
 assert.ok(names.includes('automod'), 'módulo automod registrado');
 assert.ok(names.includes('setup'));
 assert.deepEqual([...names].sort(),Object.keys(require('../../installer/lib/catalog.json')).sort());
});

test('modules: todos implementam contrato completo', () => {
 const contract = ['init', 'start', 'stop', 'health'];
 for (const mod of modules) {
 for (const method of contract) {
 assert.equal(typeof mod[method], 'function', `${mod.name} não implementa ${method}()`);
 }
 }
});

test('modules: getCommands retorna array válido para todos', () => {
 for (const mod of modules) {
 const cmds = mod.getCommands();
 assert.ok(Array.isArray(cmds), `${mod.name}.getCommands() deve retornar array`);
 assert.ok(cmds.length > 0, `${mod.name} deve ter pelo menos um comando`);
 for (const cmd of cmds) {
 assert.ok(typeof cmd.toJSON === 'function', `comando de ${mod.name} deve ter toJSON()`);
 const json = cmd.toJSON();
 assert.ok(json.name, 'comando deve ter nome');
 assert.ok(json.description, 'comando deve ter descrição');
 }
 }
});

test('modules: getAllCommands coleta comandos de todos os módulos', () => {
 const all = getAllCommands();
 assert.ok(all.length >= 10, `deve ter pelo menos 10 comandos (recebido: ${all.length})`);
 const names = all.map(c => c.name || c.toJSON?.()?.name);
 assert.ok(names.includes('ticket') || names.includes('configurar-tickets'), 'comandos de tickets presentes');
 assert.ok(names.includes('moderar'), 'comando moderar presente');
 assert.ok(names.includes('rank') || names.includes('leaderboard'), 'comandos de levels presentes');
 assert.ok(names.includes('sorteio'), 'comando sorteio presente');
 assert.ok(names.includes('configurar-boasvindas'), 'comando boas-vindas presente');
 assert.ok(names.includes('automod'), 'comando automod presente');
});

// === Testes genéricos de contrato para cada módulo ===

for (const mod of modules) {
 test(`${mod.name}: health retorna status ok`, async () => {
 await mod.init({ bus: { on: () => {} }, client: null, scheduler: null });
 const h = mod.health();
 assert.equal(h.status, 'ok');
 });

 test(`${mod.name}: init/start/stop não lançam erro`, async () => {
 const mockBus = { on: () => {} };
 const mockClient = { on: () => {}, off: () => {}, channels: { fetch: async () => null } };
 await assert.doesNotReject(() => mod.init({ bus: mockBus, client: mockClient, scheduler: null }));
 await assert.doesNotReject(() => mod.start());
 await assert.doesNotReject(() => mod.stop());
 });
}

// === Módulo Tickets ===

test('tickets: health retorna openTickets numérico', async () => {
 const ticketsMod = modules.find(m => m.name === 'tickets');
 await ticketsMod.init({ bus: { on: () => {} }, client: null });
 const h = ticketsMod.health();
 assert.equal(typeof h.openTickets, 'number');
 assert.equal(typeof h.locksActive, 'number');
});

// === Módulo Moderation ===

test('moderation: comandos incluem avisar, avisos, limpar, timeout, kick, ban', () => {
 const modMod = modules.find(m => m.name === 'moderation');
 const cmds = modMod.getCommands();
 const moderarCmd = cmds.find(c => c.name === 'moderar' || c.toJSON?.()?.name === 'moderar');
 assert.ok(moderarCmd, 'comando /moderar existe');
 const json = moderarCmd.toJSON();
 const subNames = json.options.map(o => o.name);
 assert.ok(subNames.includes('avisar'));
 assert.ok(subNames.includes('avisos'));
 assert.ok(subNames.includes('limpar'));
 assert.ok(subNames.includes('timeout'));
 assert.ok(subNames.includes('kick'));
 assert.ok(subNames.includes('ban'));
});

// === Módulo Levels ===

test('levels: comandos incluem rank, leaderboard, configurar-niveis', () => {
 const levelsMod = modules.find(m => m.name === 'levels');
 const cmds = levelsMod.getCommands();
 const names = cmds.map(c => c.name || c.toJSON?.()?.name);
 assert.ok(names.includes('rank'));
 assert.ok(names.includes('leaderboard'));
 assert.ok(names.includes('configurar-niveis'));
});

// === Módulo Giveaways ===

test('giveaways: comandos incluem criar, encerrar, listar', () => {
 const gMod = modules.find(m => m.name === 'giveaways');
 const cmds = gMod.getCommands();
 const sorteioCmd = cmds.find(c => c.name === 'sorteio' || c.toJSON?.()?.name === 'sorteio');
 assert.ok(sorteioCmd);
 const json = sorteioCmd.toJSON();
 const subNames = json.options.map(o => o.name);
 assert.ok(subNames.includes('criar'));
 assert.ok(subNames.includes('encerrar'));
 assert.ok(subNames.includes('listar'));
});

// === Módulo Welcome ===

test('welcome: comando configurar-boasvindas existe', () => {
 const wMod = modules.find(m => m.name === 'welcome');
 const cmds = wMod.getCommands();
 const names = cmds.map(c => c.name || c.toJSON?.()?.name);
 assert.ok(names.includes('configurar-boasvindas'));
});

// === Módulo AutoMod ===

test('automod: comandos incluem adicionar, listar, remover, testar', () => {
 const aMod = modules.find(m => m.name === 'automod');
 const cmds = aMod.getCommands();
 const automodCmd = cmds.find(c => c.name === 'automod' || c.toJSON?.()?.name === 'automod');
 assert.ok(automodCmd);
 const json = automodCmd.toJSON();
 const subNames = json.options.map(o => o.name);
 assert.ok(subNames.includes('adicionar'));
 assert.ok(subNames.includes('listar'));
 assert.ok(subNames.includes('remover'));
 assert.ok(subNames.includes('testar'));
});

test('automod: health retorna activeRules numérico', async () => {
 const aMod = modules.find(m => m.name === 'automod');
 await aMod.init({ bus: { on: () => {} }, client: null });
 const h = aMod.health();
 assert.equal(typeof h.activeRules, 'number');
 assert.equal(typeof h.cachedGuilds, 'number');
});

// === Integração DB + Módulos ===

test('integração: ticket criado via SQL aparece no health do módulo', async () => {
 runSql("INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)", ['GMODTEST', 'Test']);
 runSql(
 "INSERT INTO tickets (guild_id, channel_id, ticket_seq, owner_id, type, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
 ['GMODTEST', 'CH999', 1, 'USER1', 'support', 'open', 'Teste integração']
 );

 const ticketsMod = modules.find(m => m.name === 'tickets');
 await ticketsMod.init({ bus: { on: () => {} }, client: null });
 const h = ticketsMod.health();
 assert.ok(h.openTickets >= 1);
});

test('integração: caso de moderação aparece no health', () => {
 runSql("INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)", ['GMODTEST2', 'Test2']);
 runSql(
 "INSERT INTO moderation_cases (guild_id, case_number, type, target_user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
 ['GMODTEST2', 1, 'warn', 'TARGET1', 'MOD1', 'Teste mod']
 );

 const modMod = modules.find(m => m.name === 'moderation');
 const h = modMod.health();
 assert.ok(h.totalCases >= 1);
});

test('integração: regra automod persistida aparece no health', () => {
 runSql("INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)", ['GAUTO', 'AutoTest']);
 runSql(
 "INSERT INTO automod_rules (guild_id, rule_name, rule_type, config_json, action_type, severity, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)",
 ['GAUTO', 'teste-links', 'links', '{}', 'delete', 1]
 );

 const aMod = modules.find(m => m.name === 'automod');
 // Limpar cache para forçar reload
 if (aMod.stop) aMod.stop().catch(() => {});
 const h = aMod.health();
 assert.ok(h.activeRules >= 1);
});