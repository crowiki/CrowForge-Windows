# 🦅 CrowForge

**Revisão da plataforma:** [Guia de análise técnica da versão 1.1.0](docs/GUIA_DE_ANALISE.md).


**Superbot Discord profissional e modular — 23 módulos integrados**

Sistema completo, reutilizável e confiável para comunidades, servidores gamers, criadores, lojas digitais legítimas, suporte e equipes. Projetado para distribuição comercial como executável standalone.

---

## ✨ Visão Geral

O **CrowForge** é um bot Discord enterprise-grade desenvolvido em Node.js com Discord.js v14. Sua arquitetura modular permite ativação/desativação individual de funcionalidades por servidor, com persistência em SQLite (WASM) e painel de controle em tempo real via Fastify.

### Destaques Técnicos
- **23 módulos independentes** com contrato padronizado (`init`, `start`, `stop`, `health`)
- **Interaction bus pattern** — comunicação desacoplada entre módulos
- **SQLite WASM (sql.js)** com persistência em arquivo local
- **Custom commands via REST API** — registro dinâmico no Discord
- **White Label** — apelido do bot no servidor e prévia das cores e textos
- **Painel administrativo** em `http://127.0.0.1:3000` (loopback-only)
- **Segurança first** — permissões hierárquicas, isolamento por guild, prepared statements

---

## 📦 Módulos Incluídos (23)

**Setup e ajuda** — `/setup` e `/help`.

### 🛡️ Moderação e Segurança
| Módulo | Comandos | Descrição |
|--------|----------|-----------|
| **Tickets** | `/ticket` | Sistema de suporte com categorias, prioridades e logs |
| **Moderation** | `/mod` | Ban, kick, mute, warn com hierarquia e casos |
| **AutoMod** | `/automod` | Filtros de spam, links, palavras com cache TTL |
| **Anti-Raid** | `/configurar-antiraid` | Detecção de flood joins e contas novas |
| **Verification** | `/configurar-verificacao` | Captcha e regras de entrada com cleanup automático |

### 👥 Gerenciamento de Membros
| Módulo | Comandos | Descrição |
|--------|----------|-----------|
| **Welcome** | `/configurar-boasvindas` | Boas-vindas e despedidas customizáveis |
| **Auto-Roles** | `/configurar-autoroles` | Atribuição automática de cargos |
| **Levels** | `/rank`, `/leaderboard`, `/configurar-niveis` | XP, ranks e leaderboard |

### 🎮 Engajamento
| Módulo | Comandos | Descrição |
|--------|----------|-----------|
| **Giveaways** | `/sorteio` | Sorteios com Fisher-Yates e scheduler persistente |
| **Polls** | `/enquete` | Enquetes com múltiplas opções |
| **Suggestions** | `/sugestao` | Sistema de sugestões com voting workflow |
| **Forms** | `/formulario` | Formulários dinâmicos via modal |

### 💰 Economia e Loja
| Módulo | Comandos | Descrição |
|--------|----------|-----------|
| **Economy** | `/saldo`, `/daily`, `/trabalhar`, `/transferir`, `/loja`, `/inventario`, `/configurar-economia` | Sistema econômico completo |
| **Store** | `/shop` | Loja de itens com checkout e histórico |

### 🛠️ Utilitários
| Módulo | Comandos | Descrição |
|--------|----------|-----------|
| **Custom Commands** | `/comando` | Comandos customizados registrados via REST API |
| **Embed Builder** | `/embed` | Construtor de embeds com templates |
| **Stats** | `/stats` | Estatísticas de atividade (mensagens, voz) |
| **Temp Voice** | `/tempvoice` | Canais de voz temporários auto-create/delete |
| **Reminders** | `/lembrar` | Lembretes com job scheduler persistente |
| **ModMail** | `/modmail` | Sistema de modmail via DM |
| **Alerts** | `/alertas` | Alertas configuráveis com webhook |

### 🎨 Personalização
| Módulo | Comandos | Descrição |
|--------|----------|-----------|
| **White Label** | `/marca` | Marca personalizada (cores, nome, avatar, footer) |

---

## 🚀 Requisitos

- **Node.js** >= 22.12.0
- **Discord Bot** com intents `MESSAGE_CONTENT` e `GUILD_MEMBERS` habilitados no Developer Portal
- **Windows 10/11** (produção) ou Linux/macOS (desenvolvimento)
- **Aplicação Discord** criada em https://discord.com/developers/applications

---

## 📥 Instalação

### Aplicativo Windows

Execute **Instalar CrowForge.exe**. O pacote já inclui o Node.js.

### Interface na edição de desenvolvimento
```bash
npm --prefix installer start
```
Siga as etapas no instalador: verificar ambiente → configurar credenciais → instalar dependências → iniciar bot.

### Manual
```bash
# 1. Instale as dependências
npm install

# 2. Configure o .env (veja seção abaixo)

# 3. Registre os comandos slash
npm run deploy

# 4. Inicie o bot
npm run bot
```

---

## ⚙️ Configuração (.env)

