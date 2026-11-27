#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "============================================"
echo "CrowBot Ultimate - Verificação de Ambiente"
echo "============================================"
echo ""

ERROS=0

# 1. Node.js
echo "[1/5] Verificando Node.js..."
if ! command -v node &>/dev/null; then
  echo "✗ Node.js não encontrado!"
  echo "  Instale Node.js 22.12+: https://nodejs.org/"
  ERROS=1
else
  NODE_VER=$(node -v)
  echo "✓ Node.js $NODE_VER encontrado"
  node -e "const v=process.versions.node.split('.').map(Number);if(v[0]<22||(v[0]===22&&v[1]<12)){console.log('✗ Versão antiga! Mínimo: 22.12');process.exit(1)}" || ERROS=1
fi
echo ""

# 2. npm
echo "[2/5] Verificando npm..."
if ! command -v npm &>/dev/null; then
  echo "✗ npm não encontrado!"
  ERROS=1
else
  NPM_VER=$(npm -v)
  echo "✓ npm $NPM_VER encontrado"
fi
echo ""

# 3. Internet
echo "[3/5] Verificando conexão com npm registry..."
if curl -sf --max-time 5 https://registry.npmjs.org/ >/dev/null 2>&1; then
  echo "✓ Conexão com npm registry confirmada"
else
  echo "! Aviso: sem conexão com npm registry. Instalação pode falhar."
fi
echo ""

# 4. Permissão de escrita
echo "[4/5] Verificando permissão de escrita..."
mkdir -p data
if touch data/.write_test 2>/dev/null; then
  rm -f data/.write_test
  echo "✓ Permissão de escrita em data/"
else
  echo "✗ Sem permissão de escrita em data/!"
  ERROS=1
fi
echo ""

# 5. Arquivo .env
echo "[5/5] Verificando arquivo de configuração..."
if [ -f ".env" ]; then
  echo "✓ Arquivo .env encontrado"
  if grep -q "COLE_AQUI" .env 2>/dev/null; then
    echo "! Aviso: .env ainda contém valores placeholder. Execute 02_configurar.sh"
  fi
else
  echo "! Arquivo .env não encontrado. Execute 02_configurar.sh para criá-lo."
fi
echo ""

echo "============================================"
if [ "$ERROS" -eq 0 ]; then
  echo "✓ Ambiente verificado com sucesso!"
  echo "  Próximo passo: ./scripts/linux/02_configurar.sh"
else
  echo "✗ Erros encontrados! Corrija antes de continuar."
fi
echo "============================================"
exit $ERROS