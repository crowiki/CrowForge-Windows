"use strict";
const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createChild } = require('../../packages/core');
const { queryAll, queryGet, runSql } = require('../../packages/db');

const log = createChild('custom-commands');

// === Schema ===
function ensureSchema() {
  runSql(`
    CREATE TABLE IF NOT EXISTS custom_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      creator_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      response_type TEXT NOT NULL DEFAULT 'text',
      response_content TEXT NOT NULL DEFAULT '',
      embed_title TEXT,
      embed_description TEXT,
      embed_color TEXT,
      embed_image TEXT,
      ephemeral INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(guild_id, name)
    )
  `);

  runSql('CREATE INDEX IF NOT EXISTS idx_custom_commands_guild ON custom_commands(guild_id)');
}

// === Helpers ===

function getGuildCommands(guildId) {
  return queryAll(
    'SELECT * FROM custom_commands WHERE guild_id = ? ORDER BY name ASC',
    [guildId]
  );
}

function getCommand(guildId, name) {
  return queryGet(
    'SELECT * FROM custom_commands WHERE guild_id = ? AND name = ?',
    [guildId, name]
  );
}

function parseColor(input) {
  if (!input) return 0x5b8def;
  const cleaned = String(input).replace('#', '');
  const num = parseInt(cleaned, 16);
  return isNaN(num) ? 0x5b8def : num;
}

// === REST API: Registro dinâmico de comandos ===

/**
 * Nomes de comandos estáticos registrados por outros módulos.
 * Usado para filtrar e preservar comandos que NÃO são customizados
 * durante o sync via REST API (evita apagar comandos de outros módulos).
 */
async function syncGuildCommands(guildId) {
  await context.syncCommands(guildId);
}
// Cache de nomes de comandos customizados por guild para lookup rápido
const customCommandNames = new Map();

function rebuildCustomCommandCache() {
  customCommandNames.clear();
  const allCmds = queryAll('SELECT guild_id, name FROM custom_commands');
  for (const cmd of allCmds) {
    if (!customCommandNames.has(cmd.guild_id)) {
      customCommandNames.set(cmd.guild_id, new Set());
    }
    customCommandNames.get(cmd.guild_id).add(cmd.name);
  }
}

function isCustomCommand(guildId, commandName) {
  const names = customCommandNames.get(guildId);
  return names ? names.has(commandName) : false;
}

