#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "============================================"
echo "CrowBot Ultimate - Iniciando..."
echo "============================================"
echo ""

# Verificar dependências
if [ ! -d "node_modules" ]; then
 echo "✗ Dependências não instaladas!"
 echo " Execute 03_instalar.sh primeiro."
 exit 1
fi

# Verificar .env
if [ ! -f ".env" ]; then
 echo "✗ Arquivo .env não encontrado!"
 echo " Execute 02_configurar.sh primeiro."
 exit 1
fi

echo "Bot iniciando... Pressione Ctrl+C para encerrar."
echo "O painel administrativo estará disponível em:"
echo " http://127.0.0.1:3000"
echo ""
echo "============================================"
echo ""

node apps/bot/index.js

echo ""
echo "============================================"
echo "CrowBot foi encerrado."
echo "Veja mensagens de erro acima, se houver."
echo "============================================"