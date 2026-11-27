const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// Caminho do projeto CrowForge (pasta pai do installer)
const PROJECT_PATH = process.env.CROWFORGE_RUNTIME || path.resolve(__dirname, '..', '..');
const DATA_ROOT = process.env.CROWFORGE_DATA_DIR || PROJECT_PATH;
const bundled = !!process.env.CROWFORGE_RUNTIME;
const nodeExe = bundled ? path.join(PROJECT_PATH,'node.exe') : 'node';
fs.mkdirSync(DATA_ROOT,{recursive:true});
let botProcess = null;
let onManageBot;

// === Permissões por módulo ===
const catalog = require('./catalog.json');
const MODULE_PERMISSIONS = Object.fromEntries(Object.entries(catalog).map(([name,mod])=>[name,mod.permissions]));

const BASE_PERMISSIONS = {
 ViewChannel: 0x400,
 SendMessages: 0x800,
 ReadMessageHistory: 0x10000,
 EmbedLinks: 0x4000,
 AttachFiles: 0x8000,
 UseApplicationCommands: 0x80000000
};

// === Utilitários ===

function httpGet(url, headers = {}) {
 return new Promise((resolve, reject) => {
 const urlObj = new URL(url);
 const options = {
 hostname: urlObj.hostname,
 path: urlObj.pathname + urlObj.search,
 method: 'GET',
 headers: { 'User-Agent': 'CrowForgeInstaller/1.0', ...headers }
 };
 const req = https.request(options, (res) => {
 let data = '';
 res.on('data', chunk => data += chunk);
 res.on('end', () => {
 try {
 resolve({ status: res.statusCode, data: JSON.parse(data) });
 } catch {
 resolve({ status: res.statusCode, data });
 }
 });
 });
 req.on('error', reject);
 req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
 req.end();
 });
}

function runCommand(cmd, args, cwd, timeoutMs = 300000) {
 return new Promise((resolve, reject) => {
 const opts = { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 };
 // No Windows, execFile precisa de shell:true para resolver .cmd/.bat (npm, npx, etc.)
 if (process.platform === 'win32' && ['npm','npm.cmd'].includes(cmd)) opts.shell = true;
 const proc = execFile(cmd, args, opts, (err, stdout, stderr) => {
 if (err) reject({ error: err.message, stdout, stderr });
 else resolve({ stdout, stderr });
 });
 });
}

// === Persistência de Estado ===
const STATE_FILE = path.join(DATA_ROOT, 'data', '.installer-state.json');

function loadState() {
 try {
 if (fs.existsSync(STATE_FILE)) {
 return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
 }
 } catch { /* ignora arquivo corrompido */ }
 return null;
}

function saveState(state) {
 try {
 const dataDir = path.dirname(STATE_FILE);
 if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
 replaceEnv(STATE_FILE,JSON.stringify(state,null,2));
 return { success: true };
 } catch (err) {
 return { success: false, error: err.message };
 }
}