// === Comandos Slash (estáticos — retornados para o deploy global) ===
function getCommands() {
  const { SlashCommandBuilder } = require('discord.js');
  return [
    new SlashCommandBuilder()
      .setName('comando')
      .setDescription('Gerencia comandos customizados do servidor.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(sub =>
        sub.setName('criar')
          .setDescription('Cria um novo comando customizado.')
          .addStringOption(o => o.setName('nome').setDescription('Nome do comando (ex: regras)').setRequired(true))
          .addStringOption(o => o.setName('tipo').setDescription('Tipo de resposta').setRequired(true)
            .addChoices(
              { name: '💬 Texto', value: 'text' },
              { name: '📋 Embed', value: 'embed' }
            )
          )
          .addStringOption(o => o.setName('conteudo').setDescription('Conteúdo da resposta').setRequired(true))
          .addStringOption(o => o.setName('titulo').setDescription('Título (apenas para embed)'))
          .addStringOption(o => o.setName('cor').setDescription('Cor em hex (apenas para embed)'))
          .addStringOption(o => o.setName('imagem').setDescription('URL de imagem (apenas para embed)'))
          .addBooleanOption(o => o.setName('efemero').setDescription('Resposta visível apenas para quem usou'))
      )
      .addSubcommand(sub =>
        sub.setName('editar')
          .setDescription('Edita um comando customizado existente.')
          .addStringOption(o => o.setName('nome').setDescription('Nome do comando').setRequired(true))
          .addStringOption(o => o.setName('conteudo').setDescription('Novo conteúdo da resposta').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('remover')
          .setDescription('Remove um comando customizado.')
          .addStringOption(o => o.setName('nome').setDescription('Nome do comando').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('listar')
          .setDescription('Lista todos os comandos customizados do servidor.')
      )
  ];
}

// === Handlers ===

async function handleCriar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de criar comando');
    return;
  }

  try {
    const name = interaction.options.getString('nome', true).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const type = interaction.options.getString('tipo', true);
    const content = interaction.options.getString('conteudo', true);
    const title = interaction.options.getString('titulo');
    const color = interaction.options.getString('cor');
    const image = interaction.options.getString('imagem');
    const ephemeral = interaction.options.getBoolean('efemero') || false;

    if (!name || name.length < 2) {
      return interaction.editReply({ content: '❌ Nome do comando inválido. Use pelo menos 2 caracteres (letras, números, _ ou -).' });
    }

    if (name.length > 32) {
      return interaction.editReply({ content: '❌ Nome do comando muito longo. Máximo de 32 caracteres.' });
    }

    if (require('../index').getAllCommands().some(command=>command.name===name))
      return interaction.editReply({content:'Este nome já pertence a um comando do aplicativo.'});
    // Verificar se já existe
    const existing = getCommand(interaction.guildId, name);
    if (existing) {
      return interaction.editReply({ content: `❌ Já existe um comando chamado \`${name}\`. Use \`/comando editar\` para modificá-lo.` });
    }

    // Limitar número de comandos por guild
    const guildCmds = getGuildCommands(interaction.guildId);
    if (guildCmds.length >= 50) {
      return interaction.editReply({ content: '❌ Limite de 50 comandos customizados por servidor atingido.' });
    }

    runSql('INSERT OR IGNORE INTO guilds (guild_id, name) VALUES (?, ?)',
      [interaction.guildId, interaction.guild?.name || 'Unknown']);

    runSql(
      `INSERT INTO custom_commands (guild_id, creator_id, name, response_type, response_content, embed_title, embed_color, embed_image, ephemeral)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        interaction.guildId,
        interaction.user.id,
        name,
        type,
        content,
        title || null,
        color || null,
        image || null,
        ephemeral ? 1 : 0
      ]
    );

    // Atualizar cache e sincronizar via REST
    rebuildCustomCommandCache();
    await syncGuildCommands(interaction.guildId);

    log.info({ guildId: interaction.guildId, name, type }, 'Comando customizado criado e registrado via REST');

    await interaction.editReply({
      content: `✅ Comando \`/${name}\` criado e registrado com sucesso!\n\n⏳ O comando pode levar alguns segundos para aparecer na lista de slash commands do Discord.`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao criar comando customizado');
    try {
      await interaction.editReply({ content: `❌ Erro ao criar comando: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleEditar(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de editar comando');
    return;
  }

  try {
    const name = interaction.options.getString('nome', true).toLowerCase();
    const content = interaction.options.getString('conteudo', true);

    const cmd = getCommand(interaction.guildId, name);
    if (!cmd) {
      return interaction.editReply({ content: `❌ Comando \`${name}\` não encontrado.` });
    }

    runSql(
      "UPDATE custom_commands SET response_content = ? WHERE id = ?",
      [content, cmd.id]
    );

    // Re-sincronizar (descrição pode mudar se for embed)
    rebuildCustomCommandCache();
    await syncGuildCommands(interaction.guildId);

    log.info({ guildId: interaction.guildId, name }, 'Comando customizado editado');

    await interaction.editReply({
      content: `✅ Comando \`/${name}\` atualizado com sucesso!`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao editar comando customizado');
    try {
      await interaction.editReply({ content: `❌ Erro ao editar comando: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleRemover(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    log.error({ err }, 'Falha ao deferir resposta de remover comando');
    return;
  }

  try {
    const name = interaction.options.getString('nome', true).toLowerCase();

    const cmd = getCommand(interaction.guildId, name);
    if (!cmd) {
      return interaction.editReply({ content: `❌ Comando \`${name}\` não encontrado.` });
    }

    runSql("DELETE FROM custom_commands WHERE id = ?", [cmd.id]);

    // Re-sincronizar para remover o slash command do Discord
    rebuildCustomCommandCache();
    await syncGuildCommands(interaction.guildId);

    log.info({ guildId: interaction.guildId, name }, 'Comando customizado removido e desregistrado via REST');

    await interaction.editReply({
      content: `✅ Comando \`/${name}\` removido com sucesso!`
    });
  } catch (err) {
    log.error({ err, stack: err?.stack }, 'Erro ao remover comando customizado');
    try {
      await interaction.editReply({ content: `❌ Erro ao remover comando: ${err?.message || 'desconhecido'}` });
    } catch { /* ignora */ }
  }
}

async function handleListar(interaction) {
  const cmds = getGuildCommands(interaction.guildId);

  if (cmds.length === 0) {
    return interaction.reply({
      content: '📋 Nenhum comando customizado neste servidor. Use `/comando criar` para adicionar um.',
      flags: MessageFlags.Ephemeral
    });
  }

  const list = cmds.map(c => {
    const typeEmoji = c.response_type === 'embed' ? '📋' : '💬';
    const ephLabel = c.ephemeral ? ' 🔒' : '';
    return `\`/${c.name}\` ${typeEmoji}${ephLabel}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('📋 Comandos Customizados')
    .setDescription(list)
    .setColor(0x5b8def)
    .setFooter({ text: `${cmds.length} comando(s) • Use /comando editar ou /comando remover para gerenciar` });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// === Handler de execução de comando customizado ===

async function handleCustomCommand(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  // Verificar rapidamente no cache se é um comando customizado
  if (!isCustomCommand(interaction.guildId, interaction.commandName)) return false;

  const cmd = getCommand(interaction.guildId, interaction.commandName);
  if (!cmd) return false;

  try {
    if (cmd.response_type === 'embed') {
      const embed = new EmbedBuilder()
        .setDescription(cmd.response_content)
        .setColor(parseColor(cmd.embed_color))
        .setTimestamp();

      if (cmd.embed_title) embed.setTitle(cmd.embed_title);
      if (cmd.embed_image) embed.setImage(cmd.embed_image);

      await interaction.reply({
        embeds: [embed],
        flags: cmd.ephemeral ? MessageFlags.Ephemeral : undefined
      });
    } else {
      await interaction.reply({
        content: cmd.response_content,
        flags: cmd.ephemeral ? MessageFlags.Ephemeral : undefined
      });
    }

    log.info({ guildId: interaction.guildId, command: interaction.commandName }, 'Comando customizado executado');
    return true;
  } catch (err) {
    log.error({ err, guildId: interaction.guildId, command: interaction.commandName }, 'Erro ao executar comando customizado');
    try {
      await interaction.reply({ content: '❌ Erro ao executar este comando.', flags: MessageFlags.Ephemeral });
    } catch { /* ignora */ }
    return true;
  }
}

// === Contrato do Módulo ===
let context = null;

module.exports = {
  name: 'custom-commands',
  getCommands,

  async init(ctx) {
    context = ctx;
    ensureSchema();
    rebuildCustomCommandCache();
    log.info('Módulo Comandos Customizados inicializado');
  },

  async start() {
    if (!context?.bus) return;

    context.bus.on('interaction:create', async ({ interaction }) => {
      if (!interaction.inGuild()) return;

      // Tentar executar comando customizado primeiro
      if (interaction.isChatInputCommand() && require('../state').isEnabled(interaction.guildId,'custom-commands')) {
        const handled = await handleCustomCommand(interaction);
        if (handled) return;
      }

      // Se não é comando customizado, verificar se é /comando
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'comando') return;

      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'criar': return handleCriar(interaction);
        case 'editar': return handleEditar(interaction);
        case 'remover': return handleRemover(interaction);
        case 'listar': return handleListar(interaction);
      }
    });

    log.info('Módulo Comandos Customizados iniciado — handlers registrados, REST sync agendado');
  },

  async stop() {
    customCommandNames.clear();
    log.info('Módulo Comandos Customizados parado');
  },

  health() {
    const count = queryGet("SELECT COUNT(*) as count FROM custom_commands");
    return {
      status: 'ok',
      totalCommands: count?.count ?? 0,
      cachedGuilds: customCommandNames.size
    };
  }
};