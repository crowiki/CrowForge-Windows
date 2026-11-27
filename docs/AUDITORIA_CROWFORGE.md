# Verificação de distribuição · CrowForge RC.6

26/11/2026 · Windows x64 · 1.1.0-rc.6

Registro histórico anterior ao lançamento. A licença vigente para novas compras está em [Licença Windows](../LICENCA.md).

**Decisão técnica na RC.6:** candidata aprovada para homologação com compradores-piloto. A liberação comercial ampla depende dos pontos abaixo.

## Arquivo examinado

`Instalar CrowForge.exe`, 166.741.674 bytes. SHA-256 `e1decf09a51395008d1632b7e24ea05f111d1f7354dbe32afe299f17b51d6649`. O hash coincide com o registrado ao gerar a RC.6. A verificação usou o instalador existente.

## Evidências

- Extração do NSIS, abertura da janela Electron, teste de SQLite e painel com o Node embarcado em perfil temporário e PATH isolado.
- Comparação dos arquivos de execução, do painel compilado e dos principais arquivos do assistente com o projeto testado. Nenhuma divergência observada nessa comparação.
- 130 testes unitários e 10 de integração aprovados no projeto. Teste de interface em Chromium aprovado, incluindo servidor inacessível simulado, troca de tela, logout e remoção do cadastro.
- Catálogo e registro do runtime com 23 módulos e 35 nomes de comandos principais distintos.
- Verificador de distribuição passou na triagem de estado local e padrões de segredos; npm audit retornou zero alertas conhecidos no lockfile das dependências de produção do runtime.
- Windows identifica o instalador como sem assinatura Authenticode.

## Antes da liberação ampla

- Validar instalação pelo assistente, atualização sobre um perfil existente e desinstalação em Windows limpo usando este mesmo hash. O relato de teste em outro computador referia-se a uma versão anterior.
- Validar com contas de teste os fluxos de Discord prometidos na oferta, especialmente tickets, permissões de moderação e entrega da loja. A execução automatizada usa também respostas simuladas.
- As integrações Twitch e YouTube continuam sem homologação de eventos reais, adiada a pedido do proprietário.
- Aprovar os termos da edição Windows: o documento de licença atual descreve um ZIP com o código-fonte e direito de modificação. Decidir a assinatura digital e o conteúdo da entrega antes de anunciar a compradores.

## Catálogo conferido no registro

| Módulo | Comandos principais |
| --- | --- |
| Setup & Ajuda | `/setup`, `/help` |
| Tickets | `/configurar-tickets`, `/painel-tickets`, `/ticket` |
| Moderação | `/moderar`, `/configurar-mod` |
| Níveis e XP | `/rank`, `/leaderboard`, `/configurar-niveis` |
| Sorteios | `/sorteio` |
| Boas-vindas | `/configurar-boasvindas` |
| AutoMod | `/automod` |
| Anti-raid | `/configurar-antiraid` |
| Cargos automáticos | `/configurar-autoroles` |
| Verificação | `/configurar-verificacao` |
| Economia | `/saldo`, `/daily`, `/trabalhar`, `/transferir`, `/loja`, `/inventario`, `/configurar-economia` |
| Enquetes | `/enquete` |
| Formulários | `/formulario` |
| Sugestões | `/sugestao` |
| Editor de embeds | `/embed` |
| Comandos personalizados | `/comando` |
| Estatísticas | `/stats` |
| Salas de voz temporárias | `/voz-temp` |
| Lembretes | `/lembrete` |
| ModMail | `/modmail` |
| Loja | `/shop` |
| Alertas | `/alerta` |
| Personalização de marca | `/marca` |