const envAssignment = /^([ \t]*(?:export[ \t]+)?)([\w.-]+)[ \t]*=[ \t]*(?:"(?:\\.|[^"\\])*"|'[^']*'|`[^`]*`|[^#\r\n]*)([ \t]*(?:#[^\r\n]*)?)(?=\r?$)/gm;
let changingProfile=false;
function savedEnv() {
 const file=path.join(DATA_ROOT,'.env');
 if (!fs.existsSync(file)) return {};
 const dotenv=require(require.resolve('dotenv',{paths:[PROJECT_PATH,__dirname]}));
 return dotenv.parse(fs.readFileSync(file));
}
async function checkSavedMembership(request=httpGet) {
 const env=savedEnv();
 if (!env.DISCORD_TOKEN) return {status:'signedOut'};
 if (!/^\d{17,20}$/.test(env.GUILD_ID)) return {status:'unknown'};
 try {
   const res=await request('https://discord.com/api/v10/guilds/'+env.GUILD_ID,{Authorization:'Bot '+env.DISCORD_TOKEN});
   if (res.status===200 && res.data?.id===env.GUILD_ID) return {status:'member',name:res.data.name};
   if (res.status===403 || res.status===404) return {status:'missing'};
   if (res.status===401) return {status:'invalid'};
 } catch {}
 return {status:'unknown'};
}
function replaceEnv(file,content) {
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';
 try {fs.writeFileSync(tmp,content,{encoding:'utf8',flag:'wx',mode:0o600});fs.renameSync(tmp,file);}
 finally {fs.rmSync(tmp,{force:true});}
}
async function changeBotProfile(action) {
 if (!['logout','remove'].includes(action) || changingProfile) return {success:false,error:'Operação indisponível.'};
 changingProfile=true;
 try {
   await stopBot();
   const file=path.join(DATA_ROOT,'.env');
   if (action==='remove') {
     fs.rmSync(file,{force:true});
     fs.rmSync(STATE_FILE,{force:true});
   } else if(fs.existsSync(file)) {
     const original=fs.readFileSync(file,'utf8');
     const updated=original.replace(envAssignment,(line,prefix,key)=>key==='DISCORD_TOKEN'?'DISCORD_TOKEN=':line);
     replaceEnv(file,updated);
   }
   return {success:true};
 } catch {return {success:false,error:'Não foi possível atualizar os arquivos locais do bot.'};}
 finally {changingProfile=false;}
}
function getInstallationState() {
 const state = loadState();
 if (!state) return { installed: false };

 // Verificar se a instalação ainda é válida
 const envPath = path.join(DATA_ROOT, '.env');
 const nmPath = path.join(PROJECT_PATH, 'node_modules');
 const hasEnv = fs.existsSync(envPath);
 const hasDeps = fs.existsSync(nmPath);
 const env=savedEnv();

 return {
 installed: Boolean(state.installed && hasEnv && hasDeps && (!state.clientId || state.clientId===env.CLIENT_ID) && (!state.guildId || state.guildId===env.GUILD_ID)),
 signedOut: !env.DISCORD_TOKEN,
 guildId: state.guildId || env.GUILD_ID,
 botUser: state.botUser || null,
 clientId: state.clientId || null,
 modules: state.modules || [],
 installedAt: state.installedAt || null,
 hasEnv,
 hasDeps
 };
}

// === Funções exportadas ===

async function checkEnvironment() {
 const result = {
 nodejs: { installed: false, version: null, valid: false },
 npm: { installed: false, version: null },
 internet: false,
 writePermission: false,
 portAvailable: true,
 projectExists: false
 };

 // Node.js
 try {
 const { stdout } = await runCommand(nodeExe, ['-v'], PROJECT_PATH);
 result.nodejs.version = stdout.trim();
 result.nodejs.installed = true;
 const parts = result.nodejs.version.replace('v', '').split('.').map(Number);
 result.nodejs.valid = parts[0] >= 22 && !(parts[0] === 22 && parts[1] < 12);
 } catch { /* não instalado */ }

 // npm
 try {
 if (bundled) { result.npm = {installed:fs.existsSync(path.join(PROJECT_PATH,'node_modules','discord.js')),version:'dependências incluídas'}; } else {
 const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
 const { stdout } = await runCommand(npmCmd, ['-v'], PROJECT_PATH);
 result.npm.version = stdout.trim();
 result.npm.installed = true;
 }
 } catch { /* não instalado */ }

 // Internet
 try {
 const resp = await httpGet('https://discord.com/api/v10/gateway');
 result.internet = resp.status === 200;
 } catch { /* sem internet */ }

 // Permissão de escrita
 try {
 const testFile = path.join(DATA_ROOT, '.write_test_' + Date.now());
 fs.writeFileSync(testFile, 'test');
 fs.unlinkSync(testFile);
 result.writePermission = true;
 } catch { /* sem permissão */ }

 // Projeto existe
 result.projectExists = fs.existsSync(path.join(PROJECT_PATH, 'package.json'));

 return result;
}