```env
DISCORD_TOKEN=seu_token_aqui
CLIENT_ID=seu_client_id_aqui
GUILD_ID=id_da_guild_principal
PANEL_PORT=3000
DATABASE_PATH=./data/crowbot.db
ENABLE_MESSAGE_CONTENT=true
ENABLE_GUILD_MEMBERS=true
ENABLED_MODULES=setup,tickets,moderation,automod,welcome,levels,giveaways,antiraid,autoroles,verification,economy,polls,forms,suggestions,embed-builder,custom-commands,stats,temp-voice,reminders,modmail,store,alerts,white-label
LOG_LEVEL=info
```

### Ativando/Desativando Módulos
O instalador define a seleção inicial. Para alterar os módulos de um servidor já configurado, use os interruptores do painel local.

---

## 🏗️ Estrutura do Projeto

```
CrowBot_Ultimate/
├── apps/
│   ├── bot/              # Ponto de entrada principal (apps/bot/index.js)
│   │   └── deploy-commands.js  # Script de registro de comandos
│   ├── local-api/        # API REST local (Fastify)
│   └── dashboard/        # Painel web (React + Vite)
├── modules/              # 23 módulos do bot
│   ├── tickets/
│   ├── moderation/
│   ├── levels/
│   ├── giveaways/
│   ├── welcome/
│   ├── automod/
│   ├── antiraid/
│   ├── autoroles/
│   ├── verification/
│   ├── economy/
│   ├── polls/
│   ├── forms/
│   ├── suggestions/
│   ├── embed-builder/
│   ├── custom-commands/
│   ├── stats/
│   ├── temp-voice/
│   ├── reminders/
│   ├── modmail/
│   ├── store/
│   ├── alerts/
│   ├── white-label/
│   └── index.js          # Registry central de módulos
├── packages/
│   ├── core/             # Logger (pino), event bus, module manager
│   └── db/               # SQLite WASM wrapper (sql.js)
├── data/                 # Banco de dados SQLite (gerado automaticamente)
├── tests/                # Testes unitários e de integração
├── installer/            # Instalador GUI
├── docs/                 # Documentação (MANUAL.md, FAQ, etc.)
├── .env                  # Variáveis de ambiente
├── package.json
└── README.md
```

---

## 🔧 Scripts Disponíveis

```bash
npm run bot          # Inicia o bot (apps/bot/index.js)
npm run api          # Inicia a API local
npm run dashboard    # Inicia o painel web (dev mode)
npm run deploy       # Registra comandos slash no Discord
npm run test         # Executa testes unitários
npm run test:integration  # Executa testes de integração
```

---

## 📐 Contrato de Módulo

Todo módulo deve exportar:

```javascript
module.exports = {
  name: 'nome-do-modulo',
  getCommands(),      // Retorna array de SlashCommandBuilder.toJSON()
  async init(ctx),    // Inicialização (ensureSchema, caches, etc.)
  async start(),      // Registra handlers no interaction bus
  async stop(),       // Cleanup: remove listeners, clear intervals
  health()            // Retorna { status: 'ok', ...metrics }
};
```

### Padrões Obrigatórios
- **`deferReply` + `editReply`** — sempre use para evitar timeout em comandos longos
- **`setDefaultMemberPermissions`** — apenas no root SlashCommandBuilder, nunca em subcomandos
- **Listener cleanup** — armazene referência do handler e remova com `.off()` no `stop()`
- **`CREATE TABLE IF NOT EXISTS`** — nunca use `DROP TABLE` em `ensureSchema()`
- **Filtro GUILD_ID** — todo listener de evento global deve filtrar por `process.env.GUILD_ID`

---

## Distribuição comercial Windows

A entrega ao comprador é **Instalar CrowForge.exe**, edição 1.1.0 para Windows x64. O instalador apresenta a licença, inclui as dependências e instala o guia de uso. A licença de uso da versão adquirida é perpétua. A validade técnica é de **12 meses a partir da compra**.

- [Licença da edição executável](LICENCA.md)
- [Guia do comprador](docs/MANUAL.md)
- [Texto para a oferta e o comprovante](docs/OFERTA_WINDOWS.md)
- [Registro técnico da candidata RC.6](docs/AUDITORIA_CROWFORGE.md)
- [Termos históricos da edição em fontes](docs/historico/LICENCA_EDICAO_FONTES_1.0.0.md)

## 📄 Documentação

- [Manual Completo](docs/MANUAL.md)
- [FAQ](docs/FAQ.md)
- [Solução de Problemas](docs/SOLUCAO_DE_PROBLEMAS.md)
- [Permissões Discord](docs/PERMISSOES_DISCORD.md)
- [Status do Projeto](STATUS_PROJETO.md)
- [Changelog](CHANGELOG.md)

---

## 🤝 Suporte

Consulte a documentação antes de abrir ticket. Suporte de instalação incluído conforme contrato.

## 📄 Licença

Proprietário — todos os direitos reservados. Distribuição não autorizada é proibida.

---

**Desenvolvido com ❤️ pela equipe CrowForge**