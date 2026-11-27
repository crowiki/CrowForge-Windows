#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "============================================"
echo "CrowBot Ultimate - Configuração Assistida"
echo "============================================"
echo ""
echo "Este assistente vai ajudar você a configurar o bot."
echo "Você precisará de:"
echo "  - Token do Bot (Discord Developer Portal)"
echo "  - Application ID (Client ID)"
echo "  - ID do Servidor (opcional, para testes)"
echo ""
echo "Tutorial: https://discord.com/developers/applications"
echo ""
read -rp "Pressione Enter para continuar..."

# Criar .env se não existir
if [ ! -f ".env" ]; then
 cp ".env.example" ".env"
 echo "Arquivo .env criado a partir do modelo."
 echo ""
fi

# Coletar DISCORD_TOKEN
echo "-------------------------------------------"
read -rp "Cole o TOKEN do bot (ou Enter para manter atual): " TOKEN
if [ -n "$TOKEN" ]; then
 sed -i "s|^DISCORD_TOKEN=.*|DISCORD_TOKEN=$TOKEN|" .env
 echo "Token atualizado!"
else
 echo "Token mantido."
fi
echo ""

# Coletar CLIENT_ID
echo "-------------------------------------------"
read -rp "Cole o APPLICATION ID / CLIENT_ID (ou Enter para manter): " CID
if [ -n "$CID" ]; then
 sed -i "s|^CLIENT_ID=.*|CLIENT_ID=$CID|" .env
 echo "Client ID atualizado!"
else
 echo "Client ID mantido."
fi
echo ""

# Coletar GUILD_ID (opcional)
echo "-------------------------------------------"
echo "O GUILD_ID é opcional. Se preenchido, comandos são"
echo "registrados apenas nesse servidor (mais rápido para testes)."
echo "Deixe em branco para registro global."
read -rp "Cole o ID do servidor de teste (ou Enter para pular): " GID
if [ -n "$GID" ]; then
 sed -i "s|^GUILD_ID=.*|GUILD_ID=$GID|" .env
 echo "Guild ID atualizado!"
else
 echo "Guild ID mantido."
fi
echo ""


echo ""
echo "============================================"
echo "Configuração concluída!"
echo "============================================"
echo ""
echo "Para convidar o bot ao seu servidor:"
echo "  1. Acesse https://discord.com/developers/applications"
echo "  2. Selecione sua aplicação > OAuth2 > URL Generator"
echo "  3. Marque scopes: bot + applications.commands"
echo "  4. Marque permissões: Ver Canais, Enviar Mensagens,"
echo "     Gerenciar Canais, Gerenciar Mensagens, Ler Histórico,"
echo "     Incorporar Links, Gerenciar Cargos, Expulsar Membros,"
echo "     Banir Membros, Moderar Membros"
echo "  5. Copie o link gerado e abra no navegador"
echo ""
echo "Próximo passo: ./scripts/linux/03_instalar.sh"
echo "============================================"