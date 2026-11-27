"use strict";
const { EmbedBuilder, Events, MessageFlags } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('automod');

// Cache de regras por guild (guildId -> rules[])
const rulesCache = new Map();
const CACHE_TTL_MS = 60_000; // 1 min
const cacheTimestamps = new Map();

function getGuildSetting(guildId, key) {
 const row = queryGet(
 "SELECT value FROM settings WHERE guild_id = ? AND module = 'automod' AND key = ?",
 [guildId, key]
 );
 return row?.value || null;
}

function loadRules(guildId) {
 const cached = rulesCache.get(guildId);
 const ts = cacheTimestamps.get(guildId) || 0;
 if (cached && Date.now() - ts < CACHE_TTL_MS) return cached;

 const rows = queryAll(
 "SELECT * FROM automod_rules WHERE guild_id = ? AND enabled = 1 ORDER BY severity ASC",
 [guildId]
 );
 rulesCache.set(guildId, rows);
 cacheTimestamps.set(guildId, Date.now());
 return rows;
}

function invalidateCache(guildId) {
 rulesCache.delete(guildId);
 cacheTimestamps.delete(guildId);
}

// === Verificadores de regras ===

const CHECKERS = {
 bad_words: (content, config) => {
 const words = (config.words || []).map(w => w.toLowerCase());
 const lower = content.toLowerCase();
 return words.some(w => lower.includes(w));
 },
 links: (content, config) => {
 const allowed = (config.allowed_domains || []).map(d => d.toLowerCase());
 const urlRegex = /https?:\/\/[^\s]+/gi;
 const urls = content.match(urlRegex) || [];
 for (const url of urls) {
 let domain;
 try {domain=new URL(url).hostname.toLowerCase().replace(/\.$/,'');} catch {return true;}
 if (!allowed.some(a => domain===a || domain.endsWith('.'+a))) return true;
 }
 return false;
 },
 invites: (content) => {
 return /discord\.(gg|com\/invite)\/[\w-]+/i.test(content);
 },
 caps: (content, config) => {
 const threshold = config.threshold || 0.7;
 const minLen = config.min_length || 10;
 if (content.length < minLen) return false;
 const upperCount = [...content].filter(c => c >= 'A' && c <= 'Z').length;
 return (upperCount / content.length) > threshold;
 },
 spam_repeat: (content, config) => {
 const repetitions=Math.max(2,Math.min(100,Number(config.max_repeats)||5))-1;
 const charRepeat=new RegExp('(.)\\1{'+repetitions+',}','u');
 const wordRepeat=new RegExp('(\\b\\w+\\b)(\\s+\\1){'+repetitions+',}','i');
 return charRepeat.test(content) || wordRepeat.test(content);
 },
 mass_mentions: (content, config) => {
 const maxMentions = config.max_mentions || 5;
 const mentions = content.match(/<@!?\d+>/g) || [];
 return mentions.length > maxMentions;
 }
};

// === Ações de punição ===

async function executeAction(message, rule, context) {
 const actionType = rule.action_type || 'delete';
 const guildId = message.guild.id;
 const userId = message.author.id;

 try {
 switch (actionType) {
 case 'delete':
 await message.delete().catch(() => {});
 break;

 case 'warn':
 await message.delete().catch(() => {});
 // Registrar caso de moderação
 runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)', [guildId, message.guild.name]);
 const caseRow = queryGet('SELECT COALESCE(MAX(case_number), 0) + 1 as n FROM moderation_cases WHERE guild_id = ?', [guildId]);
 const caseNum = caseRow ? Number(caseRow.n) : 1;
 runSql(
 "INSERT INTO moderation_cases (guild_id, case_number, type, target_user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
 [guildId, caseNum, 'automod_warn', userId, context.client.user.id, `AutoMod: ${rule.rule_name}`]
 );
 // Notificar usuário
 try {
 await message.channel.send({
 content: `<@${userId}> ⚠️ Sua mensagem foi removida pelo AutoMod (${rule.rule_name}). Caso #${caseNum}.`,
 allowedMentions: { parse: ['users'] }
 }).then(m => setTimeout(() => m.delete().catch(() => {}), 8000));
 } catch { /* ignore */ }
 break;

 case 'timeout':
 await message.delete().catch(() => {});
 const durationMin = parseInt(rule.config_json ? JSON.parse(rule.config_json).timeout_minutes : '5', 10);
 const member = await message.guild.members.fetch(userId).catch(() => null);
 if (member && member.moderatable) {
 await member.timeout(durationMin * 60_000, `AutoMod: ${rule.rule_name}`).catch(() => {});
 }
 break;

 default:
 await message.delete().catch(() => {});
 }

 log.info({ guildId, userId, rule: rule.rule_name, action: actionType }, 'AutoMod: ação executada');
 } catch (err) {
 log.error({ err, guildId, rule: rule.rule_name }, 'AutoMod: falha ao executar ação');
 }
}

