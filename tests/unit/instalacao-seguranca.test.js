const { test } = require('node:test');
const assert = require('node:assert/strict');
const {verifyBotInGuild} = require('../../installer/lib/installer');
const { authorizeTarget } = require('../../modules/moderation/permissions');
const { PermissionFlagsBits: P } = require('discord.js');

const guildId = '123456789012345678';
for (const status of [200,401,403,404,429,500]) {
 test('Verificação do servidor HTTP ' + status, async () => {
   const result = await verifyBotInGuild({token:'teste',clientId:guildId,guildId,modules:[]}, async url => {
     if (url.includes('/members/')) return {status, data:{roles:[]}};
     return {status,data:{id:guildId,name:'Teste',roles:[{id:guildId,permissions:'8'}]}};
   });
   assert.equal(result.found,status === 200);
   if (!result.found) assert.ok(result.error);
 });
}
test('Servidor localizado e membro ausente têm diagnóstico específico', async () => {
 const result=await verifyBotInGuild({token:'teste',clientId:'123456789012345679',guildId,modules:[]},async url=>
   url.includes('/members/') ? {status:404} : {status:200,data:{id:guildId,name:'Teste'}});
 assert.match(result.error,/Servidor localizado.*membro/);
});
test('Um ID longo demais é recusado antes da consulta',async()=>{
 let calls=0;
 const result=await verifyBotInGuild({token:'teste',clientId:guildId,guildId:'123456789012345678901',modules:[]},()=>{calls++;});
 assert.equal(calls,0);
 assert.match(result.error,/17 a 20/);
});
for (const [action,flag,cap] of [['kick',P.KickMembers,'kickable'],['ban',P.BanMembers,'bannable'],['timeout',P.ModerateMembers,'moderatable']]) {
 for (const [scenario,allowed] of [['autorizado',true],['dono operador',true],['permissão limitada',false],['cargo igual',false],['dono alvo',false],['autoalvo',false],['bot alvo',false],['bot limitado',false],['ausente',false]]) {
 test(action+' / '+scenario,()=>{
   const actor = {user:{id:'operador'},guild:{ownerId:scenario==='dono operador'?'operador':'dono'},
     memberPermissions:{has:f=>f===flag && scenario!=='permissão limitada'},
     member:{roles:{highest:{comparePositionTo:()=>['cargo igual','dono operador'].includes(scenario)?0:1}}}};
   const target={id:scenario==='dono alvo'?'dono':scenario==='autoalvo'?'operador':'alvo',user:{bot:scenario==='bot alvo'},roles:{highest:{}},[cap]:scenario!=='bot limitado'};
   assert.equal(authorizeTarget(actor, scenario==='ausente'?null:target,action)===null,allowed);
 });
 }
}

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const page = fs.readFileSync(path.join(__dirname, '../../installer/renderer/index.html'), 'utf8');
const script = page.split('<script>')[1].split('</script>')[0];
for (const scenario of ['ok', 'negado', 'desconectado']) {
 test('Botão Já convidei / ' + scenario, async () => {
   const steps = [];
   const alerts = [];
   const elements = { guildId: {value:guildId}, btnToStep4:{} };
   const sandbox = vm.createContext({
     document:{getElementById:id=>elements[id]},
     alert:text=>alerts.push(text), steps, setInterval:()=>{},
     window:{crowbot:{verifyBotInGuild:async args=>{
       assert.equal(args.guildId,guildId);
       assert.equal(args.token,'teste');
       if (scenario==='desconectado') throw Error();
       return {found:scenario==='ok',error:'Acesso negado'};
     }}}
   });
   vm.runInContext(script.slice(0,script.lastIndexOf(' updateStepIndicator();')),sandbox);
   await vm.runInContext("currentStep=3; validatedCredentials={clientId:'123',token:'teste'}; goToStep=n=>steps.push(n); verifyAndGoToStep4()", sandbox);
   assert.deepEqual(steps,scenario==='ok'?[4]:[]);
   assert.equal(alerts.length,scenario==='ok'?0:1);
   assert.equal(elements.btnToStep4.disabled,false);
 });
}

test('Instalação permite repetir após falha da ponte e chega à etapa final',async()=>{
 const elements={};
 const document={getElementById:id=>elements[id]??={classList:{add(){},remove(){}},textContent:''}};
 const calls=[];
 let fail=true;
 const crowbot={};
 for(const method of ['writeEnvFile','installDependencies','deployCommands','saveInstallationState']){
   crowbot[method]=async()=>{calls.push(method);if(fail)throw Error();return {success:true};};
 }
 const ctx=vm.createContext({document,window:{crowbot},setInterval:()=>{}});
 vm.runInContext(script.slice(0,script.lastIndexOf(' updateStepIndicator();')),ctx);
 vm.runInContext("validatedCredentials={}; htmlText=s=>s",ctx);
 await vm.runInContext("runInstallation()",ctx);
 assert.deepEqual(calls,['writeEnvFile']);
 assert.equal(elements.btnInstall.disabled,false);
 assert.match(elements.installLog.textContent,/Tente novamente/);
 fail=false;calls.length=0;
 await vm.runInContext("runInstallation()",ctx);
 assert.deepEqual(calls,['writeEnvFile','installDependencies','deployCommands','saveInstallationState']);
 assert.match(elements.installStatus.innerHTML,/Instalação concluída/);
});

test('Intents reconhecidas para bots grandes e pequenos',async()=>{
 const {checkIntents}=require('../../installer/lib/installer');
 for(const flags of [(1<<14)|(1<<18),(1<<15)|(1<<19)]){
   assert.deepEqual(await checkIntents('teste',async()=>({status:200,data:{flags}})),{available:true,members:true,content:true});
 }
 assert.deepEqual(await checkIntents('teste',async()=>({status:200,data:{flags:0}})),{available:true,members:false,content:false});
 assert.deepEqual(await checkIntents('teste',async()=>({status:429})),{available:false});
});
test('Reinstalação verifica antes de salvar e aceita correção no Portal',async()=>{
 const elements={};
 const document={getElementById:id=>elements[id]??={classList:{add(){},remove(){}},scrollIntoView(){},focus(){},checked:false}};
 const crowbot={catalog:{welcome:{label:'Boas-vindas',intents:['members']}},checkIntents:async()=>({available:true,members:false})};
 const ctx=vm.createContext({document,window:{crowbot},setInterval:()=>{}});
 vm.runInContext(script.slice(0,script.lastIndexOf(' updateStepIndicator();')),ctx);
 const check=()=>vm.runInContext("confirmRequiredIntents('teste')",ctx);
 assert.equal(await check(),false);
 assert.match(elements.intentStatus.textContent,/Server Members Intent/);
 crowbot.checkIntents=async()=>({available:true,members:true});
 assert.equal(await check(),true);
 crowbot.checkIntents=async()=>({available:false});
 assert.equal(await check(),false);
 elements.confirmedIntents.checked=true;
 assert.equal(await check(),true);
});

