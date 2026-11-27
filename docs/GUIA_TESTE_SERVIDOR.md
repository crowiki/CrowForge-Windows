> Roteiro histórico da edição distribuída em fontes. Para a edição Windows comercial, consulte o [guia do comprador](MANUAL.md).

# CrowBot Ultimate — Guia de Teste em Servidor Discord

**Versão:** 1.0.0 | **Data:** 23/11/2026

---

## Pré-requisitos

Antes de começar, confirme que você tem:

- [ ] Node.js 22.12+ instalado (`node -v`)
- [ ] Conta no Discord com permissão para criar aplicações
- [ ] Servidor Discord de teste (crie um novo se necessário)
- [ ] ZIP `CrowBot_Ultimate_v1.0.0.zip` extraído numa pasta dedicada
- [ ] Conexão estável com a internet

---

## Passo 1: Criar Aplicação no Discord

1. Acesse https://discord.com/developers/applications
2. Clique em **"New Application"**
3. Dê um nome (ex: "CrowBot Teste") → clique **Create**
4. Na aba **"General Information"**, copie o **APPLICATION ID**
5. Na aba **"Bot"**:
   - Clique em **"Reset Token"** (ou "View Token" se já existir)
   - Copie o **TOKEN** imediatamente (ele só aparece uma vez)
   - Ative **"Message Content Intent"** (necessário para AutoMod e níveis)
   - Ative **"Server Members Intent"** (necessário para boas-vindas)
6. Mantive esta aba aberta — você vai precisar desses valores

---

## Passo 2: Convidar o Bot ao Servidor

1. Ainda no Developer Portal, vá em **"OAuth2" → "URL Generator"**
2. Em **SCOPES**, marque:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Em **BOT PERMISSIONS**, marque todas estas:
   - View Channels
   - Send Messages
   - Read Message History
   - Embed Links
   - Attach Files
   - Use Application Commands
   - Manage Channels
   - Manage Roles
   - Manage Messages
   - Moderate Members
   - Kick Members
   - Ban Members
4. Copie o link gerado na parte inferior
5. Abra o link no navegador e selecione seu servidor de teste
6. Autorize o bot

> ⚠️ **Segurança:** Nunca compartilhe este link publicamente. Ele contém as permissões do seu bot.

---

## Passo 3: Configurar o Projeto

1. Extraia o ZIP `CrowBot_Ultimate_v1.0.0.zip` numa pasta própria
   - **Windows:** Evite pastas sincronizadas (OneDrive, Dropbox)
   - **Linux:** Use um diretório como `/opt/crowbot` ou `~/crowbot`

2. Abra o terminal na pasta extraída

3. Execute o configurador:
   ```bash
   # Windows
   02_CONFIGURAR.bat
   
   # Linux
   chmod +x scripts/linux/*.sh
   ./scripts/linux/02_configurar.sh
   ```

4. Ou configure manualmente editando `.env`:
   ```
   DISCORD_TOKEN=cole_o_token_aqui
   CLIENT_ID=cole_o_application_id_aqui
   GUILD_ID=id_do_seu_servidor_de_teste
   LOG_LEVEL=debug
   ```

### Como obter o GUILD_ID

1. No Discord, ative o **Modo Desenvolvedor**: Configurações → Avançado → Modo Desenvolvedor
2. Clique com botão direito no ícone do servidor → **"Copiar ID do Servidor"**
3. Cole no campo `GUILD_ID` do .env

---

## Passo 4: Instalar Dependências

```bash
# Windows
03_INSTALAR.bat

# Linux
./scripts/linux/03_instalar.sh

# Ou manualmente
npm install
node apps/bot/deploy-commands.js
```

### O que este passo faz:
- Instala todas as dependências do Node.js
- Registra os comandos slash no Discord
- Se `GUILD_ID` estiver preenchido, comandos aparecem instantaneamente no servidor

### Verificação de sucesso:
- Terminal mostra "✅ X comandos registrados"
- No Discord, digite `/` no canal de texto — os comandos do CrowBot devem aparecer na lista

---

## Passo 5: Iniciar o Bot

