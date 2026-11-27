const { PermissionFlagsBits: P } = require('discord.js');

const actions = {
  kick: [P.KickMembers, 'kickable'],
  ban: [P.BanMembers, 'bannable'],
  timeout: [P.ModerateMembers, 'moderatable']
};

function authorizeTarget(interaction, target, action) {
  const [permission, capability] = actions[action];
  if (!interaction.memberPermissions?.has(permission)) return 'Você não tem permissão para esta ação.';
  if (!target) return 'Não foi possível confirmar o membro no servidor.';
  if (target.id === interaction.guild.ownerId || target.id === interaction.user.id || target.user.bot)
    return 'Este membro não pode ser alvo desta ação.';
  if (!target[capability]) return 'O bot não tem permissão ou cargo suficiente para esta ação.';
  const role = interaction.member.roles?.highest;
  if (interaction.user.id !== interaction.guild.ownerId && !(role?.comparePositionTo(target.roles.highest) > 0))
    return 'Seu cargo precisa estar acima do cargo do membro.';
  return null;
}
module.exports = { authorizeTarget };