// === Handler principal de mensagens ===

async function handleMessage(message) {
 if (!message.guild || message.author.bot) return;

 // Verificar se módulo está habilitado
 const modRow = queryGet(
 "SELECT enabled FROM modules WHERE guild_id = ? AND module_name = 'automod'",
 [message.guild.id]
 );
 if (!modRow || !modRow.enabled) return;

 const rules = loadRules(message.guild.id);
 if (rules.length === 0) return;

 const content = message.content || '';

 for (const rule of rules) {
 let config = {};
 try { config = JSON.parse(rule.config_json || '{}'); } catch { /* ignore */ }

 // Verificar exceções
 let exceptions = { roles: [], channels: [], users: [] };
 try { exceptions = JSON.parse(rule.exceptions_json || '{}'); } catch { /* ignore */ }

 if (exceptions.users?.includes(message.author.id)) continue;
 if (exceptions.channels?.includes(message.channel.id)) continue;
 if (message.member?.roles?.cache?.some(r => exceptions.roles?.includes(r.id))) continue;

 // Executar verificador
 const checker = CHECKERS[rule.rule_type];
 if (!checker) continue;

 const triggered = checker(content, config);
 if (triggered) {
 await executeAction(message, rule, context);
 return; // Uma regra disparou → parar verificação
 }
 }
}

// === Comandos Slash ===

function getCommands() {
 const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
 return [
 new SlashCommandBuilder()
 .setName('automod')
 .setDescription('Gerencia regras do AutoMod.')
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
 .addSubcommand(s => s.setName('adicionar').setDescription('Adiciona uma regra de filtro automático')
 .addStringOption(o => o.setName('nome').setDescription('Nome da regra').setRequired(true).setMaxLength(50))
 .addStringOption(o => o.setName('tipo').setDescription('Tipo de filtro')
 .setRequired(true)
 .addChoices(
 { name: 'Palavras proibidas', value: 'bad_words' },
 { name: 'Links não permitidos', value: 'links' },
 { name: 'Convites Discord', value: 'invites' },
 { name: 'Excesso de CAPS', value: 'caps' },
 { name: 'Spam/Repetição', value: 'spam_repeat' },
 { name: 'Menções em massa', value: 'mass_mentions' }
 ))
 .addStringOption(o => o.setName('acao').setDescription('Ação ao detectar')
 .setRequired(false)
 .addChoices(
 { name: 'Deletar mensagem', value: 'delete' },
 { name: 'Deletar + Advertir', value: 'warn' },
 { name: 'Deletar + Timeout', value: 'timeout' }
 ))
 .addStringOption(o => o.setName('config').setDescription('JSON de configuração (opcional)').setRequired(false)))
 .addSubcommand(s => s.setName('listar').setDescription('Lista todas as regras do AutoMod'))
 .addSubcommand(s => s.setName('remover').setDescription('Remove uma regra pelo nome')
 .addStringOption(o => o.setName('nome').setDescription('Nome da regra').setRequired(true)))
 .addSubcommand(s => s.setName('testar').setDescription('Testa uma mensagem contra as regras ativas')
 .addStringOption(o => o.setName('texto').setDescription('Texto para testar').setRequired(true)))
 ];
}

// === Handlers de comandos ===

async function handleAdd(interaction) {
 const name = interaction.options.getString('nome', true);
 const type = interaction.options.getString('tipo', true);
 const action = interaction.options.getString('acao') || 'delete';
 const configStr = interaction.options.getString('config') || '{}';

 let config = {};
 try { config = JSON.parse(configStr); } catch {
 return interaction.reply({ content: '❌ JSON de configuração inválido.', flags: MessageFlags.Ephemeral });
 }

 runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
 [interaction.guildId, interaction.guild.name]);

 // Verificar duplicata
 const existing = queryGet(
 "SELECT id FROM automod_rules WHERE guild_id = ? AND rule_name = ?",
 [interaction.guildId, name]
 );
 if (existing) {
 return interaction.reply({ content: `❌ Já existe uma regra chamada "${name}".`, flags: MessageFlags.Ephemeral });
 }

 runSql(
 "INSERT INTO automod_rules (guild_id, rule_name, rule_type, config_json, action_type, severity) VALUES (?, ?, ?, ?, ?, ?)",
 [interaction.guildId, name, type, JSON.stringify(config), action, 1]
 );

 // Habilitar módulo
 runSql(
 "INSERT OR REPLACE INTO modules (guild_id, module_name, enabled) VALUES (?, ?, 1)",
 [interaction.guildId, 'automod']
 );

 invalidateCache(interaction.guildId);

 log.info({ guildId: interaction.guildId, ruleName: name, type, action }, 'Regra AutoMod adicionada');
 return interaction.reply({
 content: `✅ Regra **${name}** adicionada! Tipo: \`${type}\` | Ação: \`${action}\``,
 flags: MessageFlags.Ephemeral
 });
}

