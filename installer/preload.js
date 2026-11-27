const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crowbot', {
  onManageBot: callback=>ipcRenderer.on('manage-bot',()=>callback()),
  checkSavedMembership: ()=>ipcRenderer.invoke('saved-membership'),
  changeBotProfile: action=>ipcRenderer.invoke('change-bot-profile',action),
  catalog: ipcRenderer.sendSync('catalog'),
  checkEnvironment: () => ipcRenderer.invoke('check-environment'),
  validateCredentials: (clientId, token) => ipcRenderer.invoke('validate-credentials', clientId, token),
  generateInviteLink: (clientId, modules) => ipcRenderer.invoke('generate-invite-link', clientId, modules),
  openInBrowser: (url) => ipcRenderer.invoke('open-in-browser', url),
  verifyBotInGuild: config => ipcRenderer.invoke('verify-bot-in-guild', config),
  writeEnvFile: (config) => ipcRenderer.invoke('write-env-file', config),
  installDependencies: (projectPath) => ipcRenderer.invoke('install-dependencies', projectPath),
  deployCommands: (projectPath) => ipcRenderer.invoke('deploy-commands', projectPath),
  startBot: (projectPath) => ipcRenderer.invoke('start-bot', projectPath),
  stopBot: () => ipcRenderer.invoke('stop-bot'),
  getBotStatus: () => ipcRenderer.invoke('get-bot-status'),
  openPanel: () => ipcRenderer.invoke('open-panel'),
  checkIntents: (token) => ipcRenderer.invoke('check-intents', token),
  getProjectPath: () => ipcRenderer.invoke('get-project-path'),
  repairInstallation: (projectPath) => ipcRenderer.invoke('repair-installation', projectPath),
  getInstallationState: () => ipcRenderer.invoke('get-installation-state'),
  saveInstallationState: (data) => ipcRenderer.invoke('save-installation-state', data)
});