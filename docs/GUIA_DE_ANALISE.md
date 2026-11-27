# Guia de análise da plataforma · CrowForge 1.1.0

O produto entregue ao comprador é **Instalar CrowForge.exe**, um instalador Windows x64 para um bot do Discord que roda no computador do comprador. Este repositório reúne o código da edição comercial 1.1.0, os arquivos de dependências com versões fixadas e os testes para revisão técnica. A licença de uso do comprador está em [LICENCA.md](../LICENCA.md).

## Identificação do arquivo submetido

| Campo | Valor |
| --- | --- |
| Produto e versão | CrowForge 1.1.0 |
| Arquivo | Instalar CrowForge.exe |
| SHA-256 do arquivo distribuído | `ef497d16fed29b7a59f77364b62b035fe2e37823fe4d7f9f807f09a39d52d05b` |
| Assinatura Authenticode do instalador | Sem assinatura digital |

Para comparar o arquivo recebido no Windows, execute `Get-FileHash -Algorithm SHA256 -LiteralPath '.\Instalar CrowForge.exe'` na pasta que o contém. O hash identifica o binário distribuído pelo vendedor. Uma nova compilação pode produzir outro hash.

## Percurso de revisão

| O que conferir | Onde começar |
| --- | --- |
| Inicialização do bot, conexão com o Discord e registro dos comandos | [apps/bot/index.js](../apps/bot/index.js) |
| Catálogo de 23 módulos, 35 comandos principais e permissões solicitadas | [registro do bot](../modules/index.js) e [catálogo do instalador](../installer/lib/catalog.json) |
| Convite, validação do bot e do servidor, token e gerenciamento de perfis | [installer/lib/installer.js](../installer/lib/installer.js) |
| Interface desktop, bandeja e comunicação com a janela Electron | [installer/main.js](../installer/main.js) e [installer/preload.js](../installer/preload.js) |
| Painel que escuta em loopback e rotas de alteração dos módulos | [apps/local-api/index.js](../apps/local-api/index.js) |
| Armazenamento SQLite, esquema e migração | [packages/db](../packages/db) |
| Integrações opcionais com Twitch e YouTube | [modules/alerts/provider.js](../modules/alerts/provider.js) |
| Arquivos que entram no instalador, compilação NSIS e teste do EXE | [build Windows](../scripts/build_windows.py) e [verificação do instalador](../scripts/verificar_windows.py) |
| Experiência do comprador e condições da oferta | [guia de uso](MANUAL.md) e [oferta da edição Windows](OFERTA_WINDOWS.md) |

O instalador solicita o token do bot criado pelo operador no Discord. O perfil padrão fica em `%APPDATA%\CrowForge`; o arquivo `.env` desse perfil contém as credenciais locais. O repositório inclui um [.env.example](../.env.example) para consulta. O painel web local abre sem senha e o bot depende de internet para se conectar ao Discord.

## Executar os testes

No Windows, a partir da raiz do repositório, use Node.js compatível com o campo `engines` do [package.json](../package.json), npm e Python 3.11 ou superior para os scripts de empacotamento.

```powershell
npm ci
npm --prefix apps/dashboard ci
npm --prefix installer ci
npm --prefix apps/dashboard run build
npm test
npm run test:integration
```

Os testes usam perfis e bancos temporários. Para gerar e verificar um instalador local, execute `python scripts/build_windows.py`. A instalação de dependências e a obtenção dos recursos de build requerem internet. Para testes funcionais no Discord, use uma aplicação e um servidor de teste sob controle do revisor.

Na verificação da edição comercial passaram 130 testes unitários e 10 testes de integração. O pacote também foi extraído e o aplicativo aberto em perfil temporário com o Node embarcado. A contagem dos testes inclui cenários simulados.
