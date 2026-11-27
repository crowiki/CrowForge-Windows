#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "============================================"
echo "CrowBot Ultimate - Instalação de Dependências"
echo "============================================"
echo ""

# Verificar .env
if [ ! -f ".env" ]; then
 echo "✗ Arquivo .env não encontrado!"
 echo " Execute 02_configurar.sh primeiro."
 exit 1
fi

if grep -q "COLE_AQUI_O_TOKEN" .env 2>/dev/null; then
 echo "✗ Token ainda não configurado no .env!"
 echo " Execute 02_configurar.sh para preencher os valores."
 exit 1
fi

# Instalar dependências
echo "[1/3] Instalando pacotes npm..."
echo "Isso pode levar alguns minutos na primeira vez."
echo ""
npm install --no-audit --no-fund
echo ""
echo "✓ Dependências instaladas!"
echo ""

# Migrar dados do v0.1 se existirem
echo "[2/3] Verificando dados para migração..."
if [ -f "src_v0.1/CrowBot_v0.1/data/configs.json" ]; then
 echo "Dados do v0.1 encontrados. Iniciando migração para SQLite..."
 node packages/db/migrate-from-json.js "src_v0.1/CrowBot_v0.1/data" "./data/crowbot.db" || {
 echo "! Aviso: migração falhou. Banco será criado vazio."
 }
else
 echo "Nenhum dado do v0.1 encontrado. Banco será criado vazio."
fi
echo ""

# Registrar comandos
echo "[3/3] Registrando comandos no Discord..."
node apps/bot/deploy-commands.js || {
 echo ""
 echo "✗ Falha ao registrar comandos!"
 echo " Verifique o token e o CLIENT_ID no .env."
 echo " Confirme que o bot foi convidado ao servidor com as permissões corretas."
 exit 1
}

echo ""
echo "============================================"
echo "✓ Instalação concluída com sucesso!"
echo "============================================"
echo ""
echo "Próximo passo: ./scripts/linux/04_iniciar.sh"
echo ""