# CrowForge — Permissões do Discord

O aplicativo calcula o convite a partir dos módulos selecionados. Esta referência descreve permissões comuns.

---

## Permissões Obrigatórias (Todos os Módulos)

Estas permissões são necessárias para o funcionamento básico do bot em qualquer servidor:

| Permissão | Bit Flag | Motivo |
|---|---|---|
| Ver Canais | `ViewChannel` | Bot precisa enxergar canais para operar |
| Enviar Mensagens | `SendMessages` | Respostas a comandos, logs, notificações |
| Ler Histórico de Mensagens | `ReadMessageHistory` | AutoMod, contexto de moderação, tickets |
| Incorporar Links | `EmbedLinks` | Embeds em tickets, moderação, níveis, sorteios |
| Anexar Arquivos | `AttachFiles` | Logs exportados, imagens em embeds |
| Usar Comandos de Aplicação | `UseApplicationCommands` | Slash commands funcionarem |

---

## Permissões por Módulo

### 🎫 M01 — Tickets Profissionais

| Permissão | Bit Flag | Motivo |
|---|---|---|
| Gerenciar Canais | `ManageChannels` | Criar/editar/deletar canais de ticket |
| Gerenciar Permissões | `ManageRoles` | Configurar permissões individuais nos canais de ticket |

> ⚠️ O cargo do bot deve estar posicionado ACIMA da categoria de tickets na hierarquia de cargos para poder gerenciar permissões dentro dela.

### 🛡️ M02 — Moderação Manual

| Permissão | Bit Flag | Motivo |
|---|---|---|
| Gerenciar Mensagens | `ManageMessages` | `/moderar limpar`, deletar mensagens individuais |
| Moderar Membros | `ModerateMembers` | `/moderar timeout` (silenciar temporariamente) |
| Expulsar Membros | `KickMembers` | `/moderar kick` |
| Banir Membros | `BanMembers` | `/moderar ban` |

> ⚠️ **Hierarquia é crítica:** Para punir um membro, o cargo mais alto do bot deve estar ACIMA do cargo mais alto do alvo. Isso não é configurável via permissão — é arrastando cargos em Servidor → Configurações → Cargos.

### 🤖 M03 — AutoMod

| Permissão | Bit Flag | Motivo |
|---|---|---|
| Gerenciar Mensagens | `ManageMessages` | Deletar mensagens que violam regras |

> Nota: As ações `warn` e `timeout` do AutoMod exigem também as permissões correspondentes do módulo M02.

### 👋 M06 — Boas-vindas

| Permissão | Bit Flag | Motivo |
|---|---|---|
| *(nenhuma adicional)* | — | Usa apenas permissões básicas |

> DMs de boas-vindas dependem das configurações de privacidade do usuário. O bot não pode forçar envio se o usuário bloqueou DMs de membros do servidor.

### 📊 M08 — Níveis e XP

| Permissão | Bit Flag | Motivo |
|---|---|---|
| *(nenhuma adicional)* | — | Escuta MessageCreate (permissão básica) |

### 🎉 M10 — Sorteios

| Permissão | Bit Flag | Motivo |
|---|---|---|
| Gerenciar Mensagens | `ManageMessages` | Editar mensagem do sorteio ao encerrar |
| Adicionar Reações | `AddReactions` | Alternativa futura para entrada por reação |

---

## Permissões Futuras (Módulos Planejados)

### 🔒 M04 — Anti-Raid
- Gerenciar Servidor (`ManageGuild`) — alterar configurações de segurança
- Gerenciar Cargos (`ManageRoles`) — aplicar cargo de quarentena
- Desconectar Membros (`MoveMembers`) — remover de canais de voz

### 🏷️ M05 — Sistema de Cargos
- Gerenciar Cargos (`ManageRoles`) — adicionar/remover cargos automaticamente

### ✅ M07 — Verificação
- Gerenciar Cargos (`ManageRoles`) — atribuir cargo de verificado
- Gerenciar Canais (`ManageChannels`) — canal de verificação dedicado

### 💰 M09 — Economia
- *(nenhuma adicional)* — opera internamente

### 📝 M13 — Sugestões
- Gerenciar Mensagens (`ManageMessages`) — editar embeds de sugestão

### 📢 M21 — Alertas/Twitch/YouTube
- *(nenhuma adicional)* — usa webhooks ou polling externo

### 🎙️ M17 — Voz Temporária
- Gerenciar Canais (`ManageChannels`) — criar/deletar canais de voz dinâmicos
- Mover Membros (`MoveMembers`) — transferir entre canais

---

## Link de Convite Recomendado

Gere o link em **Developer Portal → OAuth2 → URL Generator**:

### Scopes
- ✅ `bot`
- ✅ `applications.commands`

### Permissões (bitfield combinado)
```
ViewChannel           = 0x400
SendMessages          = 0x800
ReadMessageHistory    = 0x10000
EmbedLinks            = 0x4000
AttachFiles           = 0x8000
UseApplicationCommands= 0x80000000
ManageChannels        = 0x10
ManageRoles           = 0x10000000
ManageMessages        = 0x2000
ModerateMembers       = 0x10000000000
KickMembers           = 0x2
BanMembers            = 0x4
AddReactions          = 0x40
```

**Bitfield decimal combinado:** `1111204958208`

Ou selecione manualmente todas as permissões listadas acima no gerador de URL.

---

## Verificação Pós-Convite

Após convidar o bot, confirme:

1. ✅ Bot aparece online na lista de membros
2. ✅ `/ajuda` responde no canal de texto
3. ✅ Bot consegue criar canal (teste `/painel-tickets`)
4. ✅ Bot consegue deletar mensagem (teste `/moderar limpar 1`)
5. ✅ Cargo do bot está acima dos cargos que precisa moderar

Se algum teste falhar, revise as permissões em **Servidor → Configurações → Cargos → [Cargo do Bot]**.

---

## Segurança: Princípio do Menor Privilégio

- Conceda apenas as permissões dos módulos que vai usar
- Se não usar moderação pesada, remova Kick/Ban/ModerateMembers
- Restrinja canais onde o bot opera via permissões de canal individual
- Nunca dê `Administrador` ao bot — conceda permissões granulares
- Revise permissões periodicamente e remova as desnecessárias

---

## Troubleshooting de Permissões

| Sintoma | Causa Provável | Solução |
|---|---|---|
| Bot não vê canal | Falta `ViewChannel` | Adicione permissão no canal ou cargo |
| Comando falha silenciosamente | Falta permissão específica | Verifique tabela do módulo correspondente |
| Não consegue punir admin | Hierarquia insuficiente | Impossível por design do Discord |
| Ticket criado sem permissão | `ManageChannels` parcial | Verifique permissões NA CATEGORIA, não só no servidor |
| Embed não aparece | Falta `EmbedLinks` | Adicione permissão no canal |
| Mensagem não é deletada | Falta `ManageMessages` | Adicione permissão no canal |

---

*Última atualização: 23/11/2026*