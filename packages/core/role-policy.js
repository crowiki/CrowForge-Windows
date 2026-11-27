const {PermissionFlagsBits: P} = require('discord.js');
const restricted = P.Administrator | P.ManageGuild | P.ManageRoles | P.ManageChannels |
  P.ManageWebhooks | P.KickMembers | P.BanMembers | P.ModerateMembers;
function assignable(role) {
  return !!role && role.editable && !role.managed && role.id !== role.guild.id &&
    !role.permissions.any(restricted);
}
function canConfigure(interaction,role) {
  return assignable(role) && interaction.memberPermissions?.has(P.ManageRoles) &&
    (interaction.guild.ownerId===interaction.user.id || interaction.member.roles.highest.comparePositionTo(role)>0);
}
module.exports={assignable,canConfigure};