async function validateCredentials(clientId, token) {
 const result = { valid: false, botUser: null, error: null, intents: { messageContent: false, serverMembers: false } };

 if (!clientId || !token) {
 result.error = 'Application ID e Token são obrigatórios.';
 return result;
 }

 try {
 const resp = await httpGet('https://discord.com/api/v10/users/@me', { Authorization: `Bot ${token}` });

 if (resp.status === 200 && resp.data.id) {
 if (resp.data.id !== clientId || !resp.data.bot) return { ...result, error: 'O Application ID não corresponde ao bot do token.' };
 result.valid = true;
 result.botUser = { id: resp.data.id, username: resp.data.username, discriminator: resp.data.discriminator, avatar: resp.data.avatar };
 } else if (resp.status === 401) {
 result.error = 'Token inválido ou expirado. Gere um novo token no Discord Developer Portal.';
 } else {
 result.error = `Erro da API Discord (${resp.status}): ${JSON.stringify(resp.data)}`;
 }
 } catch (err) {
 result.error = `Falha na conexão com Discord: ${err.message}`;
 }

 return result;
}

function checkIntents(token, request = httpGet) {
 return require('./gateway-intents').checkIntents(token,request);
}

function generateInviteLink(clientId, enabledModules) {
 let perms = 0n;

 // Permissões base
 for (const val of Object.values(BASE_PERMISSIONS)) {
 perms |= BigInt(val);
 }

 // Permissões dos módulos habilitados
 const modules = enabledModules || Object.keys(MODULE_PERMISSIONS);
 for (const mod of modules) {
 const modPerms = MODULE_PERMISSIONS[mod];
 if (modPerms) {
 for (const val of Object.values(modPerms)) {
 perms |= BigInt(val);
 }
 }
 }

 const url = `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot+applications.commands&permissions=${perms.toString()}`;
 return { url, permissions: perms.toString(), modules: modules };
}

async function verifyBotInGuild({ token, guildId, clientId, modules }, request = httpGet) {
 if (!token || !/^\d{17,20}$/.test(clientId)) return {found:false,error:'Volte à etapa de credenciais e valide o Application ID e o token do bot.'};
 if (typeof guildId !== 'string' || !/^\d{17,20}$/.test(guildId)) return {found:false,error:'Cole o ID completo do servidor (17 a 20 dígitos). Use Copiar ID do servidor no menu do ícone do servidor.'};
 const endpoint = 'https://discord.com/api/v10/guilds/' + guildId;
 const headers = { Authorization: 'Bot ' + token };
 const errors = {401: 'O Discord recusou o token. Volte à etapa de credenciais e valide o token atual desta aplicação.', 403: 'O bot não tem acesso a este servidor. Confira se o convite foi concluído para esta aplicação no servidor desejado.', 429: 'Discord limitou as consultas. Aguarde antes de tentar novamente.'};
 try {
 const guild = await request(endpoint, headers);
 if (guild.status !== 200) return {found:false, error:guild.status===404 ? 'O Discord não localizou este servidor para o bot. Confira o ID copiado pelo ícone do servidor e se o bot validado aparece na lista de membros.' : errors[guild.status] || 'Discord indisponível.'};
 if (guild.data.id !== guildId) return {found:false, error:'O servidor retornado difere do informado.'};
 const member = await request(endpoint + '/members/' + clientId, headers);
 if (member.status !== 200) return {found:false, error:member.status===404 ? 'Servidor localizado, mas o Discord não encontrou o bot como membro. Confira o Application ID e o convite desse bot.' : member.status===403 ? 'Servidor localizado, mas o Discord negou a consulta ao membro do bot.' : errors[member.status] || 'Falha ao confirmar o membro do bot.'};
 const roles = new Set([guildId, ...member.data.roles]);
 const permissions = guild.data.roles.filter(r => roles.has(r.id)).reduce((mask,r) => mask | BigInt(r.permissions), 0n);
 const required = BigInt(generateInviteLink('', modules).permissions);
 if (!(permissions & 8n) && (permissions & required) !== required)
 return {found:false, error:'Confira as permissões do cargo do bot para os módulos selecionados.'};
 return {found:true, guildName:guild.data.name};
 } catch {
 return {found:false,error:'Falha ao consultar o Discord. Confira a conexão e tente novamente.'};
 }
}

