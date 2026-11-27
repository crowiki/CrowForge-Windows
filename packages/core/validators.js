"use strict";

/**
 * Validadores reutilizáveis para configurações de módulos.
 * Evita que IDs inválidos (canais/cargos deletados) sejam salvos no banco.
 */

/**
 * Verifica se um canal existe no servidor.
 * @param {Guild} guild - Objeto guild do discord.js
 * @param {string} channelId - ID do canal a validar
 * @returns {{valid: boolean, channel?: GuildChannel, error?: string}}
 */
function validateChannel(guild, channelId) {
  if (!channelId) return { valid: true }; // null/undefined é aceitável (opcional)

  const channel = guild.channels.cache.get(channelId);
  if (!channel) {
    return { valid: false, error: `Canal não encontrado (ID: ${channelId}). Ele pode ter sido deletado.` };
  }
  return { valid: true, channel };
}

/**
 * Verifica se um cargo existe no servidor.
 * @param {Guild} guild - Objeto guild do discord.js
 * @param {string} roleId - ID do cargo a validar
 * @returns {{valid: boolean, role?: Role, error?: string}}
 */
function validateRole(guild, roleId) {
  if (!roleId) return { valid: true };

  const role = guild.roles.cache.get(roleId);
  if (!role) {
    return { valid: false, error: `Cargo não encontrado (ID: ${roleId}). Ele pode ter sido deletado.` };
  }
  return { valid: true, role };
}

/**
 * Verifica se o bot tem permissão para enviar mensagens em um canal.
 * @param {GuildChannel} channel - Canal a verificar
 * @param {ClientUser} botUser - Usuário do bot
 * @returns {{valid: boolean, error?: string}}
 */
function validateBotPermissions(channel, botUser) {
  if (!channel?.permissionsFor) return { valid: true };

  const perms = channel.permissionsFor(botUser.id);
  if (!perms) {
    return { valid: false, error: `Não foi possível verificar permissões no canal ${channel.name}.` };
  }

  const missing = [];
  if (!perms.has('ViewChannel')) missing.push('Ver Canal');
  if (!perms.has('SendMessages')) missing.push('Enviar Mensagens');

  if (missing.length > 0) {
    return { valid: false, error: `Permissões insuficientes em ${channel.name}: ${missing.join(', ')}` };
  }
  return { valid: true };
}

module.exports = { validateChannel, validateRole, validateBotPermissions };