```bash
# Windows
04_INICIAR.bat

# Linux
./scripts/linux/04_iniciar.sh

# Ou manualmente
node apps/bot/index.js
```

### Verificação de sucesso:
- Terminal mostra: `[INFO] CrowBot Ultimate v1.0.0 iniciando...`
- `[INFO] Database initialized`
- `[INFO] ModuleManager: 6 módulos carregados`
- `[INFO] JobScheduler started`
- `[INFO] Painel web disponível em http://127.0.0.1:3000`
- `[INFO] Discord client ready` com o nome do bot
- O bot aparece **online** na lista de membros do servidor

---

## Passo 6: Testar Cada Módulo

### 🎫 Tickets Profissionais

1. **Configurar sistema:**
   ```
   /configurar-tickets categoria:@Tickets equipe:@Suporte logs:#logs-tickets
   ```
   - Crie uma categoria "Tickets" e um cargo "Suporte" antes
   - Crie um canal "#logs-tickets" para receber notificações

2. **Publicar painel:**
   ```
   /painel-tickets canal:#suporte titulo:Central de Ajuda
   ```

3. **Testar abertura:**
   - Clique no botão "🎫 Abrir ticket" no painel
   - Preencha o modal com um motivo
   - Confirme que um canal privado foi criado
   - Verifique que apenas você e a equipe podem ver

4. **Testar fluxo completo:**
   - `/ticket assumir` (como membro da equipe)
   - Envie mensagens no ticket
   - `/ticket adicionar @usuario` (adicione alguém)
   - `/ticket remover @usuario`
   - `/ticket status`
   - `/ticket fechar`
   - Confirme que o canal ficou visível mas você não pode mais enviar

### 🛡️ Moderação Manual

1. **Advertência:**
   ```
   /moderar avisar usuario:@teste motivo:Mensagem inadequada
   /moderar avisos usuario:@teste
   ```

2. **Limpeza:**
   ```
   /moderar limpar quantidade:5
   ```
   - Envie algumas mensagens antes para testar

3. **Timeout:**
   ```
   /moderar timeout usuario:@teste duracao:1h motivo:Spam
   ```

4. **Kick/Ban** (use contas de teste!):
   ```
   /moderar kick usuario:@teste motivo:Violação das regras
   /moderar ban usuario:@teste motivo:Comportamento grave dias:7
   ```

### 🤖 AutoMod

1. **Criar regra de palavras proibidas:**
   ```
   /automod adicionar nome:palavroes tipo:bad_words acao:warn config:palavra1,palavra2
   ```

2. **Criar regra anti-links:**
   ```
   /automod adicionar nome:links tipo:links acao:delete config:{}
   ```

3. **Listar regras:**
   ```
   /automod listar
   ```

4. **Testar:**
   ```
   /automod testar texto:esta mensagem tem palavra1
   ```
   - Envie uma mensagem real com conteúdo filtrado no canal
   - Confirme que foi deletada e o usuário recebeu advertência

### 👋 Boas-vindas

1. **Configurar:**
   ```
   /configurar-boasvindas canal:#boas-vindas mensagem:Bem-vindo {user} ao {server}! Voce e o membro #{count} dm:true despedida:Ate logo {user}!
   ```

2. **Testar entrada:**
   - Convide uma conta de teste ao servidor
   - Verifique mensagem no canal #boas-vindas
   - Verifique DM recebida pelo novo membro

3. **Testar saída:**
   - Remova a conta de teste
   - Verifique mensagem de despedida

### 📊 Níveis e XP

1. **Configurar:**
   ```
   /configurar-niveis canal:#level-ups mensagem:{user} subiu para o nivel {level}! habilitado:true
   ```

2. **Ganhar XP:**
   - Envie mensagens em qualquer canal (cooldown de 60s)
   - Aguarde anúncio de level-up no canal configurado

3. **Verificar progresso:**
   ```
   /rank usuario:@voce
   /leaderboard pagina:1
   ```

### 🎉 Sorteios

1. **Criar sorteio:**
   ```
   /sorteio criar premio:Nitro Classic duracao:5m vencedores:1 canal:#sorteios
   ```