async function writeEnvFile(config) {
 const envPath = path.join(DATA_ROOT, '.env');
 if (!config || typeof config.token !== 'string' || /[\r\n]/.test(config.token) || !config.token ||
 !/^\d{17,20}$/.test(config.clientId) || !/^\d{17,20}$/.test(config.guildId) ||
 !Array.isArray(config.modules) || !config.modules.every(m=>Object.hasOwn(MODULE_PERMISSIONS,m)))
 return {success:false,error:'Configuração inválida. Confira as credenciais e o servidor.'};

 // Determinar intents necessários com base nos módulos selecionados
 const modules = config.modules || [];
 const needsMessageContent = modules.some(m => catalog[m].intents.includes('content'));
 const needsGuildMembers = modules.some(m => catalog[m].intents.includes('members'));

 if ((needsMessageContent || needsGuildMembers) && config.confirmedIntents !== true)
 return {success:false,error:'Confirme a ativação das intents no Portal do Discord.'};
 const freshDb='./data/crowbot-'+crypto.randomUUID()+'.db';
 const defaultDb=fs.existsSync(path.join(DATA_ROOT,'data','crowbot.db'))?freshDb:'./data/crowbot.db';
 const content = `# CrowForge - Configuração gerada pelo instalador
# ${new Date().toISOString()}

DISCORD_TOKEN=${config.token}
CLIENT_ID=${config.clientId}
GUILD_ID=${config.guildId || ''}
PANEL_PORT=${config.panelPort || 3000}
DATABASE_PATH=${defaultDb}
# Intents conforme os módulos e a confirmação no Portal.
ENABLE_MESSAGE_CONTENT=${needsMessageContent}
ENABLE_GUILD_MEMBERS=${needsGuildMembers}
# Módulos ativos (separados por vírgula). Lista vazia significa nenhum módulo.
MODULE_SELECTION_VERSION=1
ENABLED_MODULES=${config.modules ? config.modules.join(',') : ''}
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
YOUTUBE_API_KEY=
REDIS_URL=
LICENSE_PUBLIC_KEY=
LOG_LEVEL=info
`;

 try {
 if (fs.existsSync(envPath)) {
   const original = fs.readFileSync(envPath, 'utf8');
   const previous=savedEnv();
   if (previous.CLIENT_ID && previous.CLIENT_ID!==config.clientId) {
     replaceEnv(envPath,content.replace('DATABASE_PATH='+defaultDb,'DATABASE_PATH='+freshDb));
     return {success:true};
   }
   const values = new Map(Object.entries({
     DISCORD_TOKEN: config.token, CLIENT_ID: config.clientId, GUILD_ID: config.guildId,
     ENABLE_MESSAGE_CONTENT: String(needsMessageContent), ENABLE_GUILD_MEMBERS: String(needsGuildMembers),
     MODULE_SELECTION_VERSION: '1', ENABLED_MODULES: modules.join(',')
   }));
   if(previous.GUILD_ID && previous.GUILD_ID!==config.guildId) values.set('DATABASE_PATH',freshDb);
   const seen = new Set();
   // Percorre atribuições inteiras para não alterar texto dentro de valores multilinha.

   let updated = original.replace(envAssignment, (line, prefix, key, comment) => {
     if (!values.has(key)) return line;
     seen.add(key);
     return prefix + key + '=' + values.get(key) + (comment.trim() ? ' ' + comment.trimStart() : '');
   });
   const newline = original.includes('\r\n') ? '\r\n' : '\n';
   for (const [key,value] of values) {
     if (seen.has(key)) continue;
     if (updated && !updated.endsWith('\n')) updated += newline;
     updated += key + '=' + value + newline;
   }
   if (updated !== original) {
     replaceEnv(envPath,updated);
   }
   return {success:true};
 }
 fs.writeFileSync(envPath, content, {encoding:'utf8',flag:'wx',mode:0o600});
 return { success: true, path: envPath };
 } catch (err) {
 return { success: false, error: err.message };
 }
}

