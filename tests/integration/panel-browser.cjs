const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const db = require('../../packages/db');
const {buildServer} = require('../../apps/local-api');
const previews=process.env.CROWFORGE_PREVIEWS;
async function capture(win,name) {
 if (!previews) return;
 await fs.mkdir(previews,{recursive:true});
 await win.webContents.insertCSS('*{animation:none!important;transition:none!important}');
 win.webContents.invalidate();
 await new Promise(resolve=>setTimeout(resolve,500));
 const image=await win.webContents.capturePage();
 assert.ok(!image.isEmpty());
 await fs.writeFile(path.join(previews,name+'.png'),image.toPNG());
}
async function run() {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'crowforge-ui-'));
 await db.initDatabase(path.join(root,'teste.db'));
 process.env.CROWFORGE_DATA_DIR=root;
 process.env.GUILD_ID='100000000000000000';
 const state=require('../../modules/state');
 state.seed(process.env.GUILD_ID,'Laboratório CrowForge',[]);
 let online=false,release,managerOpened=false;
 const gate=new Promise(resolve=>{release=resolve;});
 const api=await buildServer({openBotManager:()=>{managerOpened=true;},gateway:()=>({status:online?'running':'connecting',uptime:0}),gatewayIntents:{members:true,content:true},synchronize:()=>gate});
 let win;
 try {
   const url=await api.listen({port:0,host:'127.0.0.1'});
   win=new BrowserWindow({width:1120,height:820,show:false,webPreferences:{backgroundThrottling:false,offscreen:true,partition:'painel-teste',sandbox:true}});
   const js=code=>win.webContents.executeJavaScript(code);
   async function until(condition) {
     for(let i=0;i<180;i++) {if(await js(condition)) return;await new Promise(r=>setTimeout(r,50));}
     assert.fail('Tela esperada ausente: '+condition);
   }
   for (let i=0;i<2;i++) {
     await win.loadURL(url);
     await until("document.body.textContent.includes('Tickets Abertos')");
     assert.equal(await js("!!document.querySelector('input[type=password]')"),false);
   }
   assert.equal(await js("document.querySelectorAll('[role=switch]:disabled').length"),6);
   await js("document.querySelector('.manage-bot').click()");
   await until("document.body.textContent.includes('Gerenciamento aberto')");
   assert.ok(managerOpened);
   online=true;
   await until("!!document.querySelector('[role=switch]:enabled')");
   await js("document.querySelectorAll('[role=switch]')[0].click()");
   await until("document.querySelectorAll('[role=switch]:disabled').length===1");
   await js("document.querySelectorAll('[role=switch]')[1].click()");
   await until("document.querySelectorAll('[role=switch]:disabled').length===2");
   release();
   await until("document.querySelectorAll('[role=switch][aria-checked=true]').length===2");
   assert.equal(state.active(process.env.GUILD_ID).length,2);
   await js(`document.querySelector('[aria-label="Próxima página"]').click()`);
   await until("!!document.querySelector('nav').textContent.includes('Página 2')");
   await js(`document.querySelector('[aria-label="Página anterior"]').click()`);
   await until("!!document.querySelector('nav').textContent.includes('Página 1')");
   assert.ok(await js("document.documentElement.scrollHeight <= innerHeight"));
   await capture(win,'painel');
   win.setContentSize(390,780);
   await until("innerWidth<=390");
   assert.ok(await js("document.documentElement.scrollWidth <= innerWidth"));
   await js("document.querySelector('input[type=search]').focus()");
   win.webContents.insertText('ticket');
   await until("document.querySelectorAll('[role=switch]').length===1");
   assert.equal(await js("document.querySelector('[role=switch]').getAttribute('aria-label')"),'Tickets');
   win.destroy();
   const {ipcMain}=require('electron');
   const installer=require('../../installer/lib/installer');
   ipcMain.on('catalog',event=>{event.returnValue=require('../../installer/lib/catalog.json')});
   ipcMain.handle('get-installation-state',()=>installer.getInstallationState());
   ipcMain.handle('saved-membership',()=>installer.checkSavedMembership(async()=>({status:404})));
   ipcMain.handle('change-bot-profile',(_,action)=>installer.changeBotProfile(action==='switch'?'logout':action));
   ipcMain.handle('check-environment',installer.checkEnvironment);
   win=new BrowserWindow({width:860,height:700,show:false,webPreferences:{backgroundThrottling:false,offscreen:true,preload:path.resolve(__dirname,'../../installer/preload.js'),sandbox:true}});
   await win.loadFile(path.resolve(__dirname,'../../installer/renderer/index.html'));
   await until("document.querySelectorAll('#envStatus .status-item').length>1");
   assert.equal(await js("Object.keys(window.crowbot.catalog).length"),Object.keys(require('../../installer/lib/catalog.json')).length);
   await capture(win,'instalador');
   const cfg={clientId:'123456789012345678',guildId:'223456789012345678',token:'teste',modules:[]};
   await installer.writeEnvFile(cfg);installer.saveInstallationState({...cfg,botUser:{username:'Laboratório'}});
   const reopen=()=>win.loadFile(path.resolve(__dirname,'../../installer/renderer/index.html'));
   await reopen();
   await until("document.getElementById('membership').textContent.includes('perdeu acesso')");
   assert.ok(await js("document.getElementById('startSaved').disabled"));
   assert.ok(await js("!document.getElementById('reinvite').classList.contains('hidden')"));
   await js("document.getElementById('logoutBot').click()");
   await until("document.getElementById('membership').textContent.includes('Sessão encerrada')");
   await js("document.getElementById('addBot').click()");
   await until("!document.getElementById('step2').classList.contains('hidden')");
   await reopen();
   await until("document.getElementById('membership').textContent.includes('Sessão encerrada')");
   await js("document.querySelector('#step5 button[onclick*=remove]').click()");
   await until("!document.getElementById('step1').classList.contains('hidden')");
   assert.equal(installer.getInstallationState().installed,false);
   console.log('Painel direto e recarga em Chromium aprovados.');
 } finally {win?.destroy();api.server.closeAllConnections();await api.close();db.closeDatabase();await fs.rm(root,{recursive:true,force:true});}
}
app.on('window-all-closed',()=>{});
app.whenReady().then(run).then(()=>app.exit(0),e=>{console.error(e);app.exit(1)});

