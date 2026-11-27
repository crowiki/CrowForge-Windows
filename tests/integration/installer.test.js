const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
test('Instalação preserva credenciais e ativa somente intents confirmadas',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crowforge config '));
 process.env.CROWFORGE_DATA_DIR=dir;
 const installer=require('../../installer/lib/installer');
 const config={clientId:'123456789012345678',guildId:'223456789012345678',token:'teste-local',modules:['welcome','levels']};
 try{
 assert.equal((await installer.writeEnvFile(config)).success,false);
 assert.equal((await installer.writeEnvFile({...config,confirmedIntents:true})).success,true);
 const file=path.join(dir,'.env');
 const before=await fs.readFile(file,'utf8');
 assert.ok(before.includes('ENABLE_MESSAGE_CONTENT=true') && before.includes('ENABLE_GUILD_MEMBERS=true'));
 assert.equal((await installer.writeEnvFile({...config,confirmedIntents:true})).success,true);
 assert.equal(await fs.readFile(file,'utf8'),before);
 const extras = '# opção local\r\nEXTRA="texto\nGUILD_ID=interno"\r\n';
 await fs.writeFile(file,before.replace('PANEL_PORT=3000','PANEL_PORT=3123').replace('REDIS_URL=','REDIS_URL=redis://local')+extras);
 const changed={...config,token:'outra',guildId:'323456789012345678',modules:['tickets']};
 assert.equal((await installer.writeEnvFile(changed)).success,true);
 const updated=await fs.readFile(file,'utf8');
 const parsed=require('dotenv').parse(updated);
 assert.equal(parsed.DISCORD_TOKEN,'outra');assert.equal(parsed.GUILD_ID,changed.guildId);
 assert.equal(parsed.ENABLED_MODULES,'tickets');assert.equal(parsed.ENABLE_MESSAGE_CONTENT,'false');
 assert.equal(parsed.ENABLE_GUILD_MEMBERS,'false');assert.equal(parsed.PANEL_PORT,'3123');
 assert.equal(parsed.REDIS_URL,'redis://local');assert.ok(updated.endsWith(extras));
 assert.equal((await installer.writeEnvFile(changed)).success,true);
 assert.equal(await fs.readFile(file,'utf8'),updated);
 await fs.unlink(file);
 assert.equal((await installer.writeEnvFile({...config,modules:[]})).success,true);
 const zero=require('dotenv').parse(await fs.readFile(file));
 assert.equal(zero.ENABLED_MODULES,'');assert.equal(zero.ENABLE_GUILD_MEMBERS,'false');
 }finally{delete process.env.CROWFORGE_DATA_DIR;await fs.rm(dir,{recursive:true,force:true});}
});
test('Supervisor acompanha confirmação, desconexão, reconexão e parada',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'crowforge supervisor '));
 process.env.CROWFORGE_RUNTIME=root;process.env.CROWFORGE_DATA_DIR=root;
 const key=require.resolve('../../installer/lib/installer');delete require.cache[key];
 const installer=require(key);
 try{
 await fs.writeFile(path.join(root,'.env'),'DISCORD_TOKEN=teste-local');
 await fs.copyFile(process.execPath,path.join(root,'node.exe'));
 const dir=path.join(root,'apps/bot');await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,'index.js'),"process.send({type:'gateway',ready:true});setTimeout(()=>process.send({type:'gateway',ready:false}),250);setTimeout(()=>process.send({type:'gateway',ready:true}),650);process.on('message',()=>process.exit());");
 assert.equal(installer.getBotStatus().running,false);
 assert.equal((await installer.startBot()).success,true);
 assert.equal(installer.getBotStatus().running,true);
 async function waitFor(expected) {
  for(let i=0;i<90;i++){if(installer.getBotStatus().running===expected)return;await new Promise(r=>setTimeout(r,25));}
  assert.fail('Estado esperado ausente');
 }
 await waitFor(false);await waitFor(true);await installer.stopBot();
 assert.equal(installer.getBotStatus().active,false);
 }finally{await installer.stopBot();delete process.env.CROWFORGE_RUNTIME;delete process.env.CROWFORGE_DATA_DIR;await fs.rm(root,{recursive:true,force:true});}
});

test('Perfil salvo: expulsão, falha temporária, logout, troca e remoção local',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crowforge-perfil-'));
 process.env.CROWFORGE_DATA_DIR=dir;
 const key=require.resolve('../../installer/lib/installer');delete require.cache[key];
 const i=require(key);
 const config={clientId:'123456789012345678',guildId:'223456789012345678',token:'token-local',modules:[]};
 const env=async()=>require('dotenv').parse(await fs.readFile(path.join(dir,'.env')));
 try {
   assert.ok((await i.writeEnvFile(config)).success);
   i.saveInstallationState(config);
   assert.equal(i.getInstallationState().installed,true);
   assert.equal(i.getInstallationState().guildId,config.guildId);
   for(const [code,status] of [[200,'member'],[404,'missing'],[403,'missing'],[401,'invalid'],[503,'unknown']]){
     assert.equal((await i.checkSavedMembership(async()=>({status:code,data:{id:config.guildId,name:'Teste'}}))).status,status);
     assert.equal((await env()).DISCORD_TOKEN,config.token);
   }
   await fs.writeFile(path.join(dir,'data','crowbot.db'),'histórico de teste');
   assert.ok((await i.changeBotProfile('logout')).success);
   assert.equal((await env()).DISCORD_TOKEN,'');
   assert.equal(i.getInstallationState().signedOut,true);
   assert.equal((await i.startBot()).success,false);
   await i.writeEnvFile(config);
   assert.equal((await env()).DATABASE_PATH,'./data/crowbot.db');
   const other={...config,clientId:'323456789012345678'};
   await i.writeEnvFile(other);i.saveInstallationState(other);
   assert.notEqual((await env()).DATABASE_PATH,'./data/crowbot.db');
   assert.ok((await i.changeBotProfile('remove')).success);
   assert.equal(i.getInstallationState().installed,false);
   await assert.rejects(fs.access(path.join(dir,'.env')));
   await i.writeEnvFile(config);
   assert.notEqual((await env()).DATABASE_PATH,'./data/crowbot.db');
   assert.equal(await fs.readFile(path.join(dir,'data','crowbot.db'),'utf8'),'histórico de teste');
 } finally {delete process.env.CROWFORGE_DATA_DIR;delete require.cache[key];await fs.rm(dir,{recursive:true,force:true});}
});
