# Changelog — CrowForge

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/), e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [1.1.0] — 26/11/2026

Distribuição comercial Windows x64 baseada na RC.6, com 23 módulos, 35 comandos principais, licença e guia incluídos no instalador.

### Histórico de desenvolvimento anterior ao fechamento

### Corrigido
- **M01 Dashboard:** Módulos agora agrupados por guild_id com discriminação visual no painel (ponto verde + ID do servidor)
- **M04 JobScheduler:** Recuperação automática de jobs órfãos com status 'executing' após crash/reinício, resetando para 'pending'

### Adicionado
- **M04 Anti-Raid (`modules/antiraid`):** Proteção contra ataques de entrada em massa. Verifica idade da conta e flood de joins. Ações configuráveis: kick, ban, timeout. Logs opcionais. Comando `/configurar-antiraid`. Testado em produção.
- **M05 Auto-Roles (`modules/autoroles`):** Cargos automáticos com dois modos: "todos na entrada" (atribuição direta) e "painel de escolha" (botões interativos com toggle). Suporta até 5 cargos. Comando `/configurar-autoroles`. Testado em produção.
- **M07 Verificação/Regras (`modules/verification`):** Sistema de verificação com captcha matemático via modal, painel de regras com botão "Aceitar Regras", cargo de não-verificado opcional, DM de boas-vindas e logs. Comando `/configurar-verificacao`. Testado em produção.
- **Protótipo histórico, fora da edição comercial 1.1.0.** Licenciamento Digital (`modules/licensing`):** Sistema de chaves `CF-XXXXXX-XXXXXX-XXXXXX-XXXXXX` com validação, período de carência, middleware de enforcement (warn/block) e logs. Tabelas `licenses` e `license_validations` criadas automaticamente. Comandos `/licenca ativar`, `/licenca status`, `/licenca configurar`.
- **Economia (`modules/economy`):** Moeda virtual configurável, daily com streak (bônus progressivo até 7x), trabalho com cooldown e empregos aleatórios, transferências entre usuários, loja com itens/cargos/estoque, inventário. Tabelas `economy_wallets`, `economy_transactions`, `economy_shop`, `economy_inventory`. Comandos `/saldo`, `/daily`, `/trabalhar`, `/transferir`, `/loja`, `/inventario`, `/configurar-economia`.

### Alterado
- Total de módulos ativos: 6 → 11
- Intents MESSAGE_CONTENT e GUILD_MEMBERS habilitados no .env e ativados no Developer Portal
- Área de projeto reorganizada: builds movidos para `builds/`, pastas obsoletas removidas

---

## [1.0.0] — 23/11/2026

### Lançamento Inicial

#### Adicionado
- **Core:** Arquitetura modular com ModuleManager, EventBus e logger estruturado (pino)
- **Banco de Dados:** SQLite via sql.js (WASM) com schema versionado, 24 tabelas, repositório base e migração automática de JSON v0.1
- **Jobs:** JobScheduler persistente em SQLite com polling, catch-up após reinício e handlers assíncronos
- **M01 Tickets:** Sistema completo de atendimento com categorias, equipe, modais, debounce, logs e histórico preservado
- **M02 Moderação:** Warn, timeout, kick, ban, bulk delete com verificação de hierarquia e registro sequencial de casos
- **M03 AutoMod:** Filtros configuráveis (bad_words, links, invites, caps, spam_repeat, mass_mentions) com ações delete/warn/timeout e exceções por cargo/canal/usuário
- **M06 Boas-vindas:** Mensagens de entrada/saída personalizáveis com variáveis {user}/{server}/{count}, opção de DM
- **M08 Níveis:** Sistema de XP com cooldown anti-farm (60s), fórmula level = floor(0.1 × √XP), leaderboard paginado
- **M10 Sorteios:** Criação por comando, participação por botão, encerramento automático via JobScheduler, seleção aleatória de vencedores
- **Painel Web:** Dashboard React + Fastify em localhost:3000 com autenticação por sessão, stats em tempo real e toggle de módulos por servidor
- **Instalador:** Scripts .bat (Windows) e .sh (Linux) para verificação, configuração, instalação e início automatizados
- **Testes:** 55 testes unitários cobrindo core, jobs e todos os 6 módulos implementados
- **Documentação:** MANUAL.md, FAQ.md, SOLUCAO_DE_PROBLEMAS.md, PERMISSOES_DISCORD.md, LICENCA.md

#### Corrigido
- B1-B4: Bugs críticos do protótipo v0.1 (race condition em tickets, perda de dados JSON, falta de validação de permissões, ausência de graceful shutdown)
- B14: Bug menor de formatação em logs
- Substituição de better-sqlite3 por sql.js WASM (compatibilidade Windows sem build tools)
- Remoção de `"type": "module"` do package.json (projeto usa CommonJS)
- FK constraint em scheduled_jobs corrigida com INSERT OR IGNORE automático de guilds
- processDueJobs tornado async com await correto em handlers

#### Segurança
- Painel web restrito a 127.0.0.1 (localhost apenas)
- Zero telemetria ou chamadas externas
- Nenhum token, senha ou credencial hardcoded
- Validação de .env na inicialização com erro claro se ausente
- Graceful shutdown com limpeza de recursos (scheduler → módulos → Discord → DB)

#### Documentação
- Especificação mestra completa (24 módulos planejados)
- Auditoria inicial do protótipo v0.1 com 15 bugs classificados
- Status do projeto atualizado com progresso de todas as fases
- Guia de permissões Discord com bitfield combinado para convite

---

## [0.1.0] — Data Original (Protótipo)

### Base Herdada
- Tickets básicos com criação por botão e JSON storage
- Moderação simples (warn, limpar)
- Comandos slash hardcoded
- Sem arquitetura modular, sem banco de dados, sem painel, sem testes

---

## Próximas Versões (Planejadas)

### [1.1.0] — Módulos de Segurança e Comunidade
- M04 Anti-Raid (detecção de raids, quarentena automática)
- M05 Sistema de Cargos (reaction roles, cargos automáticos)
- M07 Verificação (captcha, verificação por DM)

### [1.2.0] — Economia e Engajamento
- M09 Economia (moeda virtual, loja interna, transferências)
- M11 Enquetes (polls com múltiplas opções e resultados em tempo real)
- M12 Formulários (form builder com submissões e exportação)
- M13 Sugestões (sistema de sugestões com votação e status)

### [1.3.0] — Personalização e Utilitários
- M14 Embed Builder (construtor visual de embeds)
- M15 Comandos Customizados (comandos personalizados por servidor)
- M16 Stats (estatísticas do servidor e atividade)
- M17 Voz Temporária (canais de voz dinâmicos)
- M18 Lembretes (reminders pessoais e de servidor)

### [1.4.0] — Comunicação e Integrações
- M19 ModMail (sistema de mensagens privadas para equipe)
- M20 Loja (produtos digitais com pagamento externo)
- M21 Alertas (notificações Twitch/YouTube/webhook)

### [2.0.0] — Comercial e IA
- M22 IA (integração com LLM para respostas automáticas)
- M23 White Label (renomeação completa do bot para marca do comprador)
- M24 Licenciamento Ed25519 (validação de licença offline)

---

*Este changelog é mantido como parte da documentação comercial do CrowBot Ultimate.*