2. **Participar:**
   - Clique no botão "🎉 Participar" na mensagem do sorteio

3. **Verificar participantes:**
   ```
   /sorteio listar
   ```

4. **Encerramento automático:**
   - Aguarde 5 minutos
   - O bot deve anunciar o vencedor automaticamente
   - Mesmo se reiniciar o bot, o sorteio encerra no horário certo

---

## Passo 7: Testar o Painel Web

1. Abra o navegador em http://127.0.0.1:3000
2. Confira se as métricas aparecem ao abrir o painel local.
3. Verifique:
   - Dashboard mostra stats corretos (servidores, tickets, casos)
   - Toggle de módulos funciona (ative/desative e teste no Discord)
   - Status do bot mostra "online"

---

## Passo 8: Testar Resiliência

### Reinício gracioso
1. Pressione `Ctrl+C` no terminal do bot
2. Verifique mensagens de shutdown ordenado
3. Reinicie com `04_INICIAR.bat`
4. Confirme que dados persistiram (tickets, níveis, configurações)

### Jobs persistentes
1. Crie um sorteio de 10 minutos
2. Pare o bot após 2 minutos
3. Aguarde 10 minutos
4. Reinicie o bot
5. Verifique que o sorteio foi encerrado automaticamente (catch-up)

### Recuperação de erros
1. Delete acidentalmente a categoria de tickets no Discord
2. Tente abrir um ticket
3. Verifique que o bot responde com erro claro
4. Reconfigure com `/configurar-tickets`

---

## Checklist Final de Validação

| Item | Status |
|------|--------|
| Bot conecta e fica online | ☐ |
| Comandos slash aparecem e respondem | ☐ |
| Tickets: criar, assumir, fechar, participantes | ☐ |
| Moderação: warn, limpar, timeout, kick, ban | ☐ |
| AutoMod: filtros funcionam, exceções respeitas | ☐ |
| Boas-vindas: mensagem canal + DM | ☐ |
| Níveis: XP ganho, level-up anunciado, rank | ☐ |
| Sorteios: criar, participar, encerrar automático | ☐ |
| Painel web: acesso local, métricas, módulos | ☐ |
| Reinício preserva dados | ☐ |
| Jobs sobrevivem a reinício | ☐ |
| Graceful shutdown funciona | ☐ |
| Logs mostram informações úteis | ☐ |
| Nenhum erro crítico no console | ☐ |

---

## Problemas Comuns Durante Teste

### Comandos não aparecem
- Aguardou alguns segundos? (registro por guild é rápido mas não instantâneo)
- Executou `deploy-commands.js` após mudar .env?
- Bot tem scope `applications.commands` no convite?

### Bot ignora mensagens
- **Message Content Intent** ativado no Developer Portal?
- Bot tem permissão "Ler Mensagens" no canal?

### Ticket não cria
- Categoria existe e é do tipo GuildCategory?
- Cargo de equipe existe?
- Bot tem permissão "Gerenciar Canais" NA CATEGORIA?

### Moderação falha silenciosamente
- Cargo do bot está ACIMA do alvo na hierarquia?
- Permissão específica concedida? (ModerateMembers para timeout, etc.)

### Painel não abre
- Porta 3000 livre?
- Bot está rodando? (painel inicia junto)

---

## Produção (Após Testes)

Quando estiver satisfeito com os testes:

1. **Use PM2 para uptime contínuo:**
   ```bash
   npm install -g pm2
   pm2 start apps/bot/index.js --name crowbot
   pm2 save
   pm2 startup  # configura reinício no boot
   ```

2. **Faça backup regular:**
   ```bash
   cp data/crowbot.db data/backup_$(date +%Y%m%d).db
   ```

3. **Monitore logs:**
   ```bash
   pm2 logs crowbot
   ```

4. **Para atualizar:**
   - Pare o bot: `pm2 stop crowbot`
   - Extraia nova versão
   - Copie `data/` e `.env`
   - Reinstale: `npm install`
   - Reinicie: `pm2 restart crowbot`

---

*Última atualização: 23/11/2026*