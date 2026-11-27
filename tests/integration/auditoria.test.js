const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const db=require('../../packages/db');

test('Migração conserva formulários, opções de enquete, preço e vínculo após reabrir',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'crowforge-migracao-'));
  const file=path.join(root,'legacy.db');
  t.after(()=>{db.closeDatabase();fs.rmSync(root,{recursive:true,force:true});});
  const SQL=await require('sql.js')();
  const legacy=new SQL.Database();
  legacy.run(fs.readFileSync(path.resolve(__dirname,'../../packages/db/schema.sql'),'utf8'));
  legacy.run("INSERT INTO guilds(guild_id,name) VALUES('g','Teste')");
  legacy.run("INSERT INTO polls(guild_id,channel_id,question,options_json,anonymous,created_by) VALUES('g','c','Pergunta','[1,2]',1,'u')");
  legacy.run("INSERT INTO forms(guild_id,form_name,form_type,fields_json,created_by) VALUES('g','Cadastro','custom','[1]','u')");
  legacy.run("INSERT INTO store_products(guild_id,name,price_cents) VALUES('g','Produto',1245)");
  fs.writeFileSync(file,legacy.export());legacy.close();
  for(let i=0;i<2;i++){
    await db.initDatabase(file);
    assert.deepEqual(db.queryGet('SELECT creator_id,options,mode FROM polls'),{creator_id:'u',options:'[1,2]',mode:'anonymous'});
    assert.deepEqual(db.queryGet('SELECT title,fields FROM forms'),{title:'Cadastro',fields:'[1]'});
    assert.equal(db.queryGet('SELECT price FROM store_products').price,12.45);
    assert.equal(db.queryGet('PRAGMA foreign_keys').foreign_keys,1);
    db.closeDatabase();
  }
});

test('Alertas consultam o canal correto e formatam o evento dos dois provedores',async t=>{
  const provider=require('../../modules/alerts/provider');
  const keys=['TWITCH_CLIENT_ID','TWITCH_CLIENT_SECRET','YOUTUBE_API_KEY'];
  const previous=keys.map(k=>process.env[k]);
  t.after(()=>keys.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];}));
  keys.forEach(k=>process.env[k]='teste');
  const requests=[];
  const replies=[{access_token:'teste',expires_in:3600},{data:[{id:'1',user_login:'canal',user_name:'Canal',title:'Ao vivo',game_name:'Jogo'}]},
    {items:[{contentDetails:{relatedPlaylists:{uploads:'playlist'}}}]},{items:[{snippet:{title:'Vídeo',channelTitle:'Canal',resourceId:{videoId:'2'}}}]}];
  t.mock.method(global,'fetch',async url=>{requests.push(url);return {ok:true,json:async()=>replies.shift()};});
  assert.equal((await provider.latest('twitch','canal')).id,'1');
  assert.equal((await provider.latest('youtube','canal')).url,'https://www.youtube.com/watch?v=2');
  assert.ok(requests[1].endsWith('user_login=canal'));
  assert.ok(requests[3].endsWith('playlistId=playlist'));
});

test('Webhook local publica o modelo configurado sem disparar menções',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'crowforge-alerta-'));
  const {buildServer}=require('../../apps/local-api');
  const oldGuild=process.env.GUILD_ID;
  process.env.GUILD_ID='guild';
  let api;
  t.after(async()=>{if(api)await api.close();db.closeDatabase();fs.rmSync(root,{recursive:true,force:true});if(oldGuild===undefined)delete process.env.GUILD_ID;else process.env.GUILD_ID=oldGuild;});
  await db.initDatabase(path.join(root,'alert.db'));
  require('../../modules/state').seed('guild','Teste',['alerts']);
  await require('../../modules/alerts').init({});
  db.runSql("INSERT INTO alert_configs(guild_id,creator_id,type,source,channel_id,message_template) VALUES('guild','u','webhook','teste','c','{nome}: {mensagem}')");
  let sent;
  const channel={isSendable:()=>true,send:async message=>{sent=message;}};
  api=await buildServer({client:{isReady:()=>true,guilds:{cache:new Map([['guild',{channels:{fetch:async()=>channel}}]])}}});
  const response=await api.inject({method:'POST',url:'/api/alerts/webhook/guild/teste',payload:{message:'@everyone'}});
  assert.equal(response.statusCode,200);
  assert.deepEqual(sent,{content:'teste: @everyone',allowedMentions:{parse:[]}});
});
