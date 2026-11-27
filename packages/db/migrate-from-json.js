"use strict";
const fs = require('node:fs');
const path = require('node:path');
const { initDatabase, closeDatabase, runSql, queryGet } = require('./index');
const { createChild } = require('../core/logger');

const log = createChild('migration');

async function migrateFromJson(jsonDataDir, dbPath) {
  log.info({ source: jsonDataDir, target: dbPath }, 'Iniciando migração JSON → SQLite');

  // Backup do diretório JSON antes de migrar
  const backupDir = jsonDataDir + '.backup.' + Date.now();
  if (fs.existsSync(jsonDataDir)) {
    fs.cpSync(jsonDataDir, backupDir, { recursive: true });
    log.info({ backup: backupDir }, 'Backup do JSON criado');
  }

  await initDatabase(dbPath);

  let migrated = { configs: 0, tickets: 0, warnings: 0 };

  try {
    // Migrar configs
    const configsPath = path.join(jsonDataDir, 'configs.json');
    if (fs.existsSync(configsPath)) {
      const configs = JSON.parse(fs.readFileSync(configsPath, 'utf8'));

      for (const [guildId, config] of Object.entries(configs)) {
        runSql(
          'INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
          [guildId, null]
        );
        if (config.categoryId) {
          runSql(
            'INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)',
            [guildId, 'tickets', 'category_id', config.categoryId]
          );
        }
        if (config.staffRoleId) {
          runSql(
            'INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)',
            [guildId, 'tickets', 'staff_role_id', config.staffRoleId]
          );
        }
        if (config.logsChannelId) {
          runSql(
            'INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)',
            [guildId, 'tickets', 'logs_channel_id', config.logsChannelId]
          );
        }
        migrated.configs++;
      }
      log.info({ count: migrated.configs }, 'Configs migradas');
    }

    // Migrar tickets
    const ticketsPath = path.join(jsonDataDir, 'tickets.json');
    if (fs.existsSync(ticketsPath)) {
      const tickets = JSON.parse(fs.readFileSync(ticketsPath, 'utf8'));

      // Agrupar por guild para gerar sequência
      const byGuild = {};
      for (const [channelId, ticket] of Object.entries(tickets)) {
        const gid = ticket.guildId;
        if (!byGuild[gid]) byGuild[gid] = [];
        byGuild[gid].push({ channelId, ...ticket });
      }

      for (const [guildId, guildTickets] of Object.entries(byGuild)) {
        guildTickets.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        let seq = 1;
        for (const t of guildTickets) {
          runSql(
            `INSERT OR IGNORE INTO tickets (guild_id, channel_id, ticket_seq, owner_id, type, status, reason, claimed_by, created_at, closed_at, closed_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              guildId,
              t.channelId || null,
              seq++,
              t.ownerId,
              'support',
              t.status === 'open' ? 'open' : 'closed',
              t.reason || null,
              t.claimedBy || null,
              t.createdAt || new Date().toISOString(),
              t.closedAt || null,
              t.closedBy || null
            ]
          );
          const row = queryGet('SELECT last_insert_rowid() as id');
          const ticketId = row ? Number(row.id) : 0;
          runSql(
            'INSERT INTO ticket_events (ticket_id, event_type, actor_id, detail, created_at) VALUES (?, ?, ?, ?, ?)',
            [ticketId, 'created', t.ownerId, 'Migrado do JSON v0.1', t.createdAt || new Date().toISOString()]
          );
          migrated.tickets++;
        }
      }
      log.info({ count: migrated.tickets }, 'Tickets migrados');
    }

    // Migrar warnings
    const warningsPath = path.join(jsonDataDir, 'warnings.json');
    if (fs.existsSync(warningsPath)) {
      const warnings = JSON.parse(fs.readFileSync(warningsPath, 'utf8'));

      for (const [guildId, users] of Object.entries(warnings)) {
        let caseNum = 1;
        for (const [userId, entries] of Object.entries(users)) {
          for (const entry of entries) {
            runSql(
              'INSERT INTO moderation_cases (guild_id, case_number, type, target_user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [guildId, caseNum++, 'warn', userId, entry.moderatorId, entry.reason, entry.at || new Date().toISOString()]
            );
            migrated.warnings++;
          }
        }
      }
      log.info({ count: migrated.warnings }, 'Advertências migradas');
    }

    log.info(migrated, 'Migração concluída com sucesso');
    return { success: true, migrated, backup: backupDir };
  } catch (err) {
    log.error({ err }, 'Falha na migração');
    closeDatabase();
    if (fs.existsSync(backupDir)) {
      log.info('Dados originais preservados em: ' + backupDir);
    }
    throw err;
  } finally {
    closeDatabase();
  }
}

// Executar via CLI: node packages/db/migrate-from-json.js [json_dir] [db_path]
if (require.main === module) {
  const jsonDir = process.argv[2] || path.join(__dirname, '..', '..', 'src_v0.1', 'CrowBot_v0.1', 'data');
  const dbPath = process.argv[3] || './data/crowbot.db';

  if (!fs.existsSync(jsonDir)) {
    console.log('Nenhum dado JSON encontrado em:', jsonDir);
    console.log('Criando banco SQLite vazio...');
    initDatabase(dbPath).then(() => {
      closeDatabase();
      process.exit(0);
    }).catch(err => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
  } else {
    migrateFromJson(jsonDir, dbPath).then(result => {
      console.log('\n✅ Migração concluída!');
      console.log(`  Configs: ${result.migrated.configs}`);
      console.log(`  Tickets: ${result.migrated.tickets}`);
      console.log(`  Warnings: ${result.migrated.warnings}`);
      console.log(`  Backup: ${result.backup}`);
    }).catch(err => {
      console.error('\n❌ Migração falhou:', err.message);
      process.exit(1);
    });
  }
}

module.exports = { migrateFromJson };