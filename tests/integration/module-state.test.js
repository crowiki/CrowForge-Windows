const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const db=require('../../packages/db');
const state=require('../../modules/state');
test('Seleção de módulos, zero, isolamento, reinício e falha de sincronização',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crowforge-modulos-'));
 const file=path.join(dir,'teste.db');
 try {
 await db.initDatabase(file);
 assert.deepEqual(state.selected({}).sort(),Object.keys(require('../../installer/lib/catalog.json')).sort());
 assert.equal(state.selected({MODULE_SELECTION_VERSION:'1',ENABLED_MODULES:''}).length,0);
 state.seed('A','Servidor A',['tickets']);state.seed('B','Servidor B',[]);
 assert.deepEqual(state.active('A'),['tickets']);assert.deepEqual(state.active('B'),[]);
 for(const name of state.names) {
  await state.setEnabled('B',name,true,async(g,list)=>{assert.equal(g,'B');assert.ok(list.includes(name));});
  assert.ok(state.active('B').includes(name));
  await state.setEnabled('B',name,false,async()=>{});
  assert.ok(!state.active('B').includes(name));
 }
 await assert.rejects(state.setEnabled('A','tickets',false,async()=>{throw Error('offline');}));
 assert.deepEqual(state.active('A'),['tickets']);
 db.closeDatabase();await db.initDatabase(file);
 state.seed('A','Servidor A',[]);assert.deepEqual(state.active('A'),['tickets']);
 assert.equal(state.commands([]).length,0);
 assert.deepEqual(state.commands(['giveaways']).map(c=>c.name),['sorteio']);
 }finally{db.closeDatabase();await fs.rm(dir,{recursive:true,force:true});}
});

test('Painel sincroniza o servidor selecionado e reflete o Gateway',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crowforge-api-'));
 const {buildServer}=require('../../apps/local-api');
 const prev=process.env.GUILD_ID;
 process.env.GUILD_ID='A';
 let api;
 try {
 await db.initDatabase(path.join(dir,'db'));
 state.seed('A','A',[]);state.seed('B','B',[]);
 let ready=false;
 const calls=[];
 let simulatedFailure;
 api=await buildServer({gateway:()=>({status:ready?'running':'offline'}),synchronize:async(id,list)=>{if(!ready)throw Error();if(simulatedFailure)throw simulatedFailure;calls.push([id,list]);}});
 // Registros históricos podem continuar no banco após a remoção de módulos.
 state.seed('A','A',state.names);
 for(let i=0;i<6;i++)db.runSql('INSERT INTO modules(guild_id,module_name,enabled) VALUES(?,?,1)',['A','removido-'+i]);
 for(const url of ['/api/status','/api/modules','/api/modules?guildId=A']){
   const body=(await api.inject({url})).json();
   const rows=(body.modules || body).filter(m=>m.guild_id==='A');
   assert.deepEqual(rows.map(m=>m.module_name).sort(),[...state.names].sort());
 }
 assert.deepEqual(state.active('A'),[]);
 const toggle=id=>api.inject({method:'PUT',url:'/api/modules/'+id+'/tickets/toggle',payload:{enabled:true}});
 assert.equal((await api.inject({url:'/api/status'})).json().bot.status,'offline');
 assert.equal((await toggle('A')).statusCode,409);
 ready=true;
 assert.equal((await toggle('B')).statusCode,403);
 assert.equal((await toggle('A')).statusCode,200);
 const change=(name,enabled)=>api.inject({method:'PUT',url:'/api/modules/A/'+name+'/toggle',payload:{enabled}});
 assert.match((await change('welcome',true)).json().error,/Server Members Intent/);
 simulatedFailure=Object.assign(Error('rate limit'),{retryAfter:7000});
 assert.equal((await change('tickets',false)).statusCode,429);
 assert.deepEqual(state.active('A'),['tickets']);
 simulatedFailure=null;
 assert.deepEqual(calls,[['A',['tickets']]]);
 assert.equal((await api.inject({url:'/api/status'})).json().bot.status,'running');
 }finally{if(api)await api.close();db.closeDatabase();if(prev===undefined)delete process.env.GUILD_ID;else process.env.GUILD_ID=prev;await fs.rm(dir,{recursive:true,force:true});}
});