async function installDependencies(projectPath) {
 if (bundled) return fs.existsSync(path.join(PROJECT_PATH,'node_modules','discord.js')) ? {success:true} : {success:false,error:'Runtime incompleto. Reinstale o aplicativo.'};
 const targetPath = projectPath || PROJECT_PATH;
 try {
 const { stdout, stderr } = await runCommand('npm', ['install', '--no-audit', '--no-fund'], targetPath, 600000);
 return { success: true, output: stdout + stderr };
 } catch (err) {
 return { success: false, error: err.error || err.message, output: (err.stdout || '') + (err.stderr || '') };
 }
}

async function deployCommands(projectPath) {
 const targetPath = projectPath || PROJECT_PATH;
 const scriptPath = path.join(targetPath, 'apps', 'bot', 'deploy-commands.js');

 if (!fs.existsSync(scriptPath)) {
 return { success: false, error: 'Script deploy-commands.js não encontrado.' };
 }

 // Ler .env para verificar se há GUILD_ID e validar pré-condições
 const envPath = path.join(DATA_ROOT, '.env');
 let hasGuildId = false;
 let token = '';
 if (fs.existsSync(envPath)) {
 const envContent = fs.readFileSync(envPath, 'utf8');
 const guildMatch = envContent.match(/^GUILD_ID=(.+)$/m);
 hasGuildId = guildMatch && guildMatch[1].trim().length > 0;
 const tokenMatch = envContent.match(/^DISCORD_TOKEN=(.+)$/m);
 if (tokenMatch) token = tokenMatch[1].trim();
 }

 // Se registro global (sem GUILD_ID), verificar se o bot está em algum servidor
 if (!hasGuildId && token) {
 try {
 const resp = await httpGet('https://discord.com/api/v10/users/@me/guilds', { Authorization: `Bot ${token}` });
 if (resp.status === 200 && Array.isArray(resp.data) && resp.data.length === 0) {
 return {
 success: false,
 error: 'O bot ainda não foi convidado a nenhum servidor.\n\nPara registrar comandos globalmente, o bot precisa estar em pelo menos um servidor Discord.\n\nVolte à etapa anterior e clique em "Gerar Link e Convidar Bot" para adicionar o bot a um servidor primeiro.',
 needsInvite: true
 };
 }
 } catch { /* ignora — deixa o deploy-commands.js reportar o erro */ }
 }

 try {
 // Envolver caminho em aspas para lidar com espaços no path (ex: "Claude Code")
 const quotedPath = `"${scriptPath}"`;
 const { stdout, stderr } = await runCommand(nodeExe, [scriptPath], DATA_ROOT, 60000);
 const combined = stdout + stderr;

 // Detectar erro de autorização específico do Discord
 if (combined.includes('not authorized') || combined.includes('403')) {
 return {
 success: false,
 error: 'O Discord rejeitou o registro de comandos.\n\nPossíveis causas:\n• O bot não foi convidado a nenhum servidor ainda\n• O Application ID não corresponde ao token fornecido\n\nVolte à etapa de convite e confirme que o bot foi adicionado a um servidor.',
 needsInvite: true
 };
 }

 return { success: true, output: combined };
 } catch (err) {
 const output = (err.stdout || '') + (err.stderr || '');
 const errorMsg = err.error || err.message || '';

 // Detectar erro de autorização no catch também
 if (errorMsg.includes('not authorized') || output.includes('not authorized') || errorMsg.includes('403') || output.includes('403')) {
 return {
 success: false,
 error: 'O Discord rejeitou o registro de comandos.\n\nPossíveis causas:\n• O bot não foi convidado a nenhum servidor ainda\n• O Application ID não corresponde ao token fornecido\n\nVolte à etapa de convite e confirme que o bot foi adicionado a um servidor.',
 needsInvite: true
 };
 }

 return { success: false, error: errorMsg, output };
 }
}

async function startBot(projectPath) {
 if (changingProfile || !savedEnv().DISCORD_TOKEN) return {success:false,error:'Entre com o token do bot no CrowForge.'};
 if (botProcess) {
 return { success: false, error: 'Bot já está em execução.' };
 }

 const targetPath = projectPath || PROJECT_PATH;
 const entryPoint = path.join(targetPath, 'apps', 'bot', 'index.js');

 if (!fs.existsSync(entryPoint)) {
 return { success: false, error: 'Arquivo index.js do bot não encontrado.' };
 }

 return new Promise((resolve) => {
 const child = spawn(nodeExe,[entryPoint],{cwd:DATA_ROOT,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
 botProcess=child;
 let ready=false;
 const finish=result=>{if(!ready){ready=true;clearTimeout(timer);resolve(result);}};
 const timer=setTimeout(()=>{finish({success:false,error:'O Discord ainda não confirmou conexão. Pare o processo antes de tentar de novo.'});},30000);
 child.on('message',message=>{
   if(message?.type==='manage-bot') onManageBot?.();
   if(message?.type==='gateway') {
     child.gatewayReady=message.ready;
     if(message.ready) finish({success:true,pid:child.pid,message:'Conectado ao Discord.'});
   }
 });
 child.once('error',()=>{if(botProcess===child) botProcess=null;finish({success:false,error:'Falha ao iniciar o runtime.'});});
 child.once('exit',code=>{if(botProcess===child) botProcess=null;finish({success:false,error:'Processo encerrado antes da conexão ('+code+').'});});
 });
}

async function stopBot() {
 const child=botProcess;
 if (!child) return {success:true};
 return new Promise(resolve=>{
   const timer=setTimeout(()=>child.kill(),5000);
   child.once('exit',()=>{clearTimeout(timer);resolve({success:true});});
   if(child.connected) child.send({type:'stop'},()=>{});
   else child.kill();
 });
}

function getBotStatus() {
 return {
 running: botProcess?.gatewayReady === true, active: !!botProcess,
 pid: botProcess ? botProcess.pid : null
 };
}

function getProjectPath() {
 return PROJECT_PATH;
}

async function repairInstallation(projectPath) {
 if(botProcess) return {success:false,results:[{step:'Reparo',error:'Pare o bot antes de reparar.'}]};
 const targetPath = projectPath || PROJECT_PATH;
 const results = [];

 // 1. Verificar node_modules
 const nmPath = path.join(targetPath, 'node_modules');
 if (!fs.existsSync(nmPath)) {
 results.push({ step: 'Dependências', status: 'missing' });
 const installResult = await installDependencies(targetPath);
 results.push({ step: 'Instalar dependências', ...installResult });
 } else {
 results.push({ step: 'Dependências', status: 'ok' });
 }

 // 2. Verificar .env
 const envPath = path.join(DATA_ROOT, '.env');
 if (!fs.existsSync(envPath)) {
 results.push({ step: '.env', status: 'missing', error: 'Execute o instalador novamente para configurar.' });
 } else {
 results.push({ step: '.env', status: 'ok' });
 }

 // 3. Verificar data directory
 const dataPath = path.join(DATA_ROOT, 'data');
 if (!fs.existsSync(dataPath)) {
 fs.mkdirSync(dataPath, { recursive: true });
 results.push({ step: 'Diretório data/', status: 'created' });
 } else {
 results.push({ step: 'Diretório data/', status: 'ok' });
 }

 // 4. Re-registrar comandos
 const deployResult = await deployCommands(targetPath);
 results.push({ step: 'Registrar comandos', ...deployResult });

 return { success: results.every(r => r.status === 'ok' || r.success), results };
}

function saveInstallationState(data) {
 const state = {
 installed: true,
 botUser: data.botUser || null,
 clientId: data.clientId || null,
 guildId: data.guildId || null,
 modules: data.modules || [],
 installedAt: new Date().toISOString()
 };
 return saveState(state);
}

module.exports = {
 checkSavedMembership, changeBotProfile, onManageBot:callback=>{onManageBot=callback;},
 getDataRoot: () => DATA_ROOT,
 checkEnvironment,
 validateCredentials,
 checkIntents,
 generateInviteLink,
 verifyBotInGuild,
 writeEnvFile,
 installDependencies,
 deployCommands,
 startBot,
 stopBot,
 getBotStatus,
 getProjectPath,
 repairInstallation,
 getInstallationState,
 saveInstallationState
};