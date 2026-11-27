"""Compila o dashboard e gera um instalador NSIS para o usuário atual."""
import json
import os
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from pacote_dev import ROOT, FILES, check

def run(command, cwd):
    subprocess.run(command, cwd=cwd, check=True)

def build():
    npm = shutil.which("npm.cmd")
    node = Path(shutil.which("node.exe"))
    installer = ROOT / "installer"
    run([npm, "test"], ROOT)
    run([npm, "run", "test:integration"], ROOT)
    run([npm, "run", "build"], ROOT / "apps/dashboard")
    electron = installer / "node_modules/electron/dist/electron.exe"
    env = dict(os.environ)
    env.pop("ELECTRON_RUN_AS_NODE", None)
    subprocess.run([str(electron), str(ROOT / "tests/integration/panel-browser.cjs")], cwd=ROOT, env=env, check=True, timeout=90)
    with tempfile.TemporaryDirectory(prefix="crowforge-runtime-") as stage:
        runtime = Path(stage) / "runtime"
        runtime.mkdir()
        files = [name for name in FILES if name.startswith(("packages/", "modules/", "apps/bot/", "apps/local-api/"))]
        files += ["installer/lib/catalog.json","installer/lib/gateway-intents.js", "package.json", "package-lock.json"]
        files += [str(p.relative_to(ROOT)) for p in (ROOT / "apps/dashboard/dist").rglob("*") if p.is_file()]
        for name in set(files):
            src = ROOT / name
            check(name, src.read_bytes())
            dest = runtime / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
        shutil.copy2(node, runtime / "node.exe")
        license_file = node.parent / "LICENSE"
        if license_file.exists():
            shutil.copy2(license_file,runtime / "NODE-LICENSE.txt")
        else:
            version = subprocess.check_output([str(node), "--version"], text=True).strip()
            url = f"https://raw.githubusercontent.com/nodejs/node/{version}/LICENSE"
            with urllib.request.urlopen(url, timeout=40) as response:
                license_data = response.read()
            if b"Permission is hereby granted" not in license_data:
                raise ValueError("Licença do Node não reconhecida.")
            (runtime / "NODE-LICENSE.txt").write_bytes(license_data)
        run([npm, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], runtime)
        run([str(runtime / "node.exe"), "-e", "require('./modules').getAllCommands(); require('./apps/local-api')"], runtime)
        config = json.loads((installer / "package.json").read_text(encoding="utf-8"))["build"]
        config["extraResources"] = [
            {"from":str(runtime),"to":"runtime","filter":["**/*","!node_modules/**"]},
            {"from":str(runtime / "node_modules"),"to":"runtime/node_modules","filter":["**/*"]}
        ]
        docs = Path(stage) / "documentacao"
        docs.mkdir()
        agreement = (ROOT / "LICENCA.md").read_text(encoding="utf-8")
        (docs / "Licenca.txt").write_text(agreement, encoding="utf-8-sig")
        (docs / "Guia do comprador.txt").write_text((ROOT / "docs/MANUAL.md").read_text(encoding="utf-8"), encoding="utf-8-sig")
        for library in ("react", "react-dom", "scheduler"):
            shutil.copyfile(ROOT / "apps/dashboard/node_modules" / library / "LICENSE", docs / ("LICENSE-" + library + ".txt"))
        # NSIS lê a licença Unicode com BOM. A versão instalada tem o mesmo texto.
        nsis_license = Path(stage) / "licenca-instalador.txt"
        nsis_license.write_text(agreement, encoding="utf-16")
        config["nsis"]["license"] = str(nsis_license)
        config["nsis"]["installerLanguages"] = ["pt_BR"]
        config["extraResources"].append({"from": str(docs), "to": "documentacao"})
        config["electronDist"] = str(installer / "node_modules/electron/dist")
        config["npmRebuild"] = False
        config["directories"] = {"output":str(ROOT.parent / "builds" / ("Windows-" + json.loads((installer / "package.json").read_text())["version"]))}
        output = Path(config["directories"]["output"])
        before = {p: p.stat().st_mtime_ns for p in output.glob("*.exe")}
        cfg = Path(stage) / "builder.json"
        cfg.write_text(json.dumps(config),encoding="utf-8")
        run([str(node),str(installer / "node_modules/electron-builder/cli.js"),"--win","nsis","--x64","--config",str(cfg),"--publish","never"], installer)

        installers = [p for p in output.glob("*.exe") if before.get(p) != p.stat().st_mtime_ns]
        if len(installers) != 1:
            raise ValueError("Esperado exatamente um instalador novo.")
        from verificar_windows import verify
        verify(installers[0])

if __name__ == "__main__":
    build()
