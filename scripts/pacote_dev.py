"""Gera um pacote de fontes para homologação local."""
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
FILES = """
.env.example package.json package-lock.json README.md CHANGELOG.md LICENCA.md
INSTALAR_CROWBOT.bat modules/index.js apps/bot/index.js apps/bot/deploy-commands.js
apps/local-api/index.js apps/dashboard/index.html apps/dashboard/package.json
apps/dashboard/package-lock.json apps/dashboard/vite.config.js apps/dashboard/src/App.jsx
apps/dashboard/src/main.jsx apps/dashboard/src/painel.css installer/main.js installer/preload.js installer/crowforge.nsh installer/icon.svg installer/icon.ico installer/renderer/crowforge.svg apps/dashboard/public/crowforge.svg
installer/package.json installer/package-lock.json installer/renderer/index.html
installer/lib/installer.js installer/lib/gateway-intents.js packages/core/event-bus.js packages/core/index.js
packages/core/validators.js packages/core/role-policy.js packages/core/logger.js packages/core/module-manager.js packages/db/index.js
packages/db/module-columns.js packages/db/schema.sql packages/db/migrate-from-json.js packages/jobs/index.js
modules/moderation/permissions.js scripts/pacote_dev.py
tests/unit/core.test.js tests/unit/jobs.test.js tests/unit/modules.test.js
tests/unit/instalacao-seguranca.test.js
modules/state.js modules/alerts/provider.js installer/lib/catalog.json scripts/build_windows.py scripts/verificar_windows.py
tests/integration/panel.test.js tests/integration/panel-browser.cjs tests/integration/module-state.test.js
tests/integration/installer.test.js tests/integration/tickets.test.js tests/integration/auditoria.test.js docs/historico/LICENCA_EDICAO_FONTES_1.0.0.md docs/OFERTA_WINDOWS.md docs/previas-crowforge/instalador.png docs/previas-crowforge/painel.png
""".split()
FILES += [f"modules/{mod}/index.js" for mod in
          json.loads((ROOT / "installer/lib/catalog.json").read_text(encoding="utf-8"))]
FILES += [f"docs/{doc}.md" for doc in
          ("AUDITORIA_CROWFORGE", "FAQ", "GUIA_TESTE_SERVIDOR", "MANUAL", "PERMISSOES_DISCORD", "SOLUCAO_DE_PROBLEMAS")]
FILES += [f"scripts/linux/{script}.sh" for script in
          ("01_verificar_ambiente", "02_configurar", "03_instalar", "04_iniciar")]
SECRET = re.compile(rb"(?:mfa\.[\w-]{32,}|[\w-]{23,30}\.[\w-]{5,8}\.[\w-]{25,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)")
ASSIGNMENT = re.compile(rb"(?im)^\s*(?:DISCORD_TOKEN|PANEL_SESSION_SECRET|TWITCH_CLIENT_SECRET|YOUTUBE_API_KEY)\s*=\s*['\"]?([A-Za-z0-9_./+-]{24,})")
def check(name, data):
    if SECRET.search(data) or ASSIGNMENT.search(data):
        raise ValueError(f"Possível segredo em {name}. Geração bloqueada.")

def build(target):
    entries = {}
    for name in FILES:
        path = ROOT / name
        if path.resolve() != path or not path.is_file():
            raise ValueError(f"Arquivo ausente ou redirecionado: {name}")
        entries[name] = path.read_bytes()
        check(name, entries[name])
    with ZipFile(target, "x", ZIP_DEFLATED) as package:
        for name, data in entries.items():
            package.writestr(name, data)
    with ZipFile(target) as package:
        assert set(package.namelist()) == set(entries) and package.testzip() is None
        for name in entries:
            check(name, package.read(name))
    print(f"{len(entries)} arquivos verificados.")

if __name__ == "__main__":
    build(Path(sys.argv[1]))


