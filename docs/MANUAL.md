CrowForge para Windows · Guia do comprador
Edição 1.1.0

Primeira instalação

1. Abra Instalar CrowForge.exe em um computador Windows x64 com internet. Leia a licença e conclua a instalação no seu perfil de usuário. O instalador inclui o Node e as dependências.
2. Abra o CrowForge. No Discord Developer Portal, selecione a sua aplicação e obtenha o Application ID e o token do bot. Insira os dados apenas na janela do CrowForge.
3. Escolha os módulos que deseja usar. Você também pode começar com zero módulos e ativá-los depois pelo painel. Use Gerar Link e Convidar para autorizar a aplicação no servidor desejado.
4. No Discord, ative o Modo desenvolvedor em Configurações de usuário → Avançado. Clique com o botão direito no ícone do servidor, selecione Copiar ID do servidor e cole o número no CrowForge. Clique em Já convidei. Se o aplicativo indicar uma intent pendente, ative a opção na aba Bot do Developer Portal, salve e tente novamente.
5. Conclua a configuração, inicie o bot e abra o painel administrativo. O painel abre no navegador do próprio computador, sem senha adicional.

Uso diário

O painel mostra o estado do bot, os tickets, a moderação e os módulos do servidor. Ao ativar um módulo, aguarde a confirmação do Discord naquele interruptor. Permissões de cargos e canais podem exigir ajuste no próprio servidor. Use /help depois de habilitar o módulo Setup e ajuda.

Fechar a janela do CrowForge mantém o aplicativo na bandeja do Windows, perto do relógio. O computador precisa permanecer ligado, conectado e fora da suspensão para o bot funcionar. Use Parar bot para interromper a conexão, ou Sair do CrowForge para encerrar o aplicativo.

Gerenciar bot

No painel do navegador, clique em Gerenciar bot para abrir os controles no aplicativo. Se o bot perdeu acesso ao servidor, use Convidar novamente e depois Verificar servidor. Deslogar encerra a conexão e apaga o token salvo. Adicionar / trocar bot abre o assistente para um vínculo ativo por vez. Remover bot deste computador apaga o vínculo e as credenciais locais após confirmação. O histórico anterior permanece em disco, e uma nova instalação pode começar com um banco separado.

Módulos e comandos principais

Setup & Ajuda — /setup, /help
Tickets — /configurar-tickets, /painel-tickets, /ticket
Moderação — /moderar, /configurar-mod
Níveis e XP — /rank, /leaderboard, /configurar-niveis
Sorteios — /sorteio
Boas-vindas — /configurar-boasvindas
AutoMod — /automod
Anti-raid — /configurar-antiraid
Cargos automáticos — /configurar-autoroles
Verificação — /configurar-verificacao
Economia — /saldo, /daily, /trabalhar, /transferir, /loja, /inventario, /configurar-economia
Enquetes — /enquete
Formulários — /formulario
Sugestões — /sugestao
Editor de embeds — /embed
Comandos personalizados — /comando
Estatísticas — /stats
Salas de voz temporárias — /voz-temp
Lembretes — /lembrete
ModMail — /modmail
Loja — /shop
Alertas — /alerta
Personalização de marca — /marca

Integrações e cópias de segurança

Os alertas Twitch e YouTube precisam de credenciais próprias. No perfil do aplicativo, o arquivo .env aceita TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET e YOUTUBE_API_KEY. Saia do CrowForge antes de alterar a configuração e abra-o novamente ao concluir. Os comandos da loja permitem à equipe confirmar pagamentos e registrar entregas.

O perfil padrão fica em %APPDATA%\CrowForge. Para fazer backup, use Sair do CrowForge e copie a pasta de perfil para um local privado. O arquivo .env contém credenciais. Para atualizar, encerre o aplicativo pela bandeja e execute o novo instalador. Confira o servidor e os módulos ao reabrir.

Atendimento e licença

Use o canal do vendedor indicado na oferta e no comprovante da compra. Ao pedir atendimento, informe a etapa e a mensagem exibida; mantenha o token e o arquivo .env privados. A versão adquirida tem licença de uso perpétua e validade técnica de 12 meses a partir da compra. A licença e este guia ficam disponíveis na pasta resources/documentacao da instalação.