async function handleList(interaction) {
 const rules = queryAll(
 "SELECT * FROM automod_rules WHERE guild_id = ? ORDER BY severity ASC",
 [interaction.guildId]
 );

 if (rules.length === 0) {
 return interaction.reply({ content: 'Nenhuma regra configurada. Use `/automod adicionar` para criar.', flags: MessageFlags.Ephemeral });
 }

 const lines = rules.map(r => {
 const status = r.enabled ? '🟢' : '🔴';
 return `${status} **${r.rule_name}** [\`${r.rule_type}\`] → ${r.action_type} (severidade: ${r.severity})`;
 }).join('\n');

 const embed = new EmbedBuilder()
 .setTitle('🛡️ Regras do AutoMod')
 .setDescription(lines)
 .setColor(0x22c55e)
 .setTimestamp();

 return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleRemove(interaction) {
 const name = interaction.options.getString('nome', true);

 const rule = queryGet(
 "SELECT id FROM automod_rules WHERE guild_id = ? AND rule_name = ?",
 [interaction.guildId, name]
 );
 if (!rule) {
 return interaction.reply({ content: `❌ Regra "${name}" não encontrada.`, flags: MessageFlags.Ephemeral });
 }

 runSql("DELETE FROM automod_rules WHERE id = ?", [rule.id]);
 invalidateCache(interaction.guildId);

 log.info({ guildId: interaction.guildId, ruleName: name }, 'Regra AutoMod removida');
 return interaction.reply({ content: `✅ Regra **${name}** removida!`, flags: MessageFlags.Ephemeral });
}

async function handleTest(interaction) {
 const text = interaction.options.getString('texto', true);
 const rules = loadRules(interaction.guildId);

 if (rules.length === 0) {
 return interaction.reply({ content: 'Nenhuma regra ativa para testar.', flags: MessageFlags.Ephemeral });
 }

 const triggered = [];
 for (const rule of rules) {
 let config = {};
 try { config = JSON.parse(rule.config_json || '{}'); } catch { continue; }
 const checker = CHECKERS[rule.rule_type];
 if (checker && checker(text, config)) {
 triggered.push(`**${rule.rule_name}** [\`${rule.rule_type}\`] → ${rule.action_type}`);
 }
 }

 if (triggered.length === 0) {
 return interaction.reply({ content: '✅ Nenhuma regra foi disparada pelo texto fornecido.', flags: MessageFlags.Ephemeral });
 }

 const embed = new EmbedBuilder()
 .setTitle('🧪 Resultado do Teste')
 .setDescription(`Regras disparadas:\n${triggered.join('\n')}`)
 .setColor(0xf59e0b)
 .setTimestamp();

 return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// === Contrato do Módulo ===

let context = null;
let _messageHandler = null;

module.exports = {
 name: 'automod',
 getCommands,

 async init(ctx) {
 context = ctx;
 log.info('Módulo AutoMod inicializado');
 },

 async start() {
 if (!context?.client) return;

 _messageHandler = (message) => {
      if (process.env.GUILD_ID && message.guild?.id !== process.env.GUILD_ID) return;
 handleMessage(message).catch(err =>
 log.error({ err }, 'Erro no handler AutoMod')
 );
 };
 context.client.on(Events.MessageCreate, _messageHandler);

 if (context.bus) {
 context.bus.on('interaction:create', async ({ interaction }) => {
 if (!interaction.inGuild() || !interaction.isChatInputCommand()) return;
 if (interaction.commandName !== 'automod') return;

 const sub = interaction.options.getSubcommand();
 switch (sub) {
 case 'adicionar': return handleAdd(interaction);
 case 'listar': return handleList(interaction);
 case 'remover': return handleRemove(interaction);
 case 'testar': return handleTest(interaction);
 }
 });
 }

 log.info('Módulo AutoMod iniciado — handlers registrados');
 },

 async stop() {
 if (context?.client && _messageHandler) {
 context.client.off(Events.MessageCreate, _messageHandler);
 _messageHandler = null;
 }
 rulesCache.clear();
 cacheTimestamps.clear();
 log.info('Módulo AutoMod parado');
 },

 health() {
 const totalRules = queryGet('SELECT COUNT(*) as c FROM automod_rules WHERE enabled = 1');
 return {
 status: 'ok',
 activeRules: totalRules ? Number(totalRules.c) : 0,
 cachedGuilds: rulesCache.size
 };
 }
};