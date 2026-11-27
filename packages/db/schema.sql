-- CrowBot Ultimate — Schema SQLite Inicial
-- Versão: 1.0.0
-- Todas as tabelas incluem guild_id para isolamento multi-servidor

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- Controle de migrações
CREATE TABLE IF NOT EXISTS schema_migrations (
 version TEXT PRIMARY KEY,
 applied_at TEXT NOT NULL DEFAULT (datetime('now')),
 description TEXT
);

-- Configurações por servidor
CREATE TABLE IF NOT EXISTS guilds (
 guild_id TEXT PRIMARY KEY,
 name TEXT,
 profile TEXT DEFAULT 'custom',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 module TEXT NOT NULL,
 key TEXT NOT NULL,
 value TEXT,
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(guild_id, module, key)
);

-- Mapeamento de cargos por módulo
CREATE TABLE IF NOT EXISTS roles_mapping (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 module TEXT NOT NULL,
 role_type TEXT NOT NULL,
 role_id TEXT NOT NULL,
 UNIQUE(guild_id, module, role_type)
);

-- Módulos habilitados/desabilitados
CREATE TABLE IF NOT EXISTS modules (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 module_name TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0,
 config_json TEXT DEFAULT '{}',
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(guild_id, module_name)
);

-- Usuários mínimos (apenas IDs e dados essenciais)
CREATE TABLE IF NOT EXISTS users_minimal (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,
 display_name TEXT,
 joined_at TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(guild_id, user_id)
);

-- Tickets profissionais (M01)
CREATE TABLE IF NOT EXISTS tickets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 channel_id TEXT UNIQUE,
 ticket_seq INTEGER NOT NULL,
 owner_id TEXT NOT NULL,
 type TEXT NOT NULL DEFAULT 'support',
 priority TEXT NOT NULL DEFAULT 'normal',
 status TEXT NOT NULL DEFAULT 'open',
 reason TEXT,
 claimed_by TEXT,
 category_id TEXT,
 staff_role_id TEXT,
 tags TEXT DEFAULT '[]',
 sla_minutes INTEGER,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 closed_at TEXT,
 closed_by TEXT,
 archived_at TEXT,
 UNIQUE(guild_id, ticket_seq)
);

CREATE TABLE IF NOT EXISTS ticket_controls (
 ticket_id INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
 message_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
 event_type TEXT NOT NULL,
 actor_id TEXT,
 detail TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_participants (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,
 added_by TEXT,
 added_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(ticket_id, user_id)
);

-- Moderação (M02)
CREATE TABLE IF NOT EXISTS moderation_cases (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 case_number INTEGER NOT NULL,
 type TEXT NOT NULL,
 target_user_id TEXT NOT NULL,
 moderator_id TEXT NOT NULL,
 reason TEXT,
 evidence TEXT,
 duration_seconds INTEGER,
 status TEXT NOT NULL DEFAULT 'active',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 expires_at TEXT,
 resolved_at TEXT,
 UNIQUE(guild_id, case_number)
);

-- AutoMod (M03)
CREATE TABLE IF NOT EXISTS automod_rules (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 rule_name TEXT NOT NULL,
 rule_type TEXT NOT NULL,
 config_json TEXT NOT NULL DEFAULT '{}',
 action_type TEXT NOT NULL DEFAULT 'warn',
 severity INTEGER NOT NULL DEFAULT 1,
 enabled INTEGER NOT NULL DEFAULT 1,
 exceptions_json TEXT DEFAULT '{"roles":[],"channels":[],"users":[]}',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Anti-Raid (M04)
CREATE TABLE IF NOT EXISTS raid_incidents (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 incident_type TEXT NOT NULL,
 severity TEXT NOT NULL,
 mode TEXT NOT NULL DEFAULT 'alert',
 detail TEXT,
 snapshot_json TEXT,
 resolved INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 resolved_at TEXT
);

-- Níveis (M08)
CREATE TABLE IF NOT EXISTS level_profiles (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,
 xp INTEGER NOT NULL DEFAULT 0,
 level INTEGER NOT NULL DEFAULT 1,
 last_xp_at TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS level_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,
 xp_gained INTEGER NOT NULL,
 source TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sorteios (M10)
CREATE TABLE IF NOT EXISTS giveaways (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 channel_id TEXT NOT NULL,
 message_id TEXT,
 prize TEXT NOT NULL,
 winners_count INTEGER NOT NULL DEFAULT 1,
 ends_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active',
 requirements_json TEXT DEFAULT '{}',
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 ended_at TEXT
);

CREATE TABLE IF NOT EXISTS giveaway_entries (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 giveaway_id INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,
 entered_at TEXT NOT NULL DEFAULT (datetime('now')),
 winner INTEGER NOT NULL DEFAULT 0,
 UNIQUE(giveaway_id, user_id)
);

-- Enquetes (M11)
CREATE TABLE IF NOT EXISTS polls (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 channel_id TEXT NOT NULL,
 message_id TEXT,
 question TEXT NOT NULL,
 options_json TEXT NOT NULL,
 anonymous INTEGER NOT NULL DEFAULT 0,
 ends_at TEXT,
 status TEXT NOT NULL DEFAULT 'active',
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 closed_at TEXT
);

-- Formulários (M12)
CREATE TABLE IF NOT EXISTS forms (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 form_name TEXT NOT NULL,
 form_type TEXT NOT NULL,
 fields_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active',
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS form_submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,
 answers_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 reviewer_id TEXT,
 review_note TEXT,
 submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
 reviewed_at TEXT
);

-- Jobs agendados (M18)
CREATE TABLE IF NOT EXISTS scheduled_jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 job_type TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 run_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 executed_at TEXT,
 error TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Loja (M20)
CREATE TABLE IF NOT EXISTS store_products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 description TEXT,
 price_cents INTEGER NOT NULL DEFAULT 0,
 currency TEXT NOT NULL DEFAULT 'BRL',
 stock INTEGER,
 category TEXT,
 active INTEGER NOT NULL DEFAULT 1,
 metadata_json TEXT DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,
 product_id INTEGER REFERENCES store_products(id),
 quantity INTEGER NOT NULL DEFAULT 1,
 total_cents INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 payment_provider TEXT,
 payment_ref TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 paid_at TEXT,
 delivered_at TEXT
);

-- Auditoria
CREATE TABLE IF NOT EXISTS audit_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL,
 action TEXT NOT NULL,
 target_type TEXT,
 target_id TEXT,
 detail TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_settings_guild_module ON settings(guild_id, module);
CREATE INDEX IF NOT EXISTS idx_tickets_guild_status ON tickets(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_owner ON tickets(guild_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON ticket_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_moderation_guild_target ON moderation_cases(guild_id, target_user_id);
CREATE INDEX IF NOT EXISTS idx_level_profiles_guild ON level_profiles(guild_id, xp DESC);
CREATE INDEX IF NOT EXISTS idx_giveaways_status ON giveaways(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_run ON scheduled_jobs(status, run_at);
CREATE INDEX IF NOT EXISTS idx_audit_guild_created ON audit_events(guild_id, created_at);