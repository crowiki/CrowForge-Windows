const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
if (app.isPackaged) {
  process.env.CROWFORGE_RUNTIME = path.join(process.resourcesPath,'runtime');
  process.env.CROWFORGE_DATA_DIR = process.env.CROWFORGE_DATA_DIR || path.join(app.getPath('appData'),'CrowForge');
}
const installer = require('./lib/installer');

let mainWindow;
let tray = null;
let isQuitting = false;

// === Sistema de Tray Icon ===
function createTrayIcon() {
  // Usar ícone ICO para Windows (melhor qualidade na bandeja)
  const iconPath = path.join(__dirname, 'icon.ico');
  const trayIcon = nativeImage.createFromPath(iconPath);

  tray = new Tray(trayIcon);
  tray.setToolTip('CrowForge - Bot Discord');

  // Menu contextual do tray
  updateTrayMenu();

  // Clique esquerdo abre a janela
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

async function startConfiguredBot() {
 const membership=await installer.checkSavedMembership();
 if (['signedOut','missing','invalid'].includes(membership.status)) {
   mainWindow?.show();mainWindow?.focus();mainWindow?.webContents.send('manage-bot');
   return {success:false,error:'Revise o vínculo do bot na tela Gerenciar bot.'};
 }
 return installer.startBot();
}

function updateTrayMenu() {
  if (!tray) return;

  const botStatus = installer.getBotStatus();
  const botRunning = botStatus.running || botStatus.active;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir CrowForge',
      click: () => {
        if (mainWindow && !mainWindow.isVisible()) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Abrir Painel',
      click: async () => {
        await shell.openExternal('http://127.0.0.1:3000');
      }
    },
    { type: 'separator' },
    {
      label: 'Status do Bot',
      enabled: false,
      sublabel: botRunning ? '🟢 Online' : '⚫ Offline'
    },
    {
      label: botRunning ? 'Parar Bot' : 'Iniciar Bot',
      click: async () => {
        if (botRunning) {
          await installer.stopBot();
        } else {
          await startConfiguredBot();
        }
        // Atualizar menu após mudança de estado
        setTimeout(() => updateTrayMenu(), 500);
      }
    },
    { type: 'separator' },
    {
      label: 'Guia do comprador',
      click: () => shell.openPath(app.isPackaged ? path.join(process.resourcesPath,'documentacao','Guia do comprador.txt') : path.resolve(__dirname,'../docs/MANUAL.md'))
    },
    {
      label: 'Licença de uso',
      click: () => shell.openPath(app.isPackaged ? path.join(process.resourcesPath,'documentacao','Licenca.txt') : path.resolve(__dirname,'../LICENCA.md'))
    },
    { type: 'separator' },
    {
      label: 'Sair do CrowForge',
      click: () => {
        isQuitting = true;
        installer.stopBot().finally(() => {
          app.quit();
        });
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname,'icon.ico'),
    width: 840,
    height: 700,
    minWidth: 700,
    minHeight: 600,
    resizable: true,
    title: 'CrowForge',
    show: false, // Não mostrar imediatamente

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    autoHideMenuBar: true,
    backgroundColor: '#0f172a'
  });

  // Mostrar janela apenas quando estiver pronta (evita flash branco)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Esconder janela ao invés de fechar (mantém ícone na bandeja)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',event=>event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// === Instância Única ===
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Já existe uma instância rodando, sair
  app.quit();
} else {
  // Quando uma segunda instância tentar abrir, focar na janela existente
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    createTrayIcon();
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // Não sair quando todas as janelas fecharem (mantém tray ativo)
  // Apenas sair se for macOS (padrão Electron)
  if (process.platform !== 'darwin') {
    // No Windows, manter rodando na bandeja
  }
});

installer.onManageBot(()=>{
 if (!mainWindow) return;
 if(mainWindow.isMinimized()) mainWindow.restore();
 mainWindow.show();mainWindow.focus();
 mainWindow.webContents.send('manage-bot');
});
ipcMain.handle('saved-membership',()=>installer.checkSavedMembership());
ipcMain.handle('change-bot-profile',async(_,action)=>{
 if(!['logout','remove','switch'].includes(action)) return {success:false};
 const removing=action==='remove';
 const answer=await dialog.showMessageBox(mainWindow,{
   type:'question',buttons:['Cancelar',removing?'Remover deste computador':action==='switch'?'Trocar bot':'Deslogar'],
   defaultId:0,cancelId:0,title:'CrowForge',
   message:removing?'Remover o bot salvo deste computador?': 'Encerrar a sessão do bot atual?',
   detail:removing?'O bot será parado e sua configuração local, incluindo o token e as chaves de integração, será apagada. O histórico permanece em disco. A próxima instalação começa com um banco novo.':'O bot será parado e o token salvo será apagado. O histórico e as configurações ficam disponíveis para entrar novamente.'
 });
 if(answer.response!==1) return {success:false,cancelled:true};
 const result=await installer.changeBotProfile(removing?'remove':'logout');updateTrayMenu();return result;
});

ipcMain.on('catalog', event => {event.returnValue=require('./lib/catalog.json');});

ipcMain.handle('check-environment', async () => {
  return installer.checkEnvironment();
});

ipcMain.handle('validate-credentials', async (_, clientId, token) => {
  return installer.validateCredentials(clientId, token);
});

ipcMain.handle('generate-invite-link', async (_, clientId, modules) => {
  return installer.generateInviteLink(clientId, modules);
});

ipcMain.handle('open-in-browser', async (_, url) => {
  const link = new URL(url);
  if (link.origin !== 'https://discord.com' || !['/oauth2/authorize','/developers/applications'].includes(link.pathname)) return {success:false};
  await shell.openExternal(link.href);
  return { success: true };
});

ipcMain.handle('verify-bot-in-guild', async (_, config) => {
  return installer.verifyBotInGuild(config);
});

ipcMain.handle('write-env-file', async (_, config) => {
  return installer.writeEnvFile(config);
});

ipcMain.handle('install-dependencies', async (_, projectPath) => {
  return installer.installDependencies();
});

ipcMain.handle('deploy-commands', async (_, projectPath) => {
  return installer.deployCommands();
});

ipcMain.handle('start-bot', async (_, projectPath) => {
  const result = await startConfiguredBot();
  // Atualizar menu do tray após mudança de estado
  updateTrayMenu();
  return result;
});

ipcMain.handle('stop-bot', async () => {
  const result = await installer.stopBot();
  // Atualizar menu do tray após mudança de estado
  updateTrayMenu();
  return result;
});

ipcMain.handle('get-bot-status', async () => {
  return installer.getBotStatus();
});

ipcMain.handle('open-panel', async () => {
  await shell.openExternal('http://127.0.0.1:3000');
  return { success: true };
});

ipcMain.handle('check-intents', async (_, token) => {
  return installer.checkIntents(token);
});

ipcMain.handle('get-project-path', async () => {
  return installer.getProjectPath();
});

ipcMain.handle('repair-installation', async (_, projectPath) => {
  return installer.repairInstallation();
});

ipcMain.handle('get-installation-state', async () => {
  return installer.getInstallationState();
});

ipcMain.handle('save-installation-state', async (_, data) => {
  return installer.saveInstallationState(data);
});
