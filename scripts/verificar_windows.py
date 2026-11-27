"""Extrai o payload NSIS e testa o runtime em um perfil temporário, sem Node no PATH."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from pacote_dev import ROOT, check

def verify(setup):
    ziptool = shutil.which("7z.exe") or ROOT / "installer/node_modules/electron-winstaller/vendor/7z.exe"
    def extract(src,dest):
        subprocess.run([str(ziptool),"x",str(src),"-o"+str(dest),"-y"],stdout=subprocess.DEVNULL,check=True)
    with tempfile.TemporaryDirectory(prefix="CrowForge teste á ") as temp:
        work = Path(temp)
        extract(setup,work/"aplicativo")
        if not (work/"aplicativo/CrowForge.exe").exists():
            payload, = (work/"aplicativo").rglob("app-64.7z")
            extract(payload,work/"aplicativo")
        runtime = work/"aplicativo/resources/runtime"
        if (runtime / "package.json").is_file() and json.loads((runtime / "package.json").read_text(encoding="utf-8"))["version"] == "1.1.0":
            docs = runtime.parent / "documentacao"
            for name, source in (("Licenca.txt", ROOT / "LICENCA.md"), ("Guia do comprador.txt", ROOT / "docs/MANUAL.md")):
                if (docs / name).read_text(encoding="utf-8-sig") != source.read_text(encoding="utf-8"):
                    raise ValueError("Documento comercial divergente: " + name)
            for library in ("react", "react-dom", "scheduler"):
                if not (docs / ("LICENSE-" + library + ".txt")).is_file():
                    raise ValueError("Aviso de terceiros ausente: " + library)
        profile = work/"perfil"
        profile.mkdir()
        for p in (work/"aplicativo").rglob("*"):
            if p.name in {".env",".installer-state.json","panel-auth.json","crowbot.db"} or p.name.endswith((".db",".tmp")):
                raise ValueError("Estado local no pacote: "+p.name)
        for folder in ("apps","modules","packages","installer"):
            for p in (runtime/folder).rglob("*"):
                if p.is_file(): check(str(p.relative_to(runtime)),p.read_bytes())
        env = dict(os.environ,PATH=str(Path(os.environ["SystemRoot"])/"System32"), APPDATA=str(profile),LOCALAPPDATA=str(profile),CROWFORGE_DATA_DIR=str(profile))
        code = """
        (async()=>{
          const {createRequire}=require('node:module');
          const r=createRequire(require('node:path').join(process.argv[1],'package.json'));
          const db=r('./packages/db');await db.initDatabase('./data/teste.db');
          const app=await r('./apps/local-api').buildServer();
          if((await app.inject('/')).statusCode!==200 || (await app.inject('/api/status')).statusCode!==200)throw Error('painel');
          const state=r('./modules/state');
          require('node:assert/strict').deepEqual([...state.names].sort(),Object.keys(r('./installer/lib/catalog.json')).sort());
          if(!state.names.includes('setup') || state.commands([]).length!==0 || state.commands(['giveaways']).length!==1) throw Error('módulos');
          await app.close();db.closeDatabase();
        })().catch(e=>{console.error(e);process.exitCode=1});
        """
        subprocess.run([str(runtime/"node.exe"),"-e",code,str(runtime)],cwd=profile,env=env,check=True)
        exe=work/"aplicativo/CrowForge.exe"
        # DevToolsActivePort é criado por Chromium apenas quando a janela está em execução.
        chromium=work/"chromium"
        env.pop("ELECTRON_RUN_AS_NODE",None)
        proc=subprocess.Popen([str(exe),"--remote-debugging-port=0","--remote-debugging-address=127.0.0.1","--user-data-dir="+str(chromium),"--disable-gpu"],cwd=profile,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(150):
                if proc.poll() is not None: raise RuntimeError("Aplicativo encerrou durante o início.")
                if (chromium/"DevToolsActivePort").exists():break
                time.sleep(.1)
            port=(chromium/"DevToolsActivePort").read_text().splitlines()[0]
            browser_test="""
            (async()=>{
              const port=process.argv[1];
              let page;
              for(let i=0;i<80;i++){
                const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
                page=tabs.find(t=>t.type==='page' && t.url.includes('/renderer/index.html'));
                if(page)break;await new Promise(r=>setTimeout(r,125));
              }
              if(!page)throw Error('Janela do instalador ausente.');
              const ws=new WebSocket(page.webSocketDebuggerUrl);
              await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
              const expression="(async()=>{const env=await window.crowbot.checkEnvironment(); const state=await window.crowbot.getInstallationState(); return !document.querySelector('#panelPassword') && env.nodejs.valid && env.npm.installed && env.writePermission && env.projectExists && !state.installed && !!document.querySelector('#btnToStep2')})()";
              const answer=new Promise((r,j)=>{ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1)r(m.result?.result?.value);};ws.onerror=j;});
              ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
              if(!await answer)throw Error('Ponte do instalador ou runtime indisponível.');
              ws.send(JSON.stringify({id:2,method:'Runtime.evaluate',params:{expression:'window.close()'}}));
              ws.close();
            })().catch(e=>{console.error(e);process.exitCode=1});
            """
            subprocess.run([str(runtime/"node.exe"),"-e",browser_test,port],env=env,cwd=profile,check=True,timeout=35)
        finally:
            try:proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.terminate();proc.wait()
            time.sleep(.8)
    print("Payload NSIS, janela Electron, dependências, SQLite, catálogo de módulos e painel verificados.")
    print("SHA-256",hashlib.file_digest(setup.open("rb"),"sha256").hexdigest())

if __name__=="__main__":
    verify(Path(sys.argv[1]).resolve())
