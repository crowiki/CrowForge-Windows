"use strict";
require('dotenv').config();
const path = require('node:path');
const {PermissionsBitField} = require('discord.js');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('panel-api');

const catalog=require('../../installer/lib/catalog.json');
function currentModules(rows) {
 return rows.filter(row=>Object.hasOwn(catalog,row.module_name));
}
const PORT = parseInt(process.env.PANEL_PORT || '3000', 10);
const HOST = '127.0.0.1'; // Apenas localhost — nunca expor à internet por padrão
async function buildServer({client, openBotManager, gatewayIntents={}, synchronize=async()=>{throw Error("Bot desconectado.");}, gateway=()=>({status:'offline',uptime:0})}={}) {
 const app = Fastify({ logger: false });

 // Somente nomes de loopback e requisições do próprio painel.
 app.addHook('onRequest', async (request, reply) => {
   const host = request.headers.host;
   const origin = request.headers.origin;
   if (!/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(host || '') ||
       (origin && origin !== 'http://' + host) ||
       request.headers['sec-fetch-site'] === 'cross-site') {
     return reply.code(403).send({ error: 'Acesso permitido apenas pelo painel local.' });
   }
   reply.header('X-Frame-Options', 'DENY');
   reply.header('Cache-Control', 'no-store');
 });

 // Servir frontend estático (build do Vite)
 const dashboardDist = path.join(__dirname, '..', 'dashboard', 'dist');
 await app.register(fastifyStatic, {
 root: dashboardDist,
 prefix: '/',
 decorateReply: true
 });

 app.post('/api/alerts/webhook/:guildId/:name', async (request,reply)=>{
   const {guildId,name}=request.params;
   if(!request.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply.code(415).send({error:'Envie JSON.'});
   if(!client?.isReady() || !require('../../modules/state').isEnabled(guildId,'alerts')) return reply.code(503).send({error:'Alertas indisponíveis.'});
   const config=queryGet("SELECT channel_id,message_template FROM alert_configs WHERE guild_id=? AND type='webhook' AND source=? AND enabled=1",[guildId,name]);
   if(!config)return reply.code(404).send({error:'Alerta desconhecido.'});
   const {title,message}=request.body || {};
   if(typeof message!=='string' || !message.trim() || message.length>1800 || (title!==undefined && (typeof title!=='string' || title.length>150)))
     return reply.code(400).send({error:'Informe uma mensagem de até 1800 caracteres.'});
   const target=await client.guilds.cache.get(guildId)?.channels.fetch(config.channel_id);
   if(!target?.isSendable())return reply.code(409).send({error:'Canal indisponível.'});
   const body=[title,message].filter(Boolean).join('\n');
   const content=(config.message_template || '{mensagem}').replace(/\{(nome|mensagem)\}/g,(_,key)=>key==='nome'?name:body);
   await target.send({content:content.slice(0,2000),allowedMentions:{parse:[]}});
   return {ok:true};
 });
 app.post('/api/bot/gerenciar',async (request,reply)=>{
   if (!request.headers['content-type']?.startsWith('application/json')) return reply.code(415).send({error:'Envie JSON.'});
   if (!openBotManager) return reply.code(409).send({error:'Abra o CrowForge pelo ícone perto do relógio para gerenciar seu bot.'});
   await openBotManager();
   return {ok:true};
 });
 app.get('/api/status', async () => {
 const guilds = queryAll('SELECT guild_id, name, profile, created_at FROM guilds ORDER BY created_at DESC');
 const modules = queryAll('SELECT guild_id, module_name, enabled FROM modules ORDER BY guild_id, module_name');
 const ticketStats = queryGet(`
 SELECT
 COUNT(*) as total,
 SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
 SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count
 FROM tickets
 `);
 const modStats = queryGet('SELECT COUNT(*) as total FROM moderation_cases');
 return {
 bot: gateway(),
 missingGuild: Boolean(process.env.GUILD_ID && client?.isReady() && !client.guilds.cache.has(process.env.GUILD_ID)),
 guilds: guilds.length,
 tickets: ticketStats || { total: 0, open_count: 0, closed_count: 0 },
 moderation: modStats || { total: 0 },
 modules: currentModules(modules)
 };
 });

 app.get('/api/guilds', async () => {
 return queryAll('SELECT * FROM guilds ORDER BY name ASC');
 });

 app.get('/api/guilds/:guildId/settings', async (request) => {
 const { guildId } = request.params;
 return queryAll('SELECT * FROM settings WHERE guild_id = ? ORDER BY module, key', [guildId]);
 });

 app.put('/api/guilds/:guildId/settings', async (request, reply) => {
 const { guildId } = request.params;
 const { module: mod, key, value } = request.body || {};
 if (!mod || !key) {
 return reply.code(400).send({ error: 'module e key são obrigatórios' });
 }
 runSql(
 'INSERT OR REPLACE INTO settings (guild_id, module, key, value) VALUES (?, ?, ?, ?)',
 [guildId, mod, key, value ?? null]
 );
 log.info({ guildId, module: mod, key }, 'Configuração atualizada via painel');
 return { ok: true };
 });

 app.get('/api/modules', async (request) => {
 const { guildId } = request.query;
 if (guildId) {
 return currentModules(queryAll('SELECT * FROM modules WHERE guild_id = ? ORDER BY module_name', [guildId]));
 }
 return currentModules(queryAll('SELECT * FROM modules ORDER BY guild_id, module_name'));
 });

 app.put('/api/modules/:guildId/:moduleName/toggle', async (request,reply) => {
   const {guildId,moduleName}=request.params;
   if (process.env.GUILD_ID && guildId!==process.env.GUILD_ID) return reply.code(403).send({error:'Servidor fora da instalação.'});
   const row=queryGet('SELECT enabled FROM modules WHERE guild_id=? AND module_name=?',[guildId,moduleName]);
   if(!row) return reply.code(404).send({error:'Módulo desconhecido.'});
   const enabled=request.body?.enabled ?? !row.enabled;
   if(typeof enabled!=='boolean') return reply.code(400).send({error:'Estado inválido.'});
   if (!Object.hasOwn(catalog,moduleName)) return reply.code(404).send({error:'Módulo desconhecido.'});
   if (gateway().status!=='running') return reply.code(409).send({error:'Aguardando a conexão do bot ao Discord. O painel verifica a conexão automaticamente.'});
   const labels={members:'Server Members Intent',content:'Message Content Intent'};
   const missing=catalog[moduleName].intents.filter(key=>!gatewayIntents[key]);
   if (enabled && missing.length) return reply.code(409).send({error:'Na aba Bot do Discord Developer Portal, ative '+missing.map(key=>labels[key]).join(' e ')+'. Depois, pare e inicie o bot pelo CrowForge.'});
   try {
     await require('../../modules/state').setEnabled(guildId,moduleName,enabled,synchronize);
     const permissions=client?.guilds.cache.get(guildId)?.members.me?.permissions;
     const missingBits=enabled && permissions ? catalog[moduleName].permissions.filter(bit=>!permissions.has(BigInt(bit))).map(BigInt) : [];
     const missingNames=new PermissionsBitField(missingBits).toArray();
     return {module:moduleName,enabled,warning:missingNames.length?'Módulo ativado. Em Configurações do servidor → Cargos, conceda ao cargo do bot: '+missingNames.join(', ')+'.':undefined};
   } catch(err) {
     log.warn({guildId,moduleName,code:err.code,status:err.status,name:err.name},'Falha no registro dos comandos');
     if (Number.isFinite(err.retryAfter) || err.status===429) return reply.code(429).send({error:'O Discord limitou o registro de comandos. Tente novamente em alguns instantes.'});
     if ([50001,50013].includes(err.code)) return reply.code(403).send({error:'O Discord recusou o acesso. Confira o convite da aplicação e o acesso do bot a este servidor.'});
     return reply.code(503).send({error:'O registro dos comandos não foi confirmado. Confira a conexão com o Discord e tente novamente pelo interruptor.'});
   }
 });
 // Healthcheck público (sem auth)
 app.get('/health', async () => {
 return { status: 'ok', timestamp: new Date().toISOString() };
 });

 // SPA fallback — servir index.html para rotas não-API
 app.setNotFoundHandler((request, reply) => {
 if (request.url.startsWith('/api/')) {
 return reply.code(404).send({ error: 'Rota não encontrada' });
 }
 // Para rotas do frontend, servir index.html (SPA routing)
 return reply.sendFile('index.html');
 });

 return app;
}

async function startPanel(options) {
 try {
 const app = await buildServer(options);
 await app.listen({ port: PORT, host: HOST });
 log.info({ url: `http://${HOST}:${PORT}` }, 'Painel administrativo iniciado');
 console.log(`\n🖥️ Painel CrowForge disponível em: http://${HOST}:${PORT}\n`);
 return app;
 } catch (err) {
 log.error({ err }, 'Falha ao iniciar painel');
 throw err;
 }
}

// Exportar para uso pelo bootstrap do bot ou standalone
module.exports = { buildServer, startPanel };

// Executar standalone se chamado diretamente
if (require.main === module) {
 startPanel().catch(err => {
 console.error('Erro:', err.message);
 process.exit(1);
 });
}