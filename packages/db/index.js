"use strict";
const path = require('node:path');
const fs = require('node:fs');
const initSqlJs = require('sql.js');
const { createChild } = require('../core/logger');

const log = createChild('database');

let db = null;
let SQL = null;
let dbPath = null;

// === Debounce de persistência (M04) ===
let saveTimer = null;
const SAVE_DEBOUNCE_MS = 500;
let pendingSave = false;

/**
 * Salva o banco de dados em disco imediatamente.
 * sql.js mantém o DB em memória WASM; precisamos persistir manualmente.
 */
function saveDatabaseSync() {
 if (!db || !dbPath) return;
 try {
 const data = db.export();
 // sql.js reabre a conexão ao exportar e restaura o padrão do SQLite.
 db.run('PRAGMA foreign_keys = ON');
 const buffer = Buffer.from(data);
 const tmp = dbPath + '.' + process.pid + '.tmp';
 fs.writeFileSync(tmp, buffer, { mode: 0o600 });
 fs.renameSync(tmp, dbPath);
 } catch (err) {
 log.error({ err }, 'Falha ao salvar banco de dados em disco');
 throw err;
 }
}

/**
 * Agenda uma persistência com debounce de 500ms.
 * Múltiplas escritas dentro da janela resultam em um único save.
 * Use saveDatabaseSync() quando precisar de durabilidade imediata (shutdown).
 */
function saveDatabase() {
 if (!db || !dbPath) return;
 pendingSave = true;
 if (saveTimer) return; // já agendado
 saveTimer = setTimeout(() => {
 saveTimer = null;
 pendingSave = false;
 try {
 saveDatabaseSync();
 } catch (err) {
 log.error({ err }, 'Falha no save debounced');
 }
 }, SAVE_DEBOUNCE_MS);
}

/**
 * Flush imediato: cancela debounce e salva agora.
 * Usado em shutdown/signals para garantir durabilidade.
 */
function flushDatabase() {
 if (saveTimer) {
 clearTimeout(saveTimer);
 saveTimer = null;
 }
 if (pendingSave || db) {
 pendingSave = false;
 saveDatabaseSync();
 }
}

/**
 * Inicializa o banco de dados SQLite via sql.js (WASM).
 * Carrega arquivo existente ou cria novo. Aplica schema.
 */
async function initDatabase(filePath) {
 const resolvedPath = path.resolve(filePath || process.env.DATABASE_PATH || './data/crowbot.db');
 const dir = path.dirname(resolvedPath);
 dbPath = resolvedPath;

 if (!fs.existsSync(dir)) {
 fs.mkdirSync(dir, { recursive: true });
 log.info({ dir }, 'Diretório de dados criado');
 }

 // Inicializar sql.js WASM
 SQL = await initSqlJs();

 // Carregar DB existente ou criar novo
 if (fs.existsSync(resolvedPath)) {
 const fileBuffer = fs.readFileSync(resolvedPath);
 db = new SQL.Database(fileBuffer);
 log.info({ path: resolvedPath }, 'Banco de dados carregado do disco');
 } else {
 db = new SQL.Database();
 log.info({ path: resolvedPath }, 'Novo banco de dados criado em memória');
 }

 // Otimizações
 db.run('PRAGMA journal_mode = WAL');
 db.run('PRAGMA foreign_keys = ON');
 db.run('PRAGMA busy_timeout = 5000');
 db.run('PRAGMA synchronous = NORMAL');
 db.run('PRAGMA cache_size = -64000');

 // Aplicar schema
 const schemaPath = path.join(__dirname, 'schema.sql');
 const schema = fs.readFileSync(schemaPath, 'utf8');
 db.run(schema);
 require('./module-columns')(db);

 // Registrar versão inicial se não existir
 db.run(
 "INSERT OR IGNORE INTO schema_migrations (version, description) VALUES (?, ?)",
 ['1.0.0', 'Schema inicial CrowBot Ultimate']
 );

 // Persistir imediatamente (sync na init para garantir schema em disco)
 saveDatabaseSync();

 // Registrar flush em sinais de saída (M04)
 registerShutdownHandlers();

 log.info({ path: resolvedPath }, 'Banco de dados SQLite (sql.js) inicializado');
 return db;
}

function getDb() {
 if (!db) {
 throw new Error('Banco de dados não inicializado. Chame initDatabase() primeiro.');
 }
 return db;
}

function closeDatabase() {
 if (db) {
 flushDatabase(); // garante persistência síncrona antes de fechar
 db.close();
 db = null;
 SQL = null;
 log.info('Banco de dados fechado e salvo');
 }
}

// === Helpers para compatibilidade com API estilo better-sqlite3 ===

/**
 * Executa uma query SELECT e retorna array de objetos.
 */
function queryAll(sql, params = []) {
 const d = getDb();
 const stmt = d.prepare(sql);
 if (params.length > 0) stmt.bind(params);
 const results = [];
 while (stmt.step()) {
 results.push(stmt.getAsObject());
 }
 stmt.free();
 return results;
}

/**
 * Executa uma query SELECT e retorna o primeiro resultado como objeto ou null.
 */
function queryGet(sql, params = []) {
 const d = getDb();
 const stmt = d.prepare(sql);
 if (params.length > 0) stmt.bind(params);
 let result = null;
 if (stmt.step()) {
 result = stmt.getAsObject();
 }
 stmt.free();
 return result;
}

/**
 * Executa INSERT/UPDATE/DELETE. Retorna { changes, lastInsertRowid }.
 */
function runSql(sql, params = []) {
 const d = getDb();
 d.run(sql, params);
 const changes = d.getRowsModified();
 // sql.js não expõe lastInsertRowid diretamente via run();
 // usamos last_insert_rowid() do SQLite
 const row = queryGet('SELECT last_insert_rowid() as id');
 const lastInsertRowid = row ? BigInt(row.id) : 0n;
 // Auto-save após escrita
 saveDatabase();
 return { changes, lastInsertRowid };
}

/**
 * Executa SQL raw (para migrations, PRAGMA, etc.)
 */
function execRaw(sql) {
 const d = getDb();
 d.run(sql);
 saveDatabase();
}

// === Repository base ===
class Repository {
 constructor(tableName) {
 this.tableName = tableName;
 }

 findById(id) {
 return queryGet(`SELECT * FROM ${this.tableName} WHERE id = ?`, [id]);
 }

 findByGuild(guildId) {
 return queryAll(`SELECT * FROM ${this.tableName} WHERE guild_id = ?`, [guildId]);
 }

 insert(data) {
 const keys = Object.keys(data);
 const placeholders = keys.map(() => '?').join(', ');
 const result = runSql(
 `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`,
 Object.values(data)
 );
 return result.lastInsertRowid;
 }

 update(id, data) {
 const sets = Object.keys(data).map(k => `${k} = ?`).join(', ');
 const values = [...Object.values(data), id];
 runSql(
 `UPDATE ${this.tableName} SET ${sets}, updated_at = datetime('now') WHERE id = ?`,
 values
 );
 }

 delete(id) {
 runSql(`DELETE FROM ${this.tableName} WHERE id = ?`, [id]);
 }

 count(guildId) {
 const row = queryGet(
 `SELECT COUNT(*) as count FROM ${this.tableName} WHERE guild_id = ?`,
 [guildId]
 );
 return row ? Number(row.count) : 0;
 }
}

// === Handlers de shutdown para flush garantido (M04) ===
let shutdownRegistered = false;

function registerShutdownHandlers() {
 if (shutdownRegistered) return;
 shutdownRegistered = true;

 const onExit = () => {
 try { flushDatabase(); } catch { /* best-effort */ }
 };

 process.on('SIGINT', () => { onExit(); process.exit(0); });
 process.on('SIGTERM', () => { onExit(); process.exit(0); });
 process.on('beforeExit', onExit);
}

module.exports = {
 getDb,
 initDatabase,
 closeDatabase,
 saveDatabase,
 saveDatabaseSync,
 flushDatabase,
 queryAll,
 queryGet,
 runSql,
 execRaw,
 Repository,
 registerShutdownHandlers
};