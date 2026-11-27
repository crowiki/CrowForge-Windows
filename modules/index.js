"use strict";

/**
 * Registro central de módulos do CrowBot Ultimate.
 * Cada módulo exporta: { name, getCommands(), init(ctx), start(), stop(), health() }
 */

const tickets = require('./tickets');
const moderation = require('./moderation');
const levels = require('./levels');
const giveaways = require('./giveaways');
const welcome = require('./welcome');
const automod = require('./automod');
const antiraid = require('./antiraid');
const autoroles = require('./autoroles');
const verification = require('./verification');
const economy = require('./economy');
const polls = require('./polls');
const forms = require('./forms');
const suggestions = require('./suggestions');
const embedBuilder = require('./embed-builder');
const customCommands = require('./custom-commands');
const stats = require('./stats');
const tempVoice = require('./temp-voice');
const reminders = require('./reminders');
const modmail = require('./modmail');
const store = require('./store');
const alerts = require('./alerts');
const whiteLabel = require('./white-label');
const setup = require('./setup');

const modules = [
  setup,
  tickets,
  moderation,
  levels,
  giveaways,
  welcome,
  automod,
  antiraid,
  autoroles,
  verification,
  economy,
  polls,
  forms,
  suggestions,
  embedBuilder,
  customCommands,
  stats,
  tempVoice,
  reminders,
  modmail,
  store,
  alerts,
  whiteLabel
];

/**
 * Coleta todos os comandos slash de todos os módulos registrados.
 * @returns {Array} Array de SlashCommandBuilder.toJSON()
 */
function getAllCommands() {
  const commands = [];
  for (const mod of modules) {
    if (typeof mod.getCommands === 'function') {
      try {
        const cmds = mod.getCommands();
        if (Array.isArray(cmds)) {
          commands.push(...cmds);
        }
      } catch (err) {
        console.error(`Erro ao coletar comandos do módulo '${mod.name}':`, err.message);
      }
    }
  }
  return commands;
}

module.exports = { modules, getAllCommands };