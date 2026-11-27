"use strict";
require('dotenv').config();
const { Client, GatewayIntentBits, Events, Partials, REST, Routes } = require('discord.js');
const { logger, createChild, manager, bus } = require('../../packages/core');
const { initDatabase, closeDatabase } = require('../../packages/db');

const log = createChild('bootstrap');

// Validação de ambiente
function validateEnv() {
  const required = ['DISCORD_TOKEN', 'CLIENT_ID'];
  const missing = required.filter(k => !process.env[k] || /COLE_AQUI|SEU_TOKEN|SEU_ID/i.test(process.env[k]));
  if (missing.length > 0) {
    throw new Error(`Variáveis obrigatórias não configuradas: ${missing.join(', ')}. Veja .env.example.`);
  }
}

// Bootstrap principal
async function main() {
  log.info('CrowForge iniciando...');

  // 1. Validar configuração
  validateEnv();
  log.info('Configuração validada');

  // 2. Inicializar banco de dados
  const dbPath = process.env.DATABASE_PATH || './data/crowbot.db';
  await initDatabase(dbPath);
  log.info({ path: dbPath }, 'Banco de dados pronto');

  // 3. Criar cliente Discord
  // GuildMessages é necessário para AutoMod e Levels receberem eventos de mensagem
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildVoiceStates
  ];
  // Consulte a aplicação também em instalações que começaram com zero módulos.
  const privileges = await require('../../installer/lib/gateway-intents').checkIntents(process.env.DISCORD_TOKEN,
    async (url,headers)=>{
      const response=await fetch(url,{headers,signal:AbortSignal.timeout(10000)});
      return {status:response.status,data:await response.json()};
    });
  const gatewayIntents = privileges.available ? privileges : {
    content:process.env.ENABLE_MESSAGE_CONTENT==='true',members:process.env.ENABLE_GUILD_MEMBERS==='true'
  };
  if (gatewayIntents.content) intents.push(GatewayIntentBits.MessageContent);
  if (gatewayIntents.members) intents.push(GatewayIntentBits.GuildMembers);

  const client = new Client({ intents, partials:[Partials.Channel] });

  // 4. Inicializar JobScheduler antes do contexto (necessário para módulos que agendam jobs)
  const { scheduler } = require('../../packages/jobs');

  // 5. Contexto compartilhado para módulos (inclui scheduler para giveaways e futuros módulos)
  const context = {
    client,
    db: require('../../packages/db'),
    bus,
    logger,
    scheduler,
    config: {
      clientId: process.env.CLIENT_ID,
      guildId: process.env.GUILD_ID || null,
      panelPort: parseInt(process.env.PANEL_PORT || '3000', 10)

    }
  };

  const state = require('../../modules/state');
  const {modules} = require('../../modules');
  const configured = process.env.GUILD_ID;
  const permittedGuild = id => !configured || id === configured;
  const registry=new REST({timeout:10000,retries:1,rejectOnRateLimit:limit=>limit.retryAfter>5000}).setToken(process.env.DISCORD_TOKEN);
  let initialized=false;
  async function synchronize(id, enabled) {
    const guild = client.guilds.cache.get(id);
    if (!client.isReady() || !guild || !permittedGuild(id)) throw Error('Servidor indisponível no Discord.');
    await registry.put(Routes.applicationGuildCommands(client.user.id,id),{body:state.commands(enabled,id)});
  }
  context.syncCommands = id=>state.inGuildQueue(id,()=>synchronize(id,state.active(id)));
  context.setEnabled = (id,name,value)=>state.setEnabled(id,name,value,synchronize);
  async function initializeGuild(guild) {
    if (!permittedGuild(guild.id)) return;
    state.seed(guild.id,guild.name,state.selected());
    try {await context.syncCommands(guild.id);}
    catch(err){log.error({guildId:guild.id,code:err.code},'Falha ao sincronizar comandos do servidor');}
  }
  client.on(Events.GuildCreate,guild=>initializeGuild(guild).catch(err=>log.error({err},'Falha ao configurar servidor')));
  for (const mod of modules) {
    try {
      manager.register(mod.name, mod);
    } catch (err) {
      log.error({ err, module: mod.name }, 'Falha ao registrar módulo');
    }
  }

  // 7. Inicializar todos os módulos registrados
  await manager.initAll(context);

  // 8. Handlers globais do Discord
  client.once(Events.ClientReady, async ready => {
    log.info({ tag: ready.user.tag, guilds: ready.guilds.cache.size }, 'Bot conectado ao Discord');
    bus.emit('bot:ready', { client: ready });

    for (const guild of ready.guilds.cache.values()) await initializeGuild(guild);
    // Iniciar módulos após conexão
    await manager.startAll();

    // Iniciar JobScheduler
    scheduler.start();
    initialized=true;
    process.send?.({type:'gateway',ready:true});
    bus.emit('jobs:started', { scheduler });

    // Healthcheck periódico
    setInterval(() => {
      const health = manager.healthCheck();
      const failed = Object.entries(health).filter(([, h]) => h.status === 'start_failed' || h.status === 'init_failed');
      if (failed.length > 0) {
        log.warn({ modules: failed.map(([n]) => n) }, 'Módulos com falha detectados');
      }
    }, 60_000);
  });

  const componentModules = Object.entries({'crow:ticket:':'tickets','crow:giveaway:':'giveaways','autoroles:':'autoroles','verification:':'verification','form:':'forms','poll:':'polls','sug:':'suggestions','store:':'store','modmail:':'modmail'});
  const commandOwners=new Map(modules.flatMap(m=>m.getCommands().map(c=>[c.name,m.name])));
  const healthTimer=setInterval(()=>process.send?.({type:'gateway',ready:client.isReady()}),3000);
  healthTimer.unref();
  client.on(Events.ShardDisconnect,()=>process.send?.({type:'gateway',ready:false}));
  client.on(Events.ShardResume,()=>process.send?.({type:'gateway',ready:client.isReady()}));
  client.on(Events.InteractionCreate, async interaction => {
    try {
      const mod=interaction.commandName ? commandOwners.get(interaction.commandName) :
        componentModules.find(([prefix])=>interaction.customId?.startsWith(prefix))?.[1];
      if (mod && (!permittedGuild(interaction.guildId) || !state.active(interaction.guildId).includes(mod))) {
        if(interaction.isRepliable()) await interaction.reply({content:'Módulo desativado neste servidor.',flags:64});
        return;
      }
      bus.emit('interaction:create', { interaction });
    } catch (err) {
      log.error({ err, type: interaction.type }, 'Erro não tratado em interação');
      const payload = { content: 'Ocorreu um erro interno. A equipe foi notificada.', flags: 64 };
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else if (interaction.isRepliable?.()) await interaction.reply(payload);
      } catch (e) {
        log.error({ err: e }, 'Falha ao responder erro de interação');
      }
    }
  });

  client.on(Events.Error, error => {
    log.error({ err: error }, 'Erro de conexão Discord');
  });

  client.on(Events.Warn, warning => {
    log.warn({ warning }, 'Aviso Discord');
  });

  // 9. Graceful shutdown
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(healthTimer);
    log.info({ signal }, 'Encerramento gracioso iniciado...');

    try {
      // Parar JobScheduler primeiro
      scheduler.stop();

      // Parar módulos na ordem inversa
      await manager.stopAll();
      bus.emit('bot:shutdown', { signal });

      // Desconectar do Discord
      client.destroy();
      log.info('Cliente Discord desconectado');

      // Fechar banco de dados
      closeDatabase();
      log.info('Banco de dados fechado');

      log.info('Encerramento concluído');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'Erro durante encerramento');
      process.exit(1);
    }
  }

  process.on('message',msg=>{if(msg?.type==='stop') shutdown('instalador');});
  process.on('disconnect',()=>shutdown('janela fechada'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', err => {
    log.error({ err }, 'Promise rejeitada não tratada');
  });
  process.on('uncaughtException', err => {
    log.fatal({ err }, 'Exceção não capturada');
    shutdown('uncaughtException');
  });

  // Painel administrativo de loopback
    try {
      const { startPanel } = require('../local-api');
      await startPanel({client,synchronize,gatewayIntents,openBotManager:process.send ? ()=>new Promise((resolve,reject)=>process.send({type:'manage-bot'},err=>err?reject(err):resolve())) : undefined, gateway:()=>({status:client.isReady() && initialized?'running':'connecting', uptime:client.isReady()?Math.floor(client.uptime/1000):0})});
    } catch (err) {
      log.error({ err }, 'Falha ao iniciar painel administrativo — bot continua sem painel');
    }


  // 11. Conectar ao gateway
  await client.login(process.env.DISCORD_TOKEN);
}

main().catch(err => {
  console.error('Falha fatal na inicialização:', err.message);
  process.exit(1);
});