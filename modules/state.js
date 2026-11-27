const db = require('../packages/db');
const {modules} = require('./index');
const names = modules.map(m=>m.name);
const queues = new Map();
async function inGuildQueue(id,action) {
  const previous=queues.get(id) || Promise.resolve();
  const task=previous.catch(()=>{}).then(action);
  queues.set(id,task);
  try {return await task;}
  finally {if(queues.get(id)===task) queues.delete(id);}
}

function selected(env=process.env) {
  const list = env.ENABLED_MODULES?.trim();
  if (!list && env.MODULE_SELECTION_VERSION !== '1') return [...names];
  const wanted = new Set((list || '').split(',').map(s=>s.trim()));
  return names.filter(n=>wanted.has(n));
}
function seed(id,name,defaults) {
  db.runSql('INSERT OR IGNORE INTO guilds(guild_id,name) VALUES (?,?)',[id,name]);
  for(const mod of names) {
    // Verificar se o módulo já existe para esta guild; se não, inserir como habilitado/desabilitado conforme defaults
    const existing = db.queryGet('SELECT enabled FROM modules WHERE guild_id=? AND module_name=?',[id,mod]);
    if (!existing) {
      db.runSql('INSERT INTO modules(guild_id,module_name,enabled) VALUES (?,?,?)',[id,mod,Number(defaults.includes(mod))]);
    }
  }
}
function active(id) {
  return db.queryAll('SELECT module_name FROM modules WHERE guild_id=? AND enabled=1 ORDER BY module_name',[id]).map(m=>m.module_name).filter(name=>names.includes(name));
}
function isEnabled(id,name) {
  if (!names.includes(name) || !id || (process.env.GUILD_ID && process.env.GUILD_ID !== id)) return false;
  return Boolean(db.queryGet('SELECT enabled FROM modules WHERE guild_id=? AND module_name=?',[id,name])?.enabled);
}
function commands(enabled,guildId) {
  const base=modules.filter(m=>enabled.includes(m.name)).flatMap(m=>m.getCommands().map(c=>c.toJSON()));
  if (!guildId || !enabled.includes('custom-commands')) return base;
  if (!db.queryGet("SELECT 1 FROM sqlite_master WHERE type='table' AND name='custom_commands'")) return base;
  const reserved=new Set(modules.flatMap(m=>m.getCommands().map(c=>c.name)));
  for(const {name} of db.queryAll('SELECT name FROM custom_commands WHERE guild_id=? ORDER BY name',[guildId])) {
    if (/^[a-z0-9_-]{1,32}$/.test(name) && !reserved.has(name)) base.push({name,description:'Comando personalizado do servidor'});
  }
  return base;
}
async function setEnabled(id,name,enabled,synchronize) {
  if (!names.includes(name) || !db.queryGet('SELECT 1 FROM modules WHERE guild_id=? AND module_name=?',[id,name])) throw Error('Servidor ou módulo desconhecido.');
  return inGuildQueue(id,async()=>{
    const next=new Set(active(id));
    if(next.has(name)===enabled) return;
    if(enabled) next.add(name); else next.delete(name);
    await synchronize(id,[...next]);
    db.runSql('UPDATE modules SET enabled=? WHERE guild_id=? AND module_name=?',[Number(enabled),id,name]);
  });
}
module.exports={inGuildQueue,isEnabled,names,selected,seed,active,commands,setEnabled};
