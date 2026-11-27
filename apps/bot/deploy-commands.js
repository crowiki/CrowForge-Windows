"use strict";
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { createChild } = require('../../packages/core');
const { getAllCommands } = require('../../modules');

const log = createChild('deploy-commands');

async function main() {
 const token = process.env.DISCORD_TOKEN;
 const clientId = process.env.CLIENT_ID;
 const guildId = process.env.GUILD_ID;

 if (!token || /COLE_AQUI|SEU_TOKEN/i.test(token)) {
 throw new Error('Preencha DISCORD_TOKEN no arquivo .env');
 }
 if (!clientId || /COLE_AQUI|SEU_ID/i.test(clientId)) {
 throw new Error('Preencha CLIENT_ID no arquivo .env');
 }

 const state=require('../../modules/state');
 let enabled=state.selected();
 let body;
 if (guildId && require('node:fs').existsSync(process.env.DATABASE_PATH || './data/crowbot.db')) {
   const db=require('../../packages/db');
   await db.initDatabase(process.env.DATABASE_PATH);
   state.seed(guildId,guildId,enabled);
   enabled=state.active(guildId);
   body=state.commands(enabled,guildId);
   db.closeDatabase();
 }
 body ??= state.commands(enabled);
 const rest = new REST({ version: '10' }).setToken(token);

 if (guildId && !/COLE_AQUI|SEU_ID/i.test(guildId)) {
 log.info({ guildId, count: body.length }, 'Registrando comandos no servidor...');
 await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
 log.info('Comandos registrados com sucesso no servidor!');
 } else {
 log.info({ count: body.length }, 'Registrando comandos globalmente...');
 await rest.put(Routes.applicationCommands(clientId), { body });
 log.info('Comandos registrados globalmente! A propagação pode levar até 1 hora.');
 }

 console.log(`\n✅ ${body.length} comandos publicados! Execute 04_INICIAR.bat para iniciar o bot.`);
}

main().catch(err => {
 console.error('❌ Erro ao registrar comandos:', err.message);
 process.exitCode = 1;
});