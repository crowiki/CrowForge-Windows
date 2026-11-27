import React, {useEffect, useRef, useState} from 'react';
import catalog from '../../../installer/lib/catalog.json';
import './painel.css';

const PAGE_SIZE = 6;
const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const label = name => catalog[name]?.label || name;

function Metric({title, value, tone}) {
  return <div className={'metric '+tone}><dt>{title}</dt><dd>{value ?? 0}</dd></div>;
}

export default function App() {
  const [status,setStatus] = useState(null);
  const [guilds,setGuilds] = useState([]);
  const [selection,select] = useState('');
  const [search,setSearch] = useState('');
  const [page,setPage] = useState(0);
  const [pending,setPending] = useState(new Set());
  const inFlight=useRef(new Set());
  const revision=useRef(0);
  const [error,setError] = useState('');
  const [feedback,setFeedback] = useState('');
  useEffect(()=>{
    const controller = new AbortController();
    let timer;
    async function refresh() {
      const started=revision.current;
      try {
        const read = async route => {
          const response = await fetch('/api/'+route,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});
          if (!response.ok) throw Error();
          return response.json();
        };
        const [snapshot,servers] = await Promise.all([read('status'),read('guilds')]);
        if (controller.signal.aborted) return;
        if (started===revision.current) setStatus(snapshot);
        setGuilds(servers); setError('');
      } catch {
        if (!controller.signal.aborted) setError('Falha ao atualizar o painel. Tentando reconectar…');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh,5000);
      }
    }
    refresh();
    return ()=>{controller.abort();clearTimeout(timer);};
  },[]);

  const guildId = guilds.some(g=>g.guild_id===selection) ? selection : guilds[0]?.guild_id;
  const modules = (status?.modules || []).filter(m=>m.guild_id===guildId && Object.hasOwn(catalog,m.module_name));
  const filtered = modules.filter(m=>normalize(label(m.module_name)).includes(normalize(search.trim())))
    .sort((a,b)=>label(a.module_name).localeCompare(label(b.module_name),'pt-BR'));
  const pages = Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const current = Math.min(page,pages-1);
  const online = status?.bot?.status==='running';
  const uptime = status?.bot?.uptime ?? 0;

  async function toggle(mod) {
    const key=mod.guild_id+'/'+mod.module_name;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setPending(new Set(inFlight.current)); setFeedback('');
    try {
      const url = '/api/modules/'+mod.guild_id+'/'+mod.module_name+'/toggle';
      const response = await fetch(url,{method:'PUT',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!mod.enabled})});
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Falha ao alterar o módulo.');
      revision.current++;
      if (result.warning) setFeedback(result.warning);
      setStatus(prev=>({...prev,modules:prev.modules.map(m=>m.guild_id===mod.guild_id && m.module_name===mod.module_name ? {...m,enabled:Number(result.enabled)} : m)}));
    } catch(e) {
      const message=e.name==='TimeoutError'?'O Discord demorou a responder. O painel vai conferir o estado automaticamente.':e.message;
      setFeedback(label(mod.module_name)+' — '+message);
    } finally {
      inFlight.current.delete(key);
      setPending(new Set(inFlight.current));
    }
  }
  async function manageBot() {
    try {
      const response=await fetch('/api/bot/gerenciar',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const result=await response.json();
      setFeedback(response.ok?'Gerenciamento aberto no aplicativo CrowForge.':result.error);
    } catch {setFeedback('Abra o CrowForge pelo ícone perto do relógio para gerenciar o bot.');}
  }
  return <>
    <header><div className="bar"><div className="brand"><img src="/crowforge.svg" alt=""/><b>Crow<span>Forge</span></b></div><button className="manage-bot" onClick={manageBot}>Gerenciar bot</button></div></header>
    <main>
      {error && <p role="alert">{error}</p>}
      {!status ? <p role="status">Carregando painel…</p> : <>
        <section className="overview" aria-labelledby="overviewTitle">
          <div className="hero"><div><h1 id="overviewTitle">Visão geral</h1>
            <div className="connection"><span className={'dot '+(online?'online':'')}/>{online?'Bot online':status.bot?.status==='connecting'?'Conectando ao Discord…':'Bot offline'}{online && <span> · Em execução há {Math.floor(uptime/3600)}h {Math.floor(uptime%3600/60)}min</span>}</div>
          </div><img className="emblem" src="/crowforge.svg" alt=""/></div>
          <dl className="metrics"><Metric title="Servidores" value={status.guilds} tone="violet"/><Metric title="Tickets Abertos" value={status.tickets?.open_count} tone="cyan"/><Metric title="Tickets fechados" value={status.tickets?.closed_count} tone="silver"/><Metric title="Casos de moderação" value={status.moderation?.total} tone="amber"/></dl>
        </section>
        <section className="manager" aria-labelledby="modulesTitle">
          <div className="tools"><div><h2 id="modulesTitle">Módulos</h2><p>{modules.filter(m=>m.enabled).length} de {modules.length} ativos</p></div>
            {guilds.length>0 && <label>Servidor<select value={guildId} onChange={e=>{select(e.target.value);setPage(0);setSearch('');setFeedback('');}}>{guilds.map(g=><option key={g.guild_id} value={g.guild_id}>{g.name || g.guild_id}</option>)}</select></label>}
            <label>Buscar módulo<input type="search" value={search} placeholder="Nome do módulo" onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label>
          </div>
          {status.missingGuild && <p role="alert">O bot perdeu acesso ao servidor configurado. Abra Gerenciar bot para convidá-lo novamente ou trocar de bot.</p>}
          {!online && <p role="status">Aguardando o bot. Os controles serão liberados automaticamente quando ele estiver conectado.</p>}
          {feedback && <p role="alert">{feedback}</p>}
          <div className="grid">{filtered.slice(current*PAGE_SIZE,(current+1)*PAGE_SIZE).map(mod=><div className="module" key={mod.guild_id+mod.module_name}>
            <div><strong>{label(mod.module_name)}</strong><small>{pending.has(mod.guild_id+'/'+mod.module_name)?'Sincronizando…':mod.enabled?'Ativado':'Desativado'}</small></div>
            <button className="switch" role="switch" aria-checked={!!mod.enabled} aria-label={label(mod.module_name)} disabled={!online || status.missingGuild || pending.has(mod.guild_id+'/'+mod.module_name)} onClick={()=>toggle(mod)}/>
          </div>)}</div>
          {!filtered.length && <p className="empty">{modules.length?'Nenhum módulo corresponde à busca.':'Nenhum módulo configurado para este servidor.'}</p>}
          {pages>1 && <nav aria-label="Paginação dos módulos"><span>Página {current+1} de {pages}</span><button aria-label="Página anterior" disabled={!current} onClick={()=>setPage(current-1)}>←</button><button aria-label="Próxima página" disabled={current===pages-1} onClick={()=>setPage(current+1)}>→</button></nav>}
        </section>
      </>}
    </main></>;
}
