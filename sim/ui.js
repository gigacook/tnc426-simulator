/* ============================================================
   TNC 426 / 430 SIMULATOR — UI
   Loads after: THREE, OrbitControls, core.js, sim.js, programs.js,
   lessons.js, and when present: tools3d.js, callouts.js, flow.js,
   fx.js, m430/*, ai.js, JSZip.  Optional modules degrade gracefully.
   ============================================================ */
(function(){
'use strict';

/* ================= basics ================= */
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const REDUCED=matchMedia('(prefers-reduced-motion: reduce)').matches;

const toastEl=$('toast');
function say(msg){ toastEl.textContent=msg; toastEl.classList.add('on');
  clearTimeout(say._t); say._t=setTimeout(()=>toastEl.classList.remove('on'),1900); }

/* prose from lessons: **bold**, `code`, blank-line paragraphs, "- " bullets */
function md(text){
  const inl=s=>esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  return String(text||'').trim().split(/\n\s*\n/).map(par=>{
    const out=[]; let ul=[];
    par.split('\n').forEach(l=>{
      if(/^\s*- /.test(l)) ul.push('<li>'+inl(l.replace(/^\s*- /,''))+'</li>');
      else { if(ul.length){ out.push('<ul>'+ul.join('')+'</ul>'); ul=[]; } if(l.trim()) out.push('<p>'+inl(l)+'</p>'); }
    });
    if(ul.length) out.push('<ul>'+ul.join('')+'</ul>');
    return out.join('');
  }).join('');
}

/* Every download goes to TNC-SIMULATOR/<AI-GEN|USER-GEN|SETTINGS|TOOL-TABLES>/. Browsers that can write
   into a folder (Chrome, Edge) do it after the Downloads folder is picked once; others (Firefox) get the
   folder as a name prefix: TNC-SIMULATOR_AI-GEN_PART.H */
const DL_ROOT='TNC-SIMULATOR'; let dlDir=null;
async function dlDirGet(ask){
  if(dlDir) return dlDir;
  try{ const h=window.idbKeyval&&await idbKeyval.get('tnc.dldir'); if(h){ let st=await h.queryPermission({mode:'readwrite'}); if(st!=='granted'&&ask) st=await h.requestPermission({mode:'readwrite'}); if(st==='granted') dlDir=h; } }catch(e){}
  return dlDir;
}
async function pickDlDir(){
  if(!window.showDirectoryPicker){ say('THIS BROWSER CANNOT WRITE INTO A FOLDER — FILES GO TO DOWNLOADS NAMED '+DL_ROOT+'_…'); return false; }
  try{ dlDir=await showDirectoryPicker({id:'tnc-downloads',mode:'readwrite',startIn:'downloads'}); if(window.idbKeyval) await idbKeyval.set('tnc.dldir',dlDir); say('SAVING INTO '+dlDir.name+'/'+DL_ROOT); return true; }catch(e){ return false; }
}
function download(name, blob, kind){
  kind=kind||'USER-GEN';
  (async()=>{ const d=await dlDirGet(true);
    if(d){ try{ const root=await d.getDirectoryHandle(DL_ROOT,{create:true}), sub=await root.getDirectoryHandle(kind,{create:true});
      const fh=await sub.getFileHandle(name,{create:true}), w=await fh.createWritable(); await w.write(blob); await w.close(); say('SAVED '+DL_ROOT+'/'+kind+'/'+name); return; }catch(e){} }
    dlPlain(DL_ROOT+'_'+kind+'_'+name, blob); })();
}
function dlPlain(name, blob){
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}

/* ================= storage: programs & projects in localStorage, prefs in a cookie ================= */
const LS_KEY='tnc426.v1', KEY_LS='tnc426.orkey', MODEL_LS='tnc426.ormodel', BOOT_SS='tnc426.boot';
const local={ get:k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } },
              set:(k,v)=>{ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } },
              del:k=>{ try{ localStorage.removeItem(k); }catch(e){} } };
const sess ={ get:k=>{ try{ return sessionStorage.getItem(k); }catch(e){ return null; } },
              set:(k,v)=>{ try{ sessionStorage.setItem(k,v); }catch(e){} },
              del:k=>{ try{ sessionStorage.removeItem(k); }catch(e){} } };

const PREF='tnc426_prefs';
function readPrefs(){
  try{ const m=document.cookie.match(/(?:^|;\s*)tnc426_prefs=([^;]*)/); return m?JSON.parse(decodeURIComponent(m[1])):{}; }
  catch(e){ return {}; }
}
function writePrefs(){
  try{
    const v=encodeURIComponent(JSON.stringify({speed:S.speed, ovr:S.ovr, view:S.view, mode:S.mode, fx:S.fx,
      cool:S.fxCool, fire:S.fxFire, labels:S.labels, vice:S.vice, sound:S.sound, machine:S.machine, flow:S.flowView, focus:S.focusView, side:S.sideTab, ref:S.ref}));
    const path=location.pathname.replace(/[^/]*$/,'')||'/';
    document.cookie=`${PREF}=${v}; Max-Age=31536000; Path=${path}; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;
  }catch(e){}
  if(PROF) persist();
}
const prefsNow=()=>({speed:S.speed, ovr:S.ovr, view:S.view, mode:S.mode, fx:S.fx, cool:S.fxCool, fire:S.fxFire, labels:S.labels, vice:S.vice, sound:S.sound, machine:S.machine, flow:S.flowView, focus:S.focusView, side:S.sideTab, ref:S.ref});

/* ================= machines ================= */
const MACHINES={
  '426':{ id:'426', label:'TNC 426', axes:['X','Y','Z'], tools:TNC.TOOLS,
    run:t=>TNC.run(t,{tools:mtools('426'),holder:holderOpt('426')}), expand:r=>TNC_SIM.expand(r),
    analyse:(r,ex)=>TNC_SIM.analyse(r,ex,TNC_SIM.grid(r.stock,ex.segs)),
    programs:window.TNC_PROGRAMS||{}, lessons:window.TNC_LESSONS||null }
};
/* TNC 430: the operator's machine parameters live in machines.js (shared with the server's engine). */
const MACHINE_430=(window.TNC_MACHINE_CONFIGS||{})['430']||{};
MACHINES['430']={ id:'430', label:'TNC 430', axes:['X','Y','Z','B','A'], tools:TNC.TOOLS, machine:MACHINE_430,
  run:t=>TNC.run(t,{tools:mtools('430'),machine:MACHINE_430,holder:holderOpt('430')}), expand:r=>TNC_SIM.expand(r),
  analyse:(r,ex)=>TNC_SIM.analyse(r,ex,TNC_SIM.grid(r.stock,ex.segs)),
  programs:window.TNC_PROGRAMS||{}, lessons:window.TNC_LESSONS||null };
Object.keys(window.TNC_MACHINES||{}).forEach(k=>{ MACHINES[k]=window.TNC_MACHINES[k]; });
const M=()=>MACHINES[S.machine];

/* ================= state ================= */
const P=readPrefs();
const S={
  machine: MACHINES[P.machine]?P.machine:'426',
  pgms:{}, orig:{}, cur:{}, tools:{}, meta:{}, mset:{}, projects:[], active:null, pgm:null, text:'',
  res:null, ex:{segs:[],total:0}, segs:[], total:0, events:[], evIdx:0,
  t:0, stampT:0, running:false,
  speed:[1,4,16,64,0].includes(P.speed)?P.speed:4, ovr:clamp(+P.ovr||100,0,150),
  mode:['edit','test','single','full'].includes(P.mode)?P.mode:'test',
  view:['3D','TOP','FRONT','SIDE'].includes(P.view)?P.view:'3D',
  cursor:0, editing:false, raw:false, mgt:false, mgtSel:0, flowView:!!P.flow,
  fx:P.fx!==undefined?!!P.fx:!REDUCED, fxCool:P.cool!==undefined?!!P.cool:true, fxFire:!!P.fire,
  labels:P.labels!==undefined?!!P.labels:true, vice:P.vice!==undefined?!!P.vice:true, sound:P.sound!==undefined?!!P.sound:true,
  ref:null, pos:null, seg:null, shake:0, lesson:null, focus:null, focusView:!!P.focus, sideTab:P.side||'diag', ref:P.ref||'keys', pickPath:null, execB:-1, wiz:null, pick:null, tt:false
};
const TEMP='LESSON.H';
const pg=()=>S.pgms[S.machine]||(S.pgms[S.machine]={});

/* ---------- the operator profile (profile.js): IndexedDB, autosaved, exported by hand ---------- */
const PSTORE=window.TNC_PROFILE||{ load:()=>Promise.resolve(null), save:()=>Promise.resolve(false), wipe:()=>Promise.resolve(),
  blank:n=>({v:2,name:n||'',created:new Date().toISOString(),prefs:{},machines:{},projects:[],active:null}), legacy:()=>null };
let PROF=null;
/* the machine's tool table: built-ins, overridden / extended by the operator's own TOOL.T */
/* TOOL HOLDER LENGTH: the gauge length used for every tool with L = 0 (length measured on the machine) */
const mset=id=>(S.mset[id||S.machine]=S.mset[id||S.machine]||{holderLen:150,holderType:'ISO50'});
function holderOpt(id){ const m=mset(id); if(window.TNC_TOOLS3D&&TNC_TOOLS3D.setHolder) TNC_TOOLS3D.setHolder(m.holderType);
  return { stack:r=>window.TNC_TOOLS3D&&TNC_TOOLS3D.holderStack?TNC_TOOLS3D.holderStack(r):(m.holderType==='SK40'?70:100) }; }
function mtools(id){ id=id||S.machine; const base=(MACHINES[id]&&MACHINES[id].tools)||[], mine=S.tools[id]||[];
  const by={}; base.forEach(t=>by[t.t]=Object.assign({},t)); mine.forEach(t=>by[t.t]=Object.assign({},t,{mine:true}));
  return Object.values(by).sort((a,b)=>a.t-b.t); }

function loadStore(){
  const j=PROF||PSTORE.blank('');
  for(const id in MACHINES){
    const mm=(j.machines&&j.machines[id])||{};
    S.orig[id]=Object.assign({}, MACHINES[id].programs||{});
    S.pgms[id]=Object.assign({}, S.orig[id], mm.pgms||{});
    S.tools[id]=Array.isArray(mm.tools)?mm.tools:[];
    S.cur[id]=mm.cur||null;
    S.meta[id]=mm.meta||{};
    S.mset[id]=Object.assign({holderLen:150,holderType:'ISO50'},mm.settings||{});
  }
  S.projects=Array.isArray(j.projects)?j.projects:[];
  S.active=S.projects.some(p=>p.id===j.active)?j.active:((S.projects[0]||{}).id||null);
  const last=S.cur[S.machine];
  S.pgm=(last&&pg()[last]!=null)?last:(Object.keys(pg())[0]||null);
  if(!S.pgm){ S.pgm='NEW.H'; pg()[S.pgm]='BEGIN PGM NEW MM\nEND PGM NEW MM'; }
  S.text=pg()[S.pgm];
}
function profileNow(){
  if(S.pgm!==TEMP) S.cur[S.machine]=S.pgm;
  const machines={};
  for(const id in S.pgms){ const pg_={};          // only what differs from the built-ins, so fixes to them still arrive
    for(const n in S.pgms[id]) if(n!==TEMP && S.pgms[id][n]!==S.orig[id][n]) pg_[n]=S.pgms[id][n];
    machines[id]={pgms:pg_, cur:S.cur[id]||null, tools:S.tools[id]||[], meta:S.meta[id]||{}, settings:S.mset[id]||{}}; }
  return Object.assign({}, PROF||PSTORE.blank(''), {v:2, machines, projects:S.projects, active:S.active, prefs:prefsNow()});
}
let persistT=0;
function persist(){
  if(!PROF) return;
  clearTimeout(persistT);
  persistT=setTimeout(()=>{ PROF=profileNow(); PSTORE.save(PROF).then(r=>{ profChip(r); }); renderUserPrograms(); },300);
}

/* ================= undo / redo (per program) ================= */
const UNDO={}, REDO={};
const ukey=()=>S.machine+':'+S.pgm;
function snapshot(){ const k=ukey(); (UNDO[k]=UNDO[k]||[]).push({text:S.text,cursor:S.cursor});
  if(UNDO[k].length>200) UNDO[k].shift(); REDO[k]=[]; }
function setText(t){ S.text=t; pg()[S.pgm]=t; raw.value=t; touchMeta(S.pgm); compile(); persist(); emit('text',{name:S.pgm,machine:S.machine,text:t}); }
function touchMeta(n,created){ if(!n||n===TEMP) return; const mm=(S.meta[S.machine]=S.meta[S.machine]||{}), now=new Date().toISOString();
  const e=mm[n]||(mm[n]={c:now,m:now,v:0}); if(created){ e.c=now; e.v=0; } e.m=now; e.v++; }
function edit(t, cur, msg){
  if(t===S.text) return;
  snapshot(); setText(t);
  S.cursor=clamp(cur==null?S.cursor:cur,0,Math.max(0,S.res.blocks.length-1)); markRows(true);
  if(msg) say(msg);
}
function undo(){ const k=ukey(), u=UNDO[k];
  if(!u||!u.length){ say('NOTHING TO UNDO'); return; }
  (REDO[k]=REDO[k]||[]).push({text:S.text,cursor:S.cursor});
  const s=u.pop(); setText(s.text); S.cursor=clamp(s.cursor,0,S.res.blocks.length-1); markRows(true);
  say('UNDO · '+u.length+' LEFT'); }
function redo(){ const k=ukey(), r=REDO[k];
  if(!r||!r.length){ say('NOTHING TO REDO'); return; }
  (UNDO[k]=UNDO[k]||[]).push({text:S.text,cursor:S.cursor});
  const s=r.pop(); setText(s.text); S.cursor=clamp(s.cursor,0,S.res.blocks.length-1); markRows(true);
  say('REDO · '+r.length+' LEFT'); }

/* ================= compile ================= */
const DEFAULT_STOCK={x0:0,y0:0,z0:-20,x1:100,y1:80,z1:0};
function compile(){
  const m=M(); let res;
  try{ res=m.run(S.text); }
  catch(e){ res={blocks:[],moves:[],stock:null,stats:{},errors:[{block:0,msg:'INTERNAL: '+e.message}]}; }
  const st=res.stock;
  if(!st||!(st.x1>st.x0)||!(st.y1>st.y0)||!(st.z1>st.z0)) res.stock=Object.assign({},DEFAULT_STOCK);
  S.res=res;
  try{ S.ex=m.expand(res); }catch(e){ S.ex={segs:[],total:0}; }
  S.segs=S.ex.segs; S.total=S.ex.total;
  try{ S.events=(m.analyse(res,S.ex)||[]).slice().sort((a,b)=>a.t-b.t); }catch(e){ S.events=[]; }
  S.evIdx=0; S.t=0; S.stampT=0; S.running=false; S.execB=-1; S.k=0; hideAlarm();
  S.cursor=clamp(S.cursor,0,Math.max(0,res.blocks.length-1));
  buildScene(); if(FXO) FXO.clear();
  $('pgm-path').textContent='TNC:\\'+S.pgm;
  renderList(); renderChecks(); renderKV(); renderCompare(); if(S.mgt) renderMgt(); flowUpdate(); traceFor(S.cursor);
  scrub.value=0; setState(S.mode==='edit'?'EDITING':'READY');
}
const nOf=i=>{ const b=S.res&&S.res.blocks[i]; return b&&b.n!=null?b.n:'--'; };

/* ================= three.js scene ================= */
const canvas=$('gl'), gfxEl=$('gfx');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x04070d);
const camera=new THREE.PerspectiveCamera(40,1,1,6000); camera.up.set(0,0,1);
const controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.dampingFactor=.09;
const LK=(+THREE.REVISION>=155)?Math.PI:1;       // r155+: physical light units; x PI keeps the r128 brightness
scene.add(new THREE.HemisphereLight(0x9fc4ff,0x0a0f18,.6*LK));
const keyL=new THREE.DirectionalLight(0xffffff,1.35*LK); keyL.position.set(180,-140,260); scene.add(keyL);
const fillL=new THREE.DirectionalLight(0x6fa8ff,.5*LK); fillL.position.set(-200,160,120); scene.add(fillL);

/* ================= plugin bus: optional modules (materials.js, look.js, …) wire in here, never by editing ui.js =================
   A plugin does:  (window.TNC_UI_PLUGINS=window.TNC_UI_PLUGINS||[]).push(ui=>{ ui.on('scene',…) });
   Events: scene {partRoot,stock,gStock,gSkirt,gFloor,rig} · tool {t,entry,group,cutter,holder} · tick dt,{running,cutting,pos,seg}
           crash ev · resize {w,h} · program {name,machine}.   ui.render=(scene,camera)=>… replaces the default render call. */
const BUS={};
const emit=(ev,...a)=>{ (BUS[ev]||[]).forEach(fn=>{ try{ fn(...a); }catch(e){ console.warn('plugin '+ev,e); } }); };
const UIAPI={ THREE, scene, camera, renderer, controls, lights:{key:keyL,fill:fillL},
  on:(ev,fn)=>{ (BUS[ev]=BUS[ev]||[]).push(fn); }, render:null,
  get state(){ return S; }, surfaceAt:(x,y)=>surfaceAt(x,y), say:m=>say(m),
  get program(){ return {name:S.pgm, machine:S.machine, text:S.text}; },
  open:(name,text,o)=>openExternal(name,text,o||{}) };
window.TNC_UI=UIAPI;

let world=null, partRoot=null, toolRoot=null, rig=null, stockH=null;
let gStock=null, gSkirt=null, gFloor=null, gPath=null, gTool=null, toolCutter=null, toolHolder=null, curToolT=null;
let HM=null, NX=0, NY=0, DX=0, DY=0, ST=null, hmDirty=false, CO=null;

function disposeTree(o){ if(!o) return; o.parent&&o.parent.remove(o);
  o.traverse(c=>{ c.geometry&&c.geometry.dispose();
    const ms=Array.isArray(c.material)?c.material:(c.material?[c.material]:[]); ms.forEach(m=>{ m.map&&m.map.dispose(); m.dispose(); }); }); }

function buildScene(){
  if(CO){ CO.dispose(); CO=null; }
  if(stockH){ try{ stockH.dispose(); }catch(e){} stockH=null; }
  disposeTree(world); rig=null; gTool=null; curToolT=null;
  world=new THREE.Group(); scene.add(world);
  const m=M(); ST=S.res.stock;
  const w=ST.x1-ST.x0, h=ST.y1-ST.y0;

  if(m.kinematics && m.stock){                       // 5-axis profile: machine rig + its own material model
    rig=m.kinematics.build(THREE); world.add(rig.group);
    partRoot=rig.partMount; toolRoot=rig.toolMount;
    stockH=m.stock.create(THREE,S.res); partRoot.add(stockH.mesh);
  } else {                                           // 3-axis: part fixed, height field
    partRoot=new THREE.Group(); toolRoot=new THREE.Group(); world.add(partRoot); world.add(toolRoot);
    buildHeightField();
    const grid=new THREE.GridHelper(Math.max(w,h)*2,20,0x1d3752,0x122437);
    grid.rotation.x=Math.PI/2; grid.position.set((ST.x0+ST.x1)/2,(ST.y0+ST.y1)/2,ST.z0-0.3); partRoot.add(grid);
  }
  /* datum axes at the blank's min corner, top face */
  const L=Math.max(w,h)*0.22, ax=new THREE.Group();
  [[[L,0,0],0xff6b5e],[[0,L,0],0x7ddc7d],[[0,0,L],0x6fa8ff]].forEach(([v,c])=>{
    ax.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(...v)]),
      new THREE.LineBasicMaterial({color:c}))); });
  ax.position.set(ST.x0,ST.y0,ST.z1+.2); partRoot.add(ax);

  /* toolpath, revealed progressively with drawRange */
  const n=S.segs.length, pp=new Float32Array(n*6), pc=new Float32Array(n*6);
  const CA=new THREE.Color(0xffb03a), CF=new THREE.Color(0x6fdcff);
  S.segs.forEach((s,i)=>{ pp.set([s.a.x,s.a.y,s.a.z,s.b.x,s.b.y,s.b.z],i*6);
    const c=s.kind==='rapid'?CA:CF; pc.set([c.r,c.g,c.b,c.r,c.g,c.b],i*6); });
  const pg_=new THREE.BufferGeometry();
  pg_.setAttribute('position',new THREE.BufferAttribute(pp,3)); pg_.setAttribute('color',new THREE.BufferAttribute(pc,3));
  pg_.setDrawRange(0,0);
  gPath=new THREE.LineSegments(pg_,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.8}));
  partRoot.add(gPath);

  buildTrace();
  setTool(firstTool());
  if(window.TNC_CALLOUTS){
    try{ CO=TNC_CALLOUTS.create(THREE,scene,camera,renderer); calloutsFor(); CO.setVisible(S.labels); }catch(e){ CO=null; }
  }
  fitView();
  emit('scene',{partRoot,stock:ST,gStock,gSkirt,gFloor,rig});
}
function firstTool(){ const s=S.segs.find(s=>s.tool); return s?s.tool:0; }
function toolEntry(t){ return mtools().find(x=>x.t===t)||null; }

/* ---------- tool: real geometry from tools3d.js when available ---------- */
function setTool(t){
  if(t===curToolT && gTool) return;
  if(gTool){ if(window.TNC_TOOLS3D&&TNC_TOOLS3D.dispose) TNC_TOOLS3D.dispose(gTool); disposeTree(gTool); }
  if(window.TNC_TOOLS3D&&TNC_TOOLS3D.setHolder) TNC_TOOLS3D.setHolder(mset().holderType);
  const A=window.TNC_TOOLS3D&&TNC_TOOLS3D.holderStack?TNC_TOOLS3D.holderStack():100;
  curToolT=t; const e0=toolEntry(t), e=e0&&!(e0.l>0)?Object.assign({},e0,{l:A+Math.max(30,e0.r*7)}):e0;   // L=0: holder A + a typical stick-out, drawn only
  if(window.TNC_TOOLS3D&&TNC_TOOLS3D.setHolder) TNC_TOOLS3D.setHolder(mset().holderType);
  if(window.TNC_TOOLS3D){
    try{ const b=TNC_TOOLS3D.build(THREE,e); gTool=b.group; toolCutter=b.cutter; toolHolder=b.holder; }
    catch(err){ gTool=null; }
  }
  if(!gTool){                                        // fallback: plain cutter + collet
    gTool=new THREE.Group(); const r=e?e.r:3, cone=TNC_SIM.isCone(t);
    const mat=new THREE.MeshStandardMaterial({color:0xd8dee8,metalness:.9,roughness:.22});
    toolCutter=new THREE.Group();
    if(cone){ const c=new THREE.Mesh(new THREE.ConeGeometry(r,r,24),new THREE.MeshStandardMaterial({color:0xc9a54a,metalness:.8,roughness:.3}));
      c.rotation.x=-Math.PI/2; c.position.z=r/2; toolCutter.add(c);
      const sh=new THREE.Mesh(new THREE.CylinderGeometry(r*.6,r*.6,30,20),mat); sh.rotation.x=Math.PI/2; sh.position.z=r+15; toolCutter.add(sh); }
    else { const c=new THREE.Mesh(new THREE.CylinderGeometry(r,r,Math.max(12,r*3),20),new THREE.MeshStandardMaterial({color:0x2f3742,metalness:.75,roughness:.4}));
      c.rotation.x=Math.PI/2; c.position.z=Math.max(12,r*3)/2; toolCutter.add(c);
      const sh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,30,20),mat); sh.rotation.x=Math.PI/2; sh.position.z=Math.max(12,r*3)+15; toolCutter.add(sh); }
    toolHolder=new THREE.Mesh(new THREE.CylinderGeometry(Math.max(r*1.6,14),Math.max(r*1.6,14)*1.1,40,28),
      new THREE.MeshStandardMaterial({color:0x6b7686,metalness:.7,roughness:.35}));
    toolHolder.rotation.x=Math.PI/2; toolHolder.position.z=(e?e.l:60)+20;
    gTool.add(toolCutter); gTool.add(toolHolder);
  }
  toolRoot.add(gTool);
  if(CO) calloutsFor();
  emit('tool',{t,entry:e,group:gTool,cutter:toolCutter,holder:toolHolder});
}
function calloutsFor(){
  if(!CO) return;
  const e=toolEntry(curToolT), st=ST;
  const alloy='AlMg4.5Mn';
  try{
    CO.remove('tool'); CO.remove('holder'); CO.remove('part');
    if(e&&toolCutter) CO.add('tool',toolCutter,`T${e.t} ${e.name} Ø${(e.r*2).toFixed(e.r*2%1?1:0)}`,{anchor:[0,0,Math.min(8,e.l*.1)],offset:[70,-50],color:'#6fdcff'});
    const hk=mset().holderType==='SK40'?'SK40':'ISO 50';
    if(e&&toolHolder) CO.add('holder',toolHolder,/FACEMILL/.test(e.name)?hk+' SHELL-MILL ARBOR':(/PROBE/.test(e.name)?'TS 640 PROBE BODY':(window.TNC_TOOLS3D&&TNC_TOOLS3D.holderLabel?TNC_TOOLS3D.holderLabel():hk+' · ER COLLET CHUCK')),{anchor:[0,0,0],offset:[80,-20],color:'#a596ff'});
    const mesh=stockH?stockH.mesh:gStock;
    if(mesh) CO.add('part',mesh,`BLANK ${fmt(st.x1-st.x0)}×${fmt(st.y1-st.y0)}×${fmt(st.z1-st.z0)} ${alloy}`,{anchor:[st.x1,st.y0,st.z1],offset:[40,40],color:'#63e6b0'});
  }catch(err){}
}
const fmt=v=>(Math.round(v*100)/100).toString();

/* ---------- height field: the material model lives in stock.js (shared with the checks in sim.js) ---------- */
let GR=null;
function buildHeightField(){
  const st=ST, w=st.x1-st.x0, h=st.y1-st.y0;
  const g=GR=TNC_STOCK.grid(st,S.segs); NX=g.NX; NY=g.NY; DX=g.DX; DY=g.DY;
  HM=TNC_STOCK.field(st,g);
  const pos=new Float32Array(NX*NY*3), col=new Float32Array(NX*NY*3), idx=[];
  for(let j=0;j<NY;j++)for(let i=0;i<NX;i++){ const k=(j*NX+i)*3; pos[k]=st.x0+i*DX; pos[k+1]=st.y0+j*DY; pos[k+2]=st.z1; }
  for(let j=0;j<NY-1;j++)for(let i=0;i<NX-1;i++){ const a=j*NX+i,b=a+1,c=a+NX,d=c+1; idx.push(a,b,d,a,d,c); }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3)); geo.setAttribute('color',new THREE.BufferAttribute(col,3)); geo.setIndex(idx);
  gStock=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,metalness:.55,roughness:.52,side:THREE.DoubleSide}));
  partRoot.add(gStock);
  gSkirt=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({color:0x6b7686,metalness:.6,roughness:.5,side:THREE.DoubleSide}));
  partRoot.add(gSkirt);
  gFloor=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({color:0x4a535f,metalness:.5,roughness:.6,side:THREE.DoubleSide}));
  gFloor.position.set((st.x0+st.x1)/2,(st.y0+st.y1)/2,st.z0); partRoot.add(gFloor);
  /* vice jaws (TNC_STOCK.VICE; .on=false hides them and drops the vice checks — no UI toggle yet) */
  const vm=new THREE.MeshStandardMaterial({color:0x3d4a5c,metalness:.8,roughness:.38});
  TNC_STOCK.vice(st).forEach(b=>{ const j=new THREE.Mesh(new THREE.BoxGeometry(b.x1-b.x0,b.y1-b.y0,b.z1-b.z0),vm);
    j.position.set((b.x0+b.x1)/2,(b.y0+b.y1)/2,(b.z0+b.z1)/2); partRoot.add(j); });
  paintHM();
}
function cutSeg(s,u0,u1){
  if(s.kind!=='feed'||!s.spindle||s.probe) return;    // no removal with the spindle stopped (a crash, shown as such) or while probing
  const len=s.len*(u1-u0); if(len<=0) return;
  const step=Math.max(0.3,Math.min(s.toolR*0.45,2)), n=Math.max(1,Math.ceil(len/step));
  for(let i=0;i<=n;i++){ const u=u0+(u1-u0)*(i/n);          // eps 0: the view removes every sliver; a tilted tool cuts along its axis
    if(TNC_STOCK.stamp(HM,ST,GR,s,{x:s.a.x+(s.b.x-s.a.x)*u, y:s.a.y+(s.b.y-s.a.y)*u, z:s.a.z+(s.b.z-s.a.z)*u},TNC_STOCK.axis(s,u),0)) hmDirty=true; }
}
function paintHM(){
  if(!gStock) return;
  const p=gStock.geometry.attributes.position, c=gStock.geometry.attributes.color, st=ST, span=Math.max(1e-6,st.z1-st.z0);
  for(let k=0;k<NX*NY;k++){ const z=HM[k]; p.array[k*3+2]=z; const cut=(st.z1-z)/span;
    if(cut<1e-4){ c.array[k*3]=.42; c.array[k*3+1]=.46; c.array[k*3+2]=.52; }
    else { c.array[k*3]=.20+cut*.10; c.array[k*3+1]=.55+cut*.20; c.array[k*3+2]=.72+cut*.22; } }
  p.needsUpdate=true; c.needsUpdate=true; gStock.geometry.computeVertexNormals();
  const q=[], at=(i,j)=>HM[j*NX+i];
  const push=(x1,y1,z1,x2,y2,z2)=>q.push(x1,y1,z1,x2,y2,z2,x2,y2,st.z0,x1,y1,z1,x2,y2,st.z0,x1,y1,st.z0);
  for(let i=0;i<NX-1;i++){ push(st.x0+i*DX,st.y0,at(i,0),st.x0+(i+1)*DX,st.y0,at(i+1,0));
    push(st.x0+(i+1)*DX,st.y1,at(i+1,NY-1),st.x0+i*DX,st.y1,at(i,NY-1)); }
  for(let j=0;j<NY-1;j++){ push(st.x1,st.y0+j*DY,at(NX-1,j),st.x1,st.y0+(j+1)*DY,at(NX-1,j+1));
    push(st.x0,st.y0+(j+1)*DY,at(0,j+1),st.x0,st.y0+j*DY,at(0,j)); }
  gSkirt.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(q),3));
  gSkirt.geometry.computeVertexNormals();
  hmDirty=false;
}
function surfaceAt(x,y){
  if(!HM||!ST) return ST?ST.z1:0;
  if(x<ST.x0||x>ST.x1||y<ST.y0||y>ST.y1) return ST.z0-0.5;
  return HM[Math.round((y-ST.y0)/DY)*NX+Math.round((x-ST.x0)/DX)];
}
function removedNow(){
  if(stockH&&stockH.removedVolume) try{ return stockH.removedVolume(); }catch(e){}
  if(!HM) return 0; let v=0; for(let k=0;k<NX*NY;k++) v+=ST.z1-HM[k]; return v*DX*DY;
}

/* ---------- live trace: the cursor block's path with a beaming comet ---------- */
let gTrace=null, gComet=null, trace=null;
const glowTex=(()=>{ const c=document.createElement('canvas'); c.width=c.height=64; const x=c.getContext('2d');
  const g=x.createRadialGradient(32,32,0,32,32,32); g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(.25,'rgba(200,245,255,.9)');
  g.addColorStop(.6,'rgba(111,220,255,.25)'); g.addColorStop(1,'rgba(111,220,255,0)'); x.fillStyle=g; x.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c); })();
function buildTrace(){
  gTrace=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.95,depthTest:false}));
  gTrace.renderOrder=5; partRoot.add(gTrace);
  const N=14, g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(N*3),3));
  g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(N*3),3));
  gComet=new THREE.Points(g,new THREE.PointsMaterial({size:14,sizeAttenuation:false,map:glowTex,vertexColors:true,
    transparent:true,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending}));
  gComet.renderOrder=6; gComet.frustumCulled=false; partRoot.add(gComet);
  gTrace.visible=gComet.visible=false;
}
function traceFor(bi){
  trace=null; if(!gTrace) return;
  /* only one occurrence of the block (a block inside CALL LBL … REP runs many times): the next one after the machine */
  let segs=[], all=[]; S.segs.forEach((s,i)=>{ if(s.block===bi) all.push(i); });
  if(all.length){ let st=all.findIndex(i=>S.segs[i].t0>=S.t-1e-6); if(st<0) st=0; let i=all[st];
    while(i<S.segs.length&&S.segs[i].block===bi){ segs.push(S.segs[i]); i++; } }
  if(!segs.length){ gTrace.visible=gComet.visible=false; return; }
  const p=new Float32Array(segs.length*6); let L=0; const cum=[0];
  segs.forEach((s,i)=>{ p.set([s.a.x,s.a.y,s.a.z,s.b.x,s.b.y,s.b.z],i*6); L+=s.len; cum.push(L); });
  gTrace.geometry.setAttribute('position',new THREE.BufferAttribute(p,3)); gTrace.geometry.computeBoundingSphere();
  trace={segs,cum,L,u:0,loops:0,period:clamp(L/60,0.9,3.2)};
  gTrace.visible=gComet.visible=true;
}
function tracePoint(d){
  const tr=trace; d=((d%tr.L)+tr.L)%tr.L;
  let i=0; while(i<tr.segs.length-1&&tr.cum[i+1]<d) i++;
  const s=tr.segs[i], u=(d-tr.cum[i])/Math.max(1e-9,s.len);
  return [s.a.x+(s.b.x-s.a.x)*u, s.a.y+(s.b.y-s.a.y)*u, s.a.z+(s.b.z-s.a.z)*u];
}
function traceTick(dt){
  if(!trace||!gComet) return;
  const show=!S.running && !S.lesson?.hideTrace && trace.loops<2;       // two passes, then it stands still
  gTrace.visible=!S.running; gComet.visible=show; if(!show){ gTrace.material.opacity=.35; return; }
  trace.u+=dt/trace.period; if(trace.u>=1){ trace.u-=1; trace.loops++; }
  const head=trace.u*trace.L, pos=gComet.geometry.attributes.position, col=gComet.geometry.attributes.color, N=pos.count;
  const tail=Math.min(trace.L*0.35, 22);
  for(let k=0;k<N;k++){ const d=Math.max(0,head-tail*(k/(N-1))); const q=tracePoint(d);
    pos.array[k*3]=q[0]; pos.array[k*3+1]=q[1]; pos.array[k*3+2]=q[2];
    const f=REDUCED?(k===0?1:0):Math.pow(1-k/(N-1),1.6); col.array[k*3]=f; col.array[k*3+1]=f; col.array[k*3+2]=f; }
  pos.needsUpdate=col.needsUpdate=true;
  gTrace.material.opacity=.55+.4*Math.sin(performance.now()/260)**2;
}

/* ---------- views ---------- */
function fitView(){ setView(S.view); }
function setView(v){
  const st=ST, d=Math.max(st.x1-st.x0,st.y1-st.y0,40);
  const cx=(st.x0+st.x1)/2, cy=(st.y0+st.y1)/2, cz=(st.z0+st.z1)/2;
  const Pv={'3D':[cx+d*.95,cy-d*1.05,cz+d*.85],'TOP':[cx,cy-0.001,cz+d*1.9],'FRONT':[cx,cy-d*1.9,cz+d*.05],'SIDE':[cx+d*1.9,cy,cz+d*.05]}[v]||[cx+d,cy-d,cz+d];
  camera.position.set(Pv[0],Pv[1],Pv[2]); controls.target.set(cx,cy,cz);
  S.view=v; $('gfx-rt').textContent=v==='3D'?'3-D VIEW':'PLAN VIEW '+v; writePrefs();
}

/* ================= effects (fx.js) ================= */
let FXO=null;
if(window.TNC_FX){
  try{ FXO=TNC_FX.create(THREE,scene,{}); FXO.surfaceAt=(x,y)=>surfaceAt(x,y); }catch(e){ FXO=null; }
}
function fxApply(){ if(FXO) FXO.set({chips:S.fx,sparks:S.fx,coolant:S.fxCool,smoke:S.fxFire,fire:S.fxFire}); }
function toWorld(p){ const v=new THREE.Vector3(p.x,p.y,p.z); if(partRoot&&rig) partRoot.localToWorld(v); return v; }

/* ================= sound ================= */
let AC=null;
function beep(kind){
  if(!S.sound) return;
  try{ AC=AC||new (window.AudioContext||window.webkitAudioContext)();
    const o=AC.createOscillator(), g=AC.createGain(), t=AC.currentTime; o.connect(g); g.connect(AC.destination);
    if(kind==='crash'){ o.type='square'; [880,660,880,660].forEach((f,i)=>o.frequency.setValueAtTime(f,t+i*.17));
      g.gain.setValueAtTime(.07,t); g.gain.exponentialRampToValueAtTime(.0001,t+.75); o.start(t); o.stop(t+.76); }
    else { o.type='sine'; o.frequency.setValueAtTime(kind==='warn'?990:1320,t);
      g.gain.setValueAtTime(.045,t); g.gain.exponentialRampToValueAtTime(.0001,t+.2); o.start(t); o.stop(t+.21); }
  }catch(e){}
}

/* ================= transport ================= */
const scrub=$('scrub');
function segAt(t){ let lo=0,hi=S.segs.length-1,r=-1;
  while(lo<=hi){ const m=(lo+hi)>>1; if(S.segs[m].t1<t) lo=m+1; else { r=m; hi=m-1; } }
  return r<0?S.segs.length-1:r; }
function applyCuts(toT){
  if(stockH){ try{ stockH.cutTo(S.ex,toT); }catch(e){} S.stampT=toT; return; }
  if(toT<=S.stampT) return;
  for(const s of S.segs){ if(s.t1<=S.stampT||s.t0>=toT) continue;
    cutSeg(s,Math.max(0,(S.stampT-s.t0)/(s.t1-s.t0)),Math.min(1,(toT-s.t0)/(s.t1-s.t0))); }
  S.stampT=toT;
}
function rewind(toT){
  if(stockH){ try{ stockH.reset(); }catch(e){} S.stampT=0; applyCuts(toT); return; }
  HM.fill(ST.z1); S.stampT=0; hmDirty=true; applyCuts(toT);
}
/* fire=true: a playing machine — crash events stop it where they happen */
function seek(t, fire){
  t=clamp(t,0,S.total);
  if(fire){
    while(S.evIdx<S.events.length && S.events[S.evIdx].t<=t+1e-9){
      const ev=S.events[S.evIdx++]; raise(ev);
      if(ev.sev==='crash'){ t=ev.t; S.running=false; setState('CRASH · FEED HOLD'); break; }
    }
  } else { const i=S.events.findIndex(e=>e.t>t+1e-9); S.evIdx=i<0?S.events.length:i; }
  if(t<S.stampT-1e-9) rewind(t); else applyCuts(t);
  S.t=t; scrub.value=S.total>0?Math.round(t/S.total*1000):0;
  syncExec();
}
function syncExec(){
  if(!S.segs.length||!S.running) return;                 // while running, the highlight follows the machine
  const sg=S.segs[segAt(S.t)], b=sg.block; if(sg.seq!=null) S.k=sg.seq;
  if(b!==S.execB){ S.execB=b; if(!S.editing){ S.cursor=b; } markRows(); flowHighlight(); }
}
/* ---- single block by NC block, in execution order (res.exec from the interpreter; moves carry seq) ----
   The highlighted block is the one that runs next. The machine stands where it is just before it. */
const EX=()=>(S.res&&S.res.exec)||[];
function segFromSeq(k){ let lo=0,hi=S.segs.length; while(lo<hi){ const m=(lo+hi)>>1; if((S.segs[m].seq??-1)<k) lo=m+1; else hi=m; } return lo; }
function startT(k){ const i=segFromSeq(k); return i<S.segs.length?S.segs[i].t0:S.total; }
function selectStep(k){                                  // machine to just before step k, highlight its block
  const E=EX(); if(!E.length) return; k=clamp(k,0,E.length); S.k=k; S.running=false;
  seek(startT(k),false); S.cursor=k<E.length?E[k]:Math.max(0,S.res.blocks.length-1); S.execB=S.cursor; markRows(true); flowHighlight(); traceFor(S.cursor);
}
function stepFor(block){                                 // the next time this block runs (after the current step), else its first time
  const E=EX(), from=S.k||0; for(let k=from;k<E.length;k++) if(E[k]===block) return k;
  for(let k=0;k<E.length;k++) if(E[k]===block) return k; return -1;
}
function reset(){ S.running=false; hideAlarm(); if(FXO) FXO.clear(); S.k=0; selectStep(0); setState('READY'); }
function start(){
  if(!S.segs.length){ say('NO MOVES TO RUN'); return; }
  if(S.t>=S.total-1e-6){ seek(0,false); if(FXO) FXO.clear(); }
  hideAlarm('crash'); S.running=true; setState(S.mode==='single'?'SINGLE BLOCK':'RUNNING');
  if(S.speed===0) runMax();
}
function stop(){ if(S.running){ S.running=false; setState('FEED HOLD'); } }
/* NC START does what the operating mode says: SINGLE-BLOCK = the next block, TEST / FULL-RUN = run, PROGRAM = nothing */
function ncStart(){ if(S.mode==='single') stepBlock(); else if(S.mode==='edit') say('PROGRAM MODE — NC START WORKS IN 2 TEST, 3 SINGLE-BLOCK, 4 FULL-RUN'); else start(); }
function runMax(){ S.running=false; seek(S.total,true); if(S.t>=S.total-1e-6) setState('PROGRAM END'); }
function stepBlock(){                                   // NC START in SINGLE-BLOCK: exactly the highlighted block, then the next one is highlighted
  const E=EX(); if(!E.length) return;
  let k=S.k==null?stepFor(S.cursor):S.k; if(k<0) k=0;
  if(E[k]!==S.cursor){ const k2=stepFor(S.cursor); if(k2>=0) k=k2; }
  if(k>=E.length){ setState('PROGRAM END'); return; }
  S.running=false; seek(startT(k+1),true);              // runs step k (crash events stop it where they happen)
  if(/CRASH/.test($('run-state').textContent)) return;
  S.k=k+1; S.cursor=S.k<E.length?E[S.k]:Math.max(0,S.res.blocks.length-1); S.execB=S.cursor; markRows(true); flowHighlight(); traceFor(S.cursor);
  setState(S.k>=E.length?'PROGRAM END':'SINGLE BLOCK');
}
function setState(s){ $('run-state').textContent=s; }

/* ================= alarms ================= */
const alarmEl=$('alarm'); let alarmT=0;
function raise(ev){
  const at=ev.at?` · T${ev.tool} X${ev.at.x.toFixed(2)} Y${ev.at.y.toFixed(2)} Z${ev.at.z.toFixed(2)}`:'';
  if(ev.sev==='crash'){
    showAlarm('crash','CRASH',`BLOCK ${nOf(ev.block)} · ${(window.TNC_I18N?TNC_I18N.tr(ev.msg):ev.msg).replace(/^CRASH:\s*/,'')}${at}`);
    S.shake=REDUCED?0:1; beep('crash');
    if(FXO&&ev.at) try{ FXO.crash(toWorld(ev.at)); }catch(e){}
    emit('crash',ev);
  } else if(ev.sev==='warn'){
    showAlarm('warn','WARNING',`BLOCK ${nOf(ev.block)} · ${ev.msg.replace(/^WARNING:\s*/,'')}`,6000); beep('warn');
  } else say(ev.msg);
}
function showAlarm(kind,title,text,ms){
  alarmEl.className='alarm '+kind; alarmEl.hidden=false;
  alarmEl.innerHTML=`<b>${esc(title)}</b><span>${esc(text)}</span><button type="button" aria-label="Acknowledge">CE</button>`;
  alarmEl.querySelector('button').onclick=()=>hideAlarm();
  clearTimeout(alarmT); if(ms) alarmT=setTimeout(()=>hideAlarm(kind),ms);
}
function hideAlarm(kind){ if(kind&&!alarmEl.classList.contains(kind)) return; alarmEl.hidden=true; }

/* ================= program listing ================= */
const plist=$('plist'), crt=$('crt'), raw=$('raw');
const HL=[
  [/(^|\s)(BEGIN PGM|END PGM|BLK FORM|TOOL CALL|CYCL DEF|CYCL CALL|CALL LBL|LBL|STOP|FN \d+:)/g,'$1<i class="t-key">$2</i>'],
  [/\b(FMAX)\b/g,'<i class="t-f">$1</i>'],[/\b(F\d+(?:\.\d+)?|FQ\d+)\b/g,'<i class="t-f">$1</i>'],
  [/\b(M\d+)\b/g,'<i class="t-m">$1</i>'],[/\b(Q\d+)\b/g,'<i class="t-q">$1</i>'],
  [/\b([XYZABC]|IX|IY|IZ|R|S)([+-]?\d+(?:\.\d+)?)/g,'$1<i class="t-num">$2</i>']
];
function hl(s){ const ci=s.indexOf(';'); let code=ci>=0?s.slice(0,ci):s; const cm=ci>=0?s.slice(ci):'';
  code=esc(code); for(const [re,rp] of HL) code=code.replace(re,rp);
  return code+(cm?'<i class="t-cm">'+esc(cm)+'</i>':''); }
let evBlocks={};
function renderList(){
  evBlocks={}; S.events.forEach(e=>{ if(e.sev==='crash'||e.sev==='warn') evBlocks[e.block]=evBlocks[e.block]==='crash'?'crash':e.sev; });
  plist.innerHTML=(S.res.blocks||[]).map((b,i)=>{
    const c=['blk']; if(b.indent) c.push('ind'); if(b.error||evBlocks[i]==='crash') c.push('err'); else if(evBlocks[i]==='warn') c.push('warn');
    return `<div class="${c.join(' ')}" data-i="${i}"><span class="bn">${b.indent||b.n==null?'':b.n}</span><span class="bt">${hl(b.raw||'')}</span></div>`;
  }).join('');
  markRows(true);
}
let lastCur=-1, lastExec=-1;
function markRows(scroll){
  const rows=plist.children;
  const set=(i,cls,on)=>{ if(rows[i]) rows[i].classList.toggle(cls,on); };
  if(lastCur>=0) set(lastCur,'cur',false); if(lastExec>=0) set(lastExec,'exec',false);
  set(S.cursor,'cur',true); if(S.execB!==S.cursor&&S.running) set(S.execB,'exec',true);
  lastCur=S.cursor; lastExec=S.execB;
  const fset=new Set(S.focus||[]);
  for(let i=0;i<rows.length;i++) rows[i].classList.toggle('focus', fset.size>0 && fset.has(S.res.blocks[i].n) && !S.res.blocks[i].indent);
  if(scroll!==false){ const el=rows[S.cursor]; if(el){ const r=el.offsetTop, h=crt.clientHeight;
    if(r<crt.scrollTop+12||r>crt.scrollTop+h-30) crt.scrollTop=r-h/2; } }
  if(!S.running) traceFor(S.cursor);
  if(S.flowView) flowHighlight();
}
/* TEST / SINGLE-BLOCK / FULL-RUN: moving the block cursor moves the machine to the end of that block */
function followCursor(){                                // run modes: selecting a block puts the machine just before it
  if(S.mode==='edit'||S.running) return;
  const k=stepFor(S.cursor); if(k>=0) selectStep(k);
}
function moveCursor(i){ S.cursor=clamp(i,0,Math.max(0,S.res.blocks.length-1)); markRows(); }
plist.addEventListener('click',e=>{ const d=e.target.closest('.blk'); if(!d) return;
  moveCursor(+d.dataset.i); followCursor(); });
plist.addEventListener('dblclick',e=>{ if(e.target.closest('.blk')) beginEdit(); });

/* ================= side panels ================= */
function fmtT(s){ const m=Math.floor(s/60); return (m<10?'0':'')+m+':'+(s%60<10?'0':'')+(s%60).toFixed(1); }
function renderKV(){
  const st=S.res.stats||{}, s=S.seg;
  const rows=[['Elapsed / total',fmtT(S.t)+' / '+fmtT(S.total)],['Blocks',(S.res.blocks.filter(b=>b.n!=null&&!b.indent).pop()||{n:0}).n+1],
    ['Moves',S.segs.length],['Feed path',(st.pathFeed||0).toFixed(0)+' mm'],['Rapid path',(st.pathRapid||0).toFixed(0)+' mm'],
    ['Min Z',(st.minZ!=null?(+st.minZ).toFixed(3):'--')+' mm'],['Removed',(removedNow()/1000).toFixed(1)+' cm³'],
    ['Active cycle',s&&s.cycle?s.cycle:'—'],['Override',S.ovr+' %'],['Machine',M().label]];
  $('runkv').innerHTML=rows.map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
}
function renderChecks(){
  const errs=S.res.errors||[], ev=S.events;
  const items=[...errs.map(e=>({cls:'',t:null,block:e.block,msg:e.msg})),
               ...ev.map(e=>({cls:e.sev==='crash'?'':e.sev,t:e.t,block:e.block,msg:e.msg}))];
  const nCrash=ev.filter(e=>e.sev==='crash').length, nWarn=ev.filter(e=>e.sev==='warn').length;
  $('errc').textContent=errs.length+nCrash+nWarn?`${errs.length} err · ${nCrash} crash · ${nWarn} warn`:'all clear';
  const tr=m=>window.TNC_I18N?TNC_I18N.tr(m):m;
  $('elist').innerHTML=items.length?items.map((x,i)=>`<div class="${x.cls}" data-k="${i}">BLOCK ${nOf(x.block)} &nbsp;${esc(tr(x.msg))}</div>`).join('')
    :'<div class="ok">PROGRAM CHECKED · NO ERRORS · NO CRASHES</div>';
  $('elist').onclick=e=>{ const d=e.target.closest('[data-k]'); if(!d) return; const x=items[+d.dataset.k];
    moveCursor(x.block); if(x.t!=null){ S.running=false; seek(Math.max(0,x.t-1e-3),false); } };
}
const CMPF=[['cycleTime','Cycle time'],['pathFeed','Feed path'],['pathRapid','Rapid path'],['moveCount','Moves'],['minZ','Min Z'],['removedVolume','Removed']];
function statsNow(){ return Object.assign({},S.res.stats||{},{removedVolume:removedNow()}); }
function renderCompare(){
  const b=statsNow(), a=S.ref?S.ref.stats:null;
  $('cmp-t').textContent=S.ref?'A: '+S.ref.name:'no reference';
  const f=v=>v==null||isNaN(v)?'--':(Math.abs(v)>=100?(+v).toFixed(0):(+v).toFixed(2));
  let h='<span class="h">Metric</span><span class="h">A ref</span><span class="h">B now</span><span class="h">Δ</span>';
  for(const [k,l] of CMPF){ const bv=b[k], av=a?a[k]:null; let d='--',dc='eq';
    if(a&&av!=null&&bv!=null){ const dv=bv-av; d=(dv>0?'+':'')+f(dv); dc=Math.abs(dv)<1e-6?'eq':(k==='removedVolume'?(dv>0?'dn':'up'):(dv>0?'up':'dn')); }
    h+=`<span class="l">${l}</span><span class="v">${f(av)}</span><span class="v">${f(bv)}</span><span class="d ${dc}">${d}</span>`; }
  $('cmp').innerHTML=h;
}
$('b-snap').onclick=()=>{ S.running=false; seek(S.total,false);
  S.ref={stats:statsNow(),text:S.text,pgm:S.pgm,machine:S.machine,name:S.pgm+' @'+new Date().toTimeString().slice(0,5)};
  renderCompare(); say('REFERENCE STORED — CHANGE THE PROGRAM, RUN, COMPARE'); };
$('b-restore').onclick=()=>{ if(!S.ref){ say('NO REFERENCE STORED'); return; }
  if(S.ref.machine!==S.machine) setMachine(S.ref.machine);
  if(pg()[S.ref.pgm]==null) pg()[S.ref.pgm]=S.ref.text; openPgm(S.ref.pgm); say('REFERENCE PROGRAM OPEN: '+S.ref.pgm); };

let droT=0;
function renderDro(now){
  const i=S.segs.length?segAt(S.t):-1; let x=0,y=0,z=0,f=0,sp=0,tl=0,s=null,u=0;
  if(i>=0){ s=S.segs[i]; u=clamp((S.t-s.t0)/Math.max(1e-9,s.t1-s.t0),0,1);
    x=s.a.x+(s.b.x-s.a.x)*u; y=s.a.y+(s.b.y-s.a.y)*u; z=s.a.z+(s.b.z-s.a.z)*u;
    f=Math.round(s.f*(S.ovr/100)); sp=s.spindle||0; tl=s.tool||0; }
  S.seg=s; S.pos={x,y,z};
  if(s&&s.tool!==curToolT) setTool(s.tool);
  if(rig&&M().kinematics.poseAt){ try{ rig.set(M().kinematics.poseAt(S.ex,S.t)); }catch(e){} }
  else if(gTool){ gTool.position.set(x,y,z);
    if(s&&s.a&&s.a.a!=null){ const A=s.a.a+((s.b.a||0)-s.a.a)*u, B=s.a.b+((s.b.b||0)-s.a.b)*u;   // tool axis = Ry(-B)·Rx(A)·(0,0,-1)
      gTool.rotation.set(A*Math.PI/180,-B*Math.PI/180,0,'YXZ'); }
    else gTool.rotation.set(0,0,0); }
  if(now-droT<66) return; droT=now;
  const extra=(M().axes||[]).filter(a=>/[ABC]/.test(a)).map(a=>{ const k=a.toLowerCase(); let v=0;
    if(s&&s.a&&s.a[k]!=null) v=s.a[k]+((s.b[k]||0)-s.a[k])*u; return ['s',a,(+v).toFixed(3)]; });
  const R=[['x','X',x.toFixed(3)],['y','Y',y.toFixed(3)],['z','Z',z.toFixed(3)],...extra,
           ['s','S',(s&&s.sRpm!=null?s.sRpm:Math.abs(sp))+(sp<0?' M4':sp>0?' M3':' M5')],['f','F',s&&s.kind==='rapid'?'FMAX':f],['t','T',String(tl)]];
  $('dro').innerHTML=R.map(([c,a,v])=>`<div class="drow ${c}"><span class="ax">${a}</span><span class="val">${v}</span></div>`).join('');

}

/* ================= soft keys ================= */
const sks=$('sks');
const SK={
  /* EDIT: the path-function keys, the program keys (CYCL DEF, TOOL CALL …) and the editing keys — three rows */
  edit:  [['L','w:L'],['CC','w:CC'],['C','w:C'],['CR','w:CR'],['CT','w:CT'],['CP\nPOLAR','w:CP'],['RND','w:RND'],['CHF','w:CHF'],
          ['APPR\nDEP','apprdep'],['TOOL\nDEF','w:TOOLDEF'],['TOOL\nCALL','w:TOOLCALL'],['CYCL\nDEF','cycldef'],['CYCL\nCALL','w:CYCLCALL'],['LBL\nSET','w:LBLSET'],['LBL\nCALL','w:LBLCALL'],['Q','w:Q'],
          ['EDIT','ed'],['INSERT','ins'],['DELETE','del'],['UNDO','undo'],['REDO','redo'],['TOOL\nLIST','tt'],['RAW\nTEXT','rawt'],['CHECK','chk']],
  test:  [['START','start'],['START\nSINGLE','step'],['STOP','stop'],['RESET','reset'],['3-D\nVIEW','v3'],['PLAN\nVIEW','vt'],['FRONT','vf'],['SIDE','vs']],
  single:[['NC START\nNEXT BLOCK','step'],['NC\nSTOP','stop'],['RESET','reset'],['OVR\n−','ovrd'],['OVR\n+','ovru'],['3-D\nVIEW','v3'],['TOOL\nLIST','tt'],['PROGRAMS','mgt']],
  full:  [['NC\nSTART','start'],['NC\nSTOP','stop'],['RESET','reset'],['OVR\n−','ovrd'],['OVR\n+','ovru'],['3-D\nVIEW','v3'],['TOOL\nLIST','tt'],['PROGRAMS','mgt']],
  tt:    [['ADD\nMISSING','ttmiss'],['IMPORT\nTOOL.T','load'],['EXPORT\nTOOL.T','ttexp'],['',''],['',''],['',''],['',''],['END','ttend']],
  mgt:   [['NEW','new'],['OPEN','open'],['LOAD\nFROM PC','load'],['SAVE\n.H','save'],['RESTORE\nORIGINAL','restore'],['DELETE','mdel'],['ADD TO\nPROJECT','padd'],['END','end']]
};
function skRows(){ if(S.wiz) return wizSK(); if(S.pick) return S.pick; if(S.mgt) return SK.mgt; if(S.tt) return SK.tt; return SK[S.mode]||SK.test; }
/* soft keys: the same look and the same behaviour everywhere; NC START green, NC STOP red; a path row when nested */
const SKKEY={ed:'E',ins:'I',del:'DEL',undo:'CTRL Z',redo:'CTRL Y',rawt:'TAB',tt:'T',mgt:'M',focus:'F',flow:'V',start:'SPACE',stop:'ESC',reset:'R',
  v3:'G',vt:'G',vf:'G',vs:'G',ovrd:'−',ovru:'+',cycldef:'Y','w:TOOLCALL':'W',apprdep:'A','w:Q':'Q',load:'CTRL O',save:'CTRL S',new:'N',mdel:'DEL',restore:'R',end:'ESC',
  ttend:'ESC',pickend:'ESC',wend:'END',wcancel:'ESC',wskip:'⇧ ENTER',wok:'ENTER',wsign:'− / +',wact:'#',wce:'DELETE'};
function skKey(a){ if(a==='step') return S.mode==='single'?'SPACE / S':'S'; if(a.startsWith('wa:')) return 'XYZ'.includes(a.slice(3))?'':a.slice(3); return SKKEY[a]||''; }
function skClass(a){ const on=(a==='rawt'&&S.raw)||(a==='flow'&&S.flowView)||(a==='focus'&&S.focusView)||(a==='tt'&&S.tt)||(a==='mgt'&&S.mgt);
  return (a==='start'||(a==='step'&&S.mode==='single'))?' go':(a==='stop'?' stop':(on?' on':'')); }
function renderSK(){ const tr=window.TNC_I18N?(x=>TNC_I18N.tr(x)):(x=>x);
  sks.innerHTML=skRows().map(([l,a])=>{ const k=skKey(a); return `<button class="sk${skClass(a)}" data-a="${esc(a)}">${esc(tr(l.replace(/\n/g,' '))===l.replace(/\n/g,' ')?l:tr(l.replace(/\n/g,' '))).replace(/\n/g,'<br>')}${k?`<small class="kh">${esc(k)}</small>`:''}</button>`; }).join('');
  renderPath(); }
function renderPath(){
  const el=$('skpath'); if(!el) return; let path=null, back='';
  if(S.wiz){ path=['PROGRAM',S.wiz.spec.title,'QUESTION '+(S.wiz.i+1)+' / '+S.wiz.spec.steps.length]; back='DEL (ESC) = ABORT · END = FINISH'; }
  else if(S.pick){ path=(S.pickPath||['PROGRAM']); back='ESC = ONE LEVEL UP'; }
  else if(S.mgt){ path=['PROGRAMS']; back='ESC / M = BACK TO THE PROGRAM'; }
  else if(S.tt){ path=['TOOL LIST','TOOL.T']; back='ESC / T / END = BACK'; }
  el.hidden=!path; if(path) el.innerHTML=path.map((x,i)=>i===path.length-1?`<b>${esc(x)}</b>`:esc(x)).join(' › ')+`<span class="back">${esc(back)}</span>`;
}
sks.addEventListener('click',e=>{ const b=e.target.closest('.sk'); if(b&&b.dataset.a) act(b.dataset.a); if(S.wiz) dlgIn.focus(); });
function act(a){
  if(a.startsWith('w:')){ startWiz(DLG&&DLG.PATH[a.slice(2)]); return; }
  if(a.startsWith('cg:')){ const L=DLG.cycleList(a.slice(3));
    const G=(DLG.GROUPS.find(g=>g[0]===a.slice(3))||[,''])[1].replace(/\n/g,' ');
    S.pickPath=['PROGRAM','CYCL DEF',G];
    S.pick=L.map(c=>[c.num+'\n'+c.name.split(' ').slice(0,2).join(' '),'cy:'+c.num]).concat([['BACK','cycldef'],['END','pickend']]); renderSK(); return; }
  if(a.startsWith('cy:')){ S.pick=null; startWiz(DLG.cycleSpec(+a.slice(3))); return; }
  if(a.startsWith('wv:')){ wizAccept(a.slice(3)); return; }
  if(a.startsWith('wa:')){ ckAxis(a.slice(3)); return; }
  if(a.startsWith('wd:')){ ckDigit(a.slice(3)); return; }
  switch(a){
    case 'cycldef': if(!DLG) return; if(S.mode!=='edit') setMode('edit'); S.pickPath=['PROGRAM','CYCL DEF']; S.pick=DLG.GROUPS.map(g=>[g[1],'cg:'+g[0]]).concat([['END','pickend']]); renderSK(); break;
    case 'apprdep': if(S.mode!=='edit') setMode('edit'); S.pickPath=['PROGRAM','APPR / DEP']; S.pick=[['APPR','w:APPR'],['DEP','w:DEP'],['',''],['',''],['',''],['',''],['',''],['END','pickend']]; renderSK(); break;
    case 'pickend': S.pick=null; renderSK(); break;
    case 'wskip': wizAccept('',true); break; case 'wend': wizEnd(); break; case 'wcancel': wizCancel(); break; case 'wok': wizAccept(dlgIn.value); break;
    case 'wi': ckInc(); break; case 'wp': ckPolar(); break; case 'wq': ckQ(); break; case 'wsign': ckSign(); break; case 'wact': ckActual(); break; case 'wce': ckCE(); break;
    case 'ttmiss': addMissingTools(); break;
    case 'ttexp': if(window.TNC_PROFILE) download('TOOL_TNC'+S.machine+'.T',new Blob([TNC_PROFILE.toolT(mtools())],{type:'text/plain'}),'TOOL-TABLES'); break;
    case 'ttend': closeTT(); break; case 'focus': toggleFocus(); break;
    case 'start': start(); break; case 'stop': stop(); break; case 'step': stepBlock(); break;
    case 'reset': reset(); break; case 'rs': reset(); start(); break;
    case 'v3': setView('3D'); break; case 'vt': setView('TOP'); break; case 'vf': setView('FRONT'); break; case 'vs': setView('SIDE'); break;
    case 'ovrd': S.ovr=Math.max(0,S.ovr-10); renderKV(); writePrefs(); say('FEED OVERRIDE '+S.ovr+'%'); break;
    case 'ovru': S.ovr=Math.min(150,S.ovr+10); renderKV(); writePrefs(); say('FEED OVERRIDE '+S.ovr+'%'); break;
    case 'ed': beginEdit(); break; case 'ins': insertBlock(); break; case 'del': deleteBlock(); break; case 'cp': copyBlock(); break;
    case 'undo': undo(); break; case 'redo': redo(); break; case 'rawt': toggleRaw(); break;
    case 'chk': compile(); say(S.res.errors.length?`CHECK: ${S.res.errors.length} ERROR(S)`:(S.events.some(e=>e.sev==='crash')?'CHECK: WILL CRASH — SEE CHECKS':'PROGRAM CHECKED OK')); break;
    case 'tt': S.tt?closeTT():openTT(); break; case 'flow': toggleFlow(); break; case 'mgt': openMgt(); break;
    case 'new': closeMgt(); openNew(); break; case 'open': openPgm(mgtNames()[S.mgtSel]); break;
    case 'load': loadFromDisk(); break; case 'save': saveH(); break;
    case 'restore': restoreOriginal(mgtNames()[S.mgtSel]); break; case 'mdel': deletePgm(mgtNames()[S.mgtSel]); break;
    case 'padd': addToProject(mgtNames()[S.mgtSel]); break; case 'end': closeMgt(); break;
  }
}
function showTools(){
  const rows=mtools().map(t=>`T${String(t.t).padStart(2)}  ${String(t.name).padEnd(14)} L${(+t.l).toFixed(2).padStart(7)}  R${(+t.r).toFixed(3).padStart(6)}${t.mine?'  *':''}`);
  $('elist').innerHTML=rows.map(r=>`<div class="info">${esc(r)}</div>`).join(''); $('errc').textContent='TOOL TABLE'; say('TOOL TABLE IN THE CHECKS PANEL');
}

/* ================= block editing — the dialog line ================= */
const dlgIn=$('dlg-in'), dlgPr=$('dlg-pr'), dlgHint=$('dlg-hint');
const lines=()=>S.text.split('\n');
function srcLine(bi){ return clamp(bi,0,lines().length-1); }     // one source line per block, blank lines included
function beginEdit(){
  const b=S.res.blocks[S.cursor]; if(!b) return;
  S.editing=true; S.running=false; dlgIn.disabled=false; dlgIn.value=b.raw||'';
  dlgPr.textContent='BLOCK '+(b.n==null?'':b.n); dlgHint.textContent='ENT accept · ESC cancel · TAB takes the grey suggestion';
  dlgIn.focus(); dlgIn.select(); ghostUpdate();
  setTimeout(()=>{ if(S.editing&&document.activeElement!==dlgIn){ dlgIn.focus(); ghostUpdate(); } },0);   // after a dialog closes
}

/* ================= ghost autosuggest in the block line (like zsh): low-contrast rest of a block, TAB takes it =================
   Empty line: the next thing the program still needs. Typing: your own program's lines first (newest first), then common blocks. */
const SUGG=['BLK FORM 0.1 Z X+0 Y+0 Z-20','BLK FORM 0.2 X+100 Y+100 Z+0','TOOL CALL 1 Z S2000','TOOL DEF 1 L+0 R+3','L Z+50 R0 FMAX M3','L X+0 Y+0 R0 FMAX',
  'L Z+2 R0 FMAX','L Z-2 R0 F150','L X+50 Y+0 RL F300','L X+0 Y+0 R0 F300','L Z+100 R0 FMAX M5','CC X+50 Y+50','C X+50 Y+50 DR+','CR X+50 Y+50 R+20 DR-',
  'CT X+50 Y+50','CP IPA+360 IZ-2 DR+','LP PR+20 PA+0 R0 F300','RND R5','CHF 5','APPR LCT X+0 Y+0 R5 RL F300','DEP LCT X-20 Y-20 R5 F1000',
  'CYCL DEF 200 DRILLING','CYCL CALL','M99','M30','M3','M5','M8','M9','LBL 1','LBL 0','CALL LBL 1','CALL LBL 1 REP 3/3','FN 0: Q1 = +0','Q1 = Q1 + 1','STOP'];
function nextNeeded(){
  const T=S.text.toUpperCase(), ls=lines(), prev=(ls[srcLine(S.cursor)-1]||'').toUpperCase();
  if(!/BLK\s+FORM\s+0\.1/.test(T)) return 'BLK FORM 0.1 Z X+0 Y+0 Z-20';
  if(!/BLK\s+FORM\s+0\.2/.test(T)) return 'BLK FORM 0.2 X+100 Y+100 Z+0';
  if(!/TOOL\s+CALL/.test(T)) return 'TOOL CALL '+((mtools()[3]||mtools()[0]||{t:1}).t)+' Z S2000';
  if(/TOOL\s+CALL/.test(prev)) return 'L Z+50 R0 FMAX M3';
  if(/CYCL\s+DEF|^\s*Q2\d\d\s*=/.test(prev)) return 'L X+0 Y+0 R0 FMAX M99';
  return '';
}
function suggestFor(typed){
  const t=typed.replace(/^\s+/,'').toUpperCase();
  if(!t) return nextNeeded();
  const own=lines().map(l=>l.replace(/^\s*\d+\s+/,'').replace(/\s*;.*$/,'').trim()).filter(Boolean).reverse();
  for(const c of own.concat(SUGG)){ const C=c.toUpperCase(); if(C.startsWith(t)&&C.length>t.length&&!/^(BEGIN|END)\s+PGM/.test(C)) return c; }
  return '';
}
let ghostEl=null;
function ghostEnsure(){
  if(ghostEl) return ghostEl;
  const wrap=document.createElement('span'); wrap.className='dlgwrap'; dlgIn.parentNode.insertBefore(wrap,dlgIn); wrap.appendChild(dlgIn);
  ghostEl=document.createElement('span'); ghostEl.className='ghost'; ghostEl.setAttribute('aria-hidden','true'); wrap.appendChild(ghostEl);
  return ghostEl;
}
function ghostShow(rest,typed){
  const g=ghostEnsure(); if(!rest){ g.innerHTML=''; g.dataset.full=''; return; }
  const cs=getComputedStyle(dlgIn); ['font','letterSpacing','paddingLeft','paddingTop','paddingRight','paddingBottom','borderLeftWidth','borderTopWidth'].forEach(k=>g.style[k]=cs[k]);
  g.innerHTML=`<span class="gt">${esc(typed)}</span><span class="gs">${esc(rest)}</span>`;
}
function ghostUpdate(){
  if(!S.editing){ ghostShow(''); return; }
  const v=dlgIn.value, sug=suggestFor(v);
  if(!sug||dlgIn.selectionStart!==v.length&&v.length){ ghostShow(''); ghostEnsure().dataset.full=''; return; }
  const rest=v.trim()?sug.slice(v.replace(/^\s+/,'').length):sug;
  ghostShow(rest,v); ghostEl.dataset.full=sug;
}
function ghostAccept(){ const full=ghostEl&&ghostEl.dataset.full; if(!full) return false; dlgIn.value=full; dlgIn.setSelectionRange(full.length,full.length); ghostUpdate(); return true; }
dlgIn.addEventListener('input',ghostUpdate);
dlgIn.addEventListener('click',ghostUpdate);
function endEdit(accept){
  if(!S.editing) return;
  const val=dlgIn.value, pend=S.insertPending; S.insertPending=false; S.editing=false; dlgIn.disabled=true; dlgIn.value=''; ghostShow('');
  if(pend&&(!accept||!val.trim())){ const ls=lines(), i=srcLine(S.cursor); if(!(ls[i]||'').trim()){ ls.splice(i,1); setText(ls.join('\n')); moveCursor(i-1); } accept=false; }
  dlgPr.textContent='BLOCK'; dlgHint.textContent='E edit · I insert · D delete';
  if(accept){ const ls=lines(), i=srcLine(S.cursor), ind=(ls[i].match(/^\s*/)||[''])[0];
    ls[i]=(S.res.blocks[S.cursor]&&S.res.blocks[S.cursor].indent?ind:'')+val.trim(); edit(ls.join('\n'),S.cursor,'BLOCK '+nOf(S.cursor)+' STORED'); }
  document.activeElement&&document.activeElement.blur();
}
function insertBlock(){ const ls=lines(); let i=srcLine(S.cursor); if(/^\s*(\d+\s+)?END\s+PGM/i.test(ls[i]||'')) i--;
  ls.splice(i+1,0,''); edit(ls.join('\n'),i+1); S.insertPending=true; beginEdit(); }
function deleteBlock(){ const ls=lines(); if(ls.length<=1) return; const i=srcLine(S.cursor), n=nOf(S.cursor);
  ls.splice(i,1); edit(ls.join('\n'),S.cursor,'BLOCK '+n+' DELETED — CTRL+Z TO UNDO'); }
function copyBlock(){ const ls=lines(), i=srcLine(S.cursor); ls.splice(i+1,0,ls[i]); edit(ls.join('\n'),S.cursor+1,'BLOCK COPIED'); }
dlgIn.addEventListener('keydown',e=>{ if(S.wiz){ if(wizKey(e)) e.preventDefault(); e.stopPropagation(); return; }
  if(S.editing&&(e.key==='Tab'||(e.key==='ArrowRight'&&dlgIn.selectionStart===dlgIn.value.length))&&ghostEl&&ghostEl.dataset.full){ e.preventDefault(); ghostAccept(); e.stopPropagation(); return; }
  if(e.key==='Enter'){ e.preventDefault(); endEdit(true); }
  else if(e.key==='Escape'){ e.preventDefault(); endEdit(false); } e.stopPropagation(); });
function toggleRaw(){
  S.raw=!S.raw; raw.hidden=!S.raw; crt.hidden=S.raw;
  renderSK(); if(S.raw){ raw.value=S.text; raw.focus(); say('RAW TEXT — TAB TO RETURN'); }
  else { if(raw.value!==S.text) edit(raw.value,S.cursor,'PROGRAM RE-COMPILED'); }
}
raw.addEventListener('keydown',e=>{
  if(e.key==='Tab'){ e.preventDefault(); toggleRaw(); }
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){ e.preventDefault(); toggleRaw(); saveH(); }
  e.stopPropagation(); });

/* ================= programs: open / new / delete / restore / save / load ================= */
function uniqueName(base){
  base=(base||'PGM').toUpperCase().replace(/\.H$/,'').replace(/[^A-Z0-9_]/g,'_').slice(0,16)||'PGM';
  let n=base+'.H', k=2; while(pg()[n]!=null){ n=base.slice(0,13)+'_'+k+'.H'; k++; } return n;
}
function openPgm(name){
  if(!name||pg()[name]==null) return;
  if(S.editing) endEdit(false);
  if(S.lesson&&name!==TEMP) endLesson(true);
  S.pgm=name; S.text=pg()[name]; raw.value=S.text; S.cursor=0; closeMgt(); compile(); persist();
  say('PGM '+name+' SELECTED');
  emit('program',{name,machine:S.machine});
}
/* a program handed in from outside (bridge.js: the web app's library). Same name = replaced, not renamed. */
function openExternal(name,text,{machine,tools}={}){
  if(machine&&MACHINES[machine]&&machine!==S.machine) setMachine(machine);
  if(Array.isArray(tools)){ S.tools[S.machine]=tools; }
  const n=String(name||'PGM').toUpperCase().replace(/\.[HI]$/,'').replace(/[^A-Z0-9_]/g,'_').slice(0,16)+'.H';
  if(pg()[n]==null){ pg()[n]=text; touchMeta(n,true); } else pg()[n]=text;
  delete UNDO[S.machine+':'+n]; delete REDO[S.machine+':'+n];
  openPgm(n); return n;
}
function addPgm(name,text,{open=true,project=true}={}){
  const n=uniqueName(name); pg()[n]=text; touchMeta(n,true);
  if(project&&S.active){ const p=S.projects.find(p=>p.id===S.active); if(p&&!p.pgms.some(r=>r.m===S.machine&&r.name===n)) p.pgms.push({m:S.machine,name:n}); }
  persist(); renderProjects(); if(open) openPgm(n); return n;
}
function deletePgm(name){
  if(!name) return;
  if(S.orig[S.machine][name]!=null){ say('BUILT-IN PROGRAM — USE RESTORE ORIGINAL INSTEAD'); return; }
  if(!confirm('Delete '+name+'? This cannot be undone.')) return;
  delete pg()[name]; if(S.meta[S.machine]) delete S.meta[S.machine][name]; S.projects.forEach(p=>p.pgms=p.pgms.filter(r=>!(r.m===S.machine&&r.name===name)));
  if(S.pgm===name){ S.pgm=Object.keys(pg())[0]; S.text=pg()[S.pgm]; compile(); }
  S.mgtSel=Math.min(S.mgtSel,mgtNames().length-1); persist(); renderMgt(); renderProjects(); say(name+' DELETED');
}
function restoreOriginal(name){
  const o=S.orig[S.machine][name]; if(o==null){ say('NOT A BUILT-IN PROGRAM'); return; }
  if(pg()[name]===o){ say(name+' IS ALREADY ORIGINAL'); return; }
  if(S.pgm===name) edit(o,0,name+' RESTORED — CTRL+Z TO UNDO'); else { pg()[name]=o; persist(); say(name+' RESTORED'); }
  if(S.mgt) renderMgt();
}
function listing(text){                                  // numbered TNC listing, one block per line
  const m=M(); let r; try{ r=m.run(text); }catch(e){ return text; }
  return r.blocks.filter(b=>b.kind!=='BLANK').map(b=>b.indent?'  '+b.raw:b.n+' '+b.raw).join('\r\n')+'\r\n';
}
function saveH(){
  if(S.editing) endEdit(true);
  if(S.raw&&raw.value!==S.text) edit(raw.value);
  const name=S.pgm===TEMP?uniqueName('LESSON'):S.pgm;
  download(name,new Blob([listing(S.text)],{type:'text/plain'})); say('SAVED '+name);
}
let fileIn=null;
function loadFromDisk(){
  if(!fileIn){ fileIn=document.createElement('input'); fileIn.type='file'; fileIn.multiple=true; fileIn.accept='.h,.H,.i,.I,.txt,.nc,.zip,.t,.T,.json';
    fileIn.hidden=true; document.body.appendChild(fileIn); fileIn.onchange=()=>{ importFiles([...fileIn.files]); fileIn.value=''; }; }
  fileIn.click();
}
const cleanPgm=t=>String(t).replace(/\r/g,'').split('\n').map(l=>l.replace(/\s*~\s*$/,'')).join('\n').trim();
/* .H / .I programs, a project or profile .zip, a TOOL.T or a profile .json — all land here */
async function importFiles(files){
  if(!files.length) return;
  let last=null, n=0, renamed=0; const texts=[];
  for(const f of files){
    let res;
    try{ res=window.TNC_PROFILE?await TNC_PROFILE.readFile(f):{kind:'programs',files:[{name:f.name,text:await f.text(),machine:null}]}; }
    catch(e){ say('CANNOT READ '+f.name+': '+(e.message||e)); continue; }
    if(res.kind==='profile'){ openProfile(); profImportAsk(res.profile,f.name); return; }
    if(res.kind==='tools'){ mergeTools(res.tools); say('TOOL TABLE '+f.name+' — '+res.tools.length+' TOOLS LOADED'); continue; }
    if(res.kind!=='programs'){ say('UNKNOWN FILE '+f.name); continue; }
    for(const pf of res.files){
      const keep=S.machine; if(pf.machine&&MACHINES[pf.machine]) S.machine=pf.machine;
      const want=uniqueName(pf.name.replace(/\.[^.]+$/,'')), exact=pf.name.toUpperCase().replace(/\.[^.]+$/,'').replace(/[^A-Z0-9_]/g,'_').slice(0,16)+'.H';
      if(want!==exact) renamed++;
      const nm=addPgm(pf.name.replace(/\.[^.]+$/,''),cleanPgm(pf.text),{open:false}); texts.push(pf.text);
      if(S.machine===keep) last=nm; S.machine=keep; n++;
    }
  }
  const added=toolsFor(texts);                     // a program from another control brings its tools along
  if(last) openPgm(last);
  if(n) say(n+' PROGRAM(S) LOADED'+(renamed?' · '+renamed+' RENAMED (NAME TAKEN)':'')+(added?' · '+added+' TOOL(S) ADDED TO YOUR TABLE — CHECK RADII':''));
  if(S.mgt) renderMgt();
}
const colPgm=document.querySelector('.col-pgm');
colPgm.addEventListener('dragover',e=>{ e.preventDefault(); });
colPgm.addEventListener('drop',e=>{ e.preventDefault(); importFiles([...(e.dataTransfer.files||[])]); });
$('b-save').onclick=saveH;

/* ================= PGM MGT ================= */
const mgtEl=$('mgt');
const mgtNames=()=>Object.keys(pg()).filter(n=>n!==TEMP);
function openMgt(){ if(S.tt) closeTT(); if(S.wiz) wizCancel(); if(S.editing) endEdit(false); if(S.raw) toggleRaw(); S.running=false; S.mgt=true;
  S.mgtSel=Math.max(0,mgtNames().indexOf(S.pgm)); plist.hidden=true; $('flow').hidden=true; mgtEl.hidden=false;
  renderMgt(); renderSK(); $('pgm-path').textContent='TNC:\\  PROGRAMS'; setState('PROGRAMS'); showPane('pgm'); }
function closeMgt(){ if(!S.mgt) return; S.mgt=false; mgtEl.hidden=true; plist.hidden=S.flowView&&!!FLOW; $('flow').hidden=!(S.flowView&&FLOW);
  renderSK(); $('pgm-path').textContent='TNC:\\'+S.pgm; setState('READY'); }
function renderMgt(){
  const names=mgtNames();
  mgtEl.innerHTML=`<div class="mhd"><span>FILE NAME</span><span style="text-align:right">BYTES</span><span>STATUS</span><span>PROJECT</span></div>`+
    names.map((n,i)=>{ const t=pg()[n], o=S.orig[S.machine][n];
      const st=(n===S.pgm?'S':' ')+(o==null?'+':(t!==o?'*':' '));
      const pj=S.projects.filter(p=>p.pgms.some(r=>r.m===S.machine&&r.name===n)).map(p=>p.name).join(', ')||'—';
      return `<div class="mrow${i===S.mgtSel?' sel':''}" data-i="${i}"><span>${esc(n)}</span><span class="by">${t.length}</span><span class="st">${st}</span><span class="pj">${esc(pj)}</span></div>`; }).join('')+
    `<div class="mft">TNC:\\ · ${M().label} · ${names.length} FILES · S SELECTED · * MODIFIED · + YOURS<br>`+
    `↑ ↓ SELECT · ENT OPEN · N NEW · L LOAD FROM PC · R RESTORE ORIGINAL · DEL DELETE · ESC BACK<br>`+
    `DROP .H FILES ANYWHERE ON THIS PANEL TO LOAD THEM</div>`;
  const sel=mgtEl.querySelector('.mrow.sel'); if(sel) sel.scrollIntoView({block:'nearest'});
}
mgtEl.addEventListener('click',e=>{ const r=e.target.closest('.mrow'); if(!r) return;
  const i=+r.dataset.i; if(i===S.mgtSel) openPgm(mgtNames()[i]); else { S.mgtSel=i; renderMgt(); } });
function mgtKey(e){
  const n=mgtNames().length, k=e.key;
  if(k==='ArrowUp'){ e.preventDefault(); S.mgtSel=(S.mgtSel-1+n)%n; renderMgt(); }
  else if(k==='ArrowDown'){ e.preventDefault(); S.mgtSel=(S.mgtSel+1)%n; renderMgt(); }
  else if(k==='Enter'){ e.preventDefault(); openPgm(mgtNames()[S.mgtSel]); }
  else if(k==='Escape'||k==='m'||k==='M'){ e.preventDefault(); closeMgt(); }
  else if(k==='n'||k==='N'){ e.preventDefault(); closeMgt(); openNew(); }
  else if(k==='l'||k==='L'){ e.preventDefault(); loadFromDisk(); }
  else if(k==='r'||k==='R'){ e.preventDefault(); restoreOriginal(mgtNames()[S.mgtSel]); }
  else if(k==='Delete'||k==='Backspace'||k==='d'||k==='D'){ e.preventDefault(); deletePgm(mgtNames()[S.mgtSel]); }
}
$('b-mgt').onclick=()=>S.mgt?closeMgt():openMgt();

/* ================= projects ================= */
function renderProjects(){
  const act=S.projects.find(p=>p.id===S.active);
  $('proj-t').textContent=S.projects.length+(act?' · '+act.name:'');
  $('proj').innerHTML=S.projects.length?S.projects.map(p=>`<div class="prow${p.id===S.active?' on':''}">
      <input type="radio" name="proj" value="${p.id}"${p.id===S.active?' checked':''} aria-label="Make ${esc(p.name)} active">
      <span class="nm" title="${esc(p.name)}">${esc(p.name)}</span><span class="ct">${p.pgms.length} PGM</span>
      <span><button data-zip="${p.id}" title="Download as .zip">ZIP</button> <button data-del="${p.id}" title="Delete project" aria-label="Delete project">×</button></span></div>`).join('')
    :'<p class="note">No projects yet. Create one and every program you make lands in it.</p>';
}
$('proj').addEventListener('change',e=>{ if(e.target.name==='proj'){ S.active=e.target.value; persist(); renderProjects(); } });
$('proj').addEventListener('click',e=>{
  const z=e.target.closest('[data-zip]'), d=e.target.closest('[data-del]');
  if(z) zipProject(z.dataset.zip);
  if(d){ const p=S.projects.find(p=>p.id===d.dataset.del); if(p&&confirm('Delete project "'+p.name+'"? Its programs stay on the control.')){
    S.projects=S.projects.filter(x=>x!==p); if(S.active===p.id) S.active=(S.projects[0]||{}).id||null; persist(); renderProjects(); if(S.mgt) renderMgt(); } }
});
$('b-proj-new').onclick=()=>{ const inp=$('proj-name'), name=inp.value.trim()||('PROJECT '+(S.projects.length+1));
  const p={id:Date.now().toString(36),name:name.slice(0,40),created:new Date().toISOString(),pgms:[]};
  S.projects.push(p); S.active=p.id; inp.value=''; persist(); renderProjects(); say('PROJECT "'+p.name+'" ACTIVE'); };
$('proj-name').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('b-proj-new').click(); } e.stopPropagation(); });
$('b-proj-add').onclick=()=>addToProject(S.pgm);
function addToProject(name){
  const p=S.projects.find(p=>p.id===S.active); if(!p){ say('CREATE A PROJECT FIRST'); return; }
  if(!name||name===TEMP){ say('NOTHING TO ADD'); return; }
  if(p.pgms.some(r=>r.m===S.machine&&r.name===name)){ say(name+' IS ALREADY IN '+p.name); return; }
  p.pgms.push({m:S.machine,name}); persist(); renderProjects(); if(S.mgt) renderMgt(); say(name+' ADDED TO '+p.name);
}
function zipProject(id){
  const p=S.projects.find(p=>p.id===id); if(!p) return;
  if(!window.JSZip){ say('ZIP LIBRARY MISSING FROM THIS BUILD'); return; }
  const z=new JSZip(), keep=S.machine, names=[];
  p.pgms.forEach(r=>{ const t=(S.pgms[r.m]||{})[r.name]; if(t==null) return;
    const prev=S.machine; S.machine=r.m; const lst=listing(t); S.machine=prev;
    z.file((r.m!=='426'?'TNC'+r.m+'/':'')+r.name,lst); names.push(r.name+'  ('+(MACHINES[r.m]||{}).label+')'); });
  S.machine=keep;
  z.file('README.txt',[p.name,'Exported '+new Date().toISOString().slice(0,16).replace('T',' ')+' from the TNC 426 Simulator','',
    'Programs:',...names.map(n=>'  '+n),'','Numbered TNC listing format, CRLF line ends.',
    'Simulator output only - prove out any program on the real machine the usual way.','',
    '(c) 2026 TNC 426 Simulator contributors'].join('\r\n'));
  z.generateAsync({type:'blob'}).then(b=>{ download(p.name.replace(/[^\w.-]+/g,'_')+'.zip',b); say('PROJECT ZIP SAVED — '+names.length+' PROGRAM(S)'); });
}

/* ================= flow view (flow.js) ================= */
let FLOW=null;
function flowUpdate(){ if(FLOW&&S.flowView&&S.res) try{ FLOW.update(S.res,S.ex); flowHighlight(); }catch(e){} }
function flowHighlight(){ if(FLOW&&S.flowView) try{ FLOW.highlight(S.running?S.execB:S.cursor); }catch(e){} }
function toggleFlow(){
  if(!window.TNC_FLOW){ say('FLOW VIEW IS NOT IN THIS BUILD YET'); return; }
  if(!FLOW){ try{ FLOW=TNC_FLOW.create($('flow'),{}); FLOW.onSelect=i=>{ moveCursor(i); const s=S.segs.find(x=>x.block===i); if(s&&!S.running) seek(s.t0+1e-6,false); }; }
    catch(e){ say('FLOW VIEW FAILED TO START'); return; } }
  S.flowView=!S.flowView; if(S.mgt) closeMgt();
  plist.hidden=S.flowView; $('flow').hidden=!S.flowView; $('b-view').setAttribute('aria-pressed',S.flowView);
  $('b-view').textContent=S.flowView?'Listing':'Flow'; if(S.flowView) flowUpdate(); writePrefs(); showPane('pgm'); renderSK();
}
$('b-view').onclick=toggleFlow;
if(!window.TNC_FLOW) $('b-view').hidden=true;

/* ================= lessons: the coach ================= */
const coach=$('coach');
{ const tp=document.querySelector('.tp'), sc=tp&&tp.querySelector('.scrub'); if(tp) tp.insertBefore(coach,sc?sc.nextSibling:tp.firstChild); }   // the lesson text replaces the run controls, never the 3-D view
function lessonsOf(){ return M().lessons||window.TNC_LESSONS||null; }
function stepsFor(kind,L){
  if(kind==='learn') return L.steps.map(s=>({say:s.say,program:s.program,focus:s.focus,run:s.run}));
  return [
    {say:`**${L.title}**\n\n${L.blurb}\n\nPress **Next**: it runs, and you watch.`,program:L.broken,focus:null,run:false},
    {say:L.story+(L.silentNote?'\n\n'+L.silentNote:''),program:null,focus:null,run:true},
    {say:'**Why it happened**\n\n'+L.why,program:null,focus:null,run:false},
    {say:'**The fix** — loaded and running now.',program:L.fix,focus:null,run:true},
    {say:'**The rule**\n\n'+L.rule,program:null,focus:null,run:false}];
}
function startLesson(kind,idx){
  const Ls=lessonsOf(); if(!Ls) return; const L=(kind==='learn'?Ls.learn:Ls.breakit)[idx]; if(!L) return;
  closeModal(); if(S.mgt) closeMgt();
  S.lesson={kind,idx,L,steps:stepsFor(kind,L),i:0,prev:S.lesson?S.lesson.prev:S.pgm};
  coach.hidden=false; document.querySelector('.tp').classList.add('lesson'); $('coach-k').textContent=kind==='learn'?'LEARN':'BREAK IT';
  $('coach-k').style.color=kind==='learn'?'var(--mint)':'var(--red)'; $('coach-t').textContent=L.title;
  coachStep(0); showPane('gfx');
}
function coachStep(i){
  const Ls=S.lesson; if(!Ls) return; i=clamp(i,0,Ls.steps.length-1); Ls.i=i; const st=Ls.steps[i];
  if(st.program){ pg()[TEMP]=st.program; S.pgm=TEMP; S.text=st.program; raw.value=S.text; S.cursor=0; compile(); }
  S.focus=st.focus||null;
  if(S.focus&&S.focus.length){ const bi=S.res.blocks.findIndex(b=>b.n===S.focus[0]&&!b.indent); if(bi>=0) S.cursor=bi; }
  markRows();
  $('coach-bd').innerHTML=md(st.say); $('coach-bd').scrollTop=0;
  $('coach-pg').textContent=(i+1)+' / '+Ls.steps.length;
  $('coach-back').disabled=i===0; $('coach-next').textContent=i===Ls.steps.length-1?'Finish':'Next';
  if(st.run){ reset(); if(S.speed===0) setSpeed(16,true); start(); } else if(st.program){ reset(); }
}
function endLesson(silent){
  if(!S.lesson) return; const prev=S.lesson.prev; S.lesson=null; S.focus=null; coach.hidden=true; document.querySelector('.tp').classList.remove('lesson');
  delete pg()[TEMP]; if(!silent){ S.pgm=pg()[prev]!=null?prev:Object.keys(pg())[0]; S.text=pg()[S.pgm]; raw.value=S.text; S.cursor=0; compile(); }
}
$('coach-x').onclick=()=>endLesson(false);
$('coach-back').onclick=()=>coachStep(S.lesson.i-1);
$('coach-next').onclick=()=>{ if(S.lesson.i>=S.lesson.steps.length-1){ endLesson(false); say('LESSON DONE'); } else coachStep(S.lesson.i+1); };

/* ================= modals ================= */
let openModalEl=null;
function openModal(id){ closeModal(); const m=$(id); m.hidden=false; openModalEl=m; S.running=false;
  const f=m.querySelector('[data-close]'); f&&f.focus(); }
function closeModal(){ if(openModalEl){ openModalEl.hidden=true; openModalEl=null; } }
document.querySelectorAll('.modal').forEach(m=>{
  m.addEventListener('click',e=>{ if(e.target===m||e.target.closest('[data-close]')) closeModal(); });
});

/* ---------- HELP ---------- */
let helpTab='learn';
function openHelp(tab){ helpTab=tab||helpTab; openModal('m-help'); renderHelp(); }
$('help-tabs').addEventListener('click',e=>{ const b=e.target.closest('[data-tab]'); if(b){ helpTab=b.dataset.tab; renderHelp(); } });
function renderHelp(){
  [...$('help-tabs').children].forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===helpTab));
  const Ls=lessonsOf(), body=$('help-body');
  if(helpTab==='ai'){ body.innerHTML=aiSetupHTML(); wireAiSetup(); return; }
  if(!Ls){ body.innerHTML='<div class="prose"><p>Lessons are not in this build.</p></div>'; return; }
  if(helpTab==='learn'||helpTab==='break'){
    const list=helpTab==='learn'?Ls.learn:Ls.breakit, kind=helpTab==='learn'?'learn':'breakit';
    body.innerHTML=`<div class="prose" style="margin-bottom:12px">${helpTab==='learn'
      ?'<p>Each lesson loads its own program, highlights the blocks it talks about and runs the machine for you. Your programs are left alone.</p>'
      :'<p>Eight famous ways to wreck a machine — crashed safely here, then fixed. The crash alarms are the <strong>simulator\'s</strong> checks; a real TNC 426 had no collision checking in its test graphics.</p>'}</div>`+
      `<div class="lgrid">${list.map((L,i)=>`<button class="lcard ${helpTab==='learn'?'learn':'break'}" data-i="${i}"><span class="n">${helpTab==='learn'?'LESSON':'PITFALL'} ${i+1}</span><span class="t">${esc(L.title)}</span><span class="b">${esc(L.blurb||'')}</span></button>`).join('')}</div>`;
    body.onclick=e=>{ const c=e.target.closest('.lcard'); if(c) startLesson(kind,+c.dataset.i); };
    return;
  }
  body.onclick=null;
  body.innerHTML='<div class="prose help-manual">'+(Ls.manual||[]).map(sec=>`<details><summary>${esc(sec.title)}</summary>${md(sec.body)}`+
    (sec.rows&&sec.rows.length?`<div class="tblw"><table><thead><tr>${sec.rows[0].map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
      sec.rows.slice(1).map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'')+'</details>').join('')+'</div>';
}
$('b-help').onclick=()=>openHelp();

/* ---------- AI setup + generation (ai.js) ---------- */
const AI=window.TNC_AI||null;
function getKey(){ return sess.get(KEY_LS)||local.get(KEY_LS)||window.TNC_AI_LOCAL_KEY||(window.TNC_AI_API?'server':''); }   // last: .env, local build only
function getModel(){ return local.get(MODEL_LS)||(AI?AI.DEFAULT_MODEL:'deepseek/deepseek-v4.1-flash'); }
function keyPill(){ const p=$('ai-keypill'), k=getKey(); p.textContent=k?(k==='server'&&window.TNC_AI_API?'key on the server':k===window.TNC_AI_LOCAL_KEY&&!sess.get(KEY_LS)&&!local.get(KEY_LS)?'key from .env':'key set'):'no key'; p.className='pill '+(k?'ok':'no'); }
function aiSetupHTML(){
  const k=getKey(), rem=!!local.get(KEY_LS);
  return `<div class="prose">
<h4>The third way to make a program: let an AI write it</h4>
<p>This uses <strong>OpenRouter</strong>, one account that reaches many AI models. You pay OpenRouter directly — this page has no server, never sees your money, and never sees your key except to send it straight to OpenRouter.</p>
<p>Default model: <code>deepseek/deepseek-v4.1-flash</code> (DeepSeek V4.1 Flash). At about US$0.035 per million tokens in and $0.29 out (OpenRouter, September 2026), one program costs a small fraction of a US cent.</p>${window.TNC_AI_LOCAL_KEY?'<p><span class="pill ok">local build</span> A key from <code>.env</code> is built into this copy. It is never in the public page.</p>':''}
<h4>Set it up — five minutes</h4>
<ol>
<li>Create an account at <code>openrouter.ai</code>.</li>
<li>Buy a little credit on the <strong>Credits</strong> page. $5 is thousands of programs.</li>
<li>On the <strong>Keys</strong> page, create a key and <strong>give it a credit limit</strong> (say $2). If the key ever leaks, that is all it can spend.</li>
<li>Copy the key, paste it below and press <strong>Test key</strong>.</li>
<li>Press <strong>+ New</strong> → <strong>Describe a part</strong>, say what you want, press <strong>Generate</strong>. The simulator checks the result; if it fails, the errors go back to the AI once for a fix.</li>
</ol>
<h4>Where your key and your words go</h4>
<div class="warnbox"><ul>
<li>The key stays in this browser: only for this tab unless you tick <strong>Remember</strong>, then in this browser's storage until you press <strong>Forget key</strong>.</li>
<li>It is sent only to <code>openrouter.ai</code>, with each request — never to GitHub, never in a cookie.</li>
<li>Your description and the generated program go to OpenRouter and the model's provider. Don't paste anything confidential.</li>
<li>Every site under <code>gigacook.github.io</code> shares browser storage. A remembered key can be read by any page there — keep the credit limit on it.</li>
</ul></div>
<p>The AI's program is <strong>simulator output</strong>. Never run it on a real machine without proving it out the normal way.</p>
</div>
<div class="fgrid" style="max-width:760px">
<label class="fld wide"><span>OPENROUTER API KEY</span><input id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="your OpenRouter key" value="${esc(k)}"></label>
<label class="fld chk wide"><input type="checkbox" id="ai-remember"${rem?' checked':''}> Remember the key in this browser</label>
</div>
<div class="actrow"><button class="cbtn pri" id="ai-test">Test key</button><button class="cbtn" id="ai-savekey">Save</button><button class="cbtn" id="ai-forget">Forget key</button></div>
<div class="aistat" id="ai-setstat" hidden></div>
<div id="ai-setup-mp" style="max-width:980px;margin-top:18px"></div>`;
}
function storeKey(k,rem){ sess.del(KEY_LS); local.del(KEY_LS); if(k){ if(rem) local.set(KEY_LS,k); else sess.set(KEY_LS,k); } keyPill(); }
function wireAiSetup(){
  mpMount($('ai-setup-mp'));
  const st=$('ai-setstat'), put=(h)=>{ st.hidden=false; st.innerHTML=h; };
  $('ai-savekey').onclick=()=>{ storeKey($('ai-key').value.trim(),$('ai-remember').checked);
    put('<span class="ok">Saved.</span> '+($('ai-remember').checked?'Remembered in this browser.':'Kept for this tab only.')); };
  $('ai-forget').onclick=()=>{ storeKey('',false); $('ai-key').value=''; put('<span class="ok">Key forgotten</span> — removed from this browser.'); };
  $('ai-test').onclick=async()=>{
    const k=$('ai-key').value.trim(); if(!k){ put('<span class="bad">Paste a key first.</span>'); return; }
    if(!AI){ put('<span class="bad">The AI module is not in this build.</span>'); return; }
    storeKey(k,$('ai-remember').checked); put('<span class="dim">Checking the key with OpenRouter…</span>');
    try{ const d=await AI.testKey(k);
      const lim=d.limit==null?'no limit set — add one on the Keys page':'$'+(+d.limit).toFixed(2)+' limit';
      put(`<span class="ok">Key works.</span> ${esc(d.label||'')}\nUsed so far: $${(+(d.usage||0)).toFixed(4)} · ${esc(lim)}`); }
    catch(e){ put('<span class="bad">'+esc(aiErr(e))+'</span>'); }
  };
}
function aiErr(e){
  if(e.status===401) return 'KEY REJECTED — check it on the OpenRouter Keys page and paste it again.';
  if(e.status===402) return 'OUT OF CREDIT — top up on the OpenRouter Credits page, or raise the key\'s limit.';
  if(e.status===429) return 'RATE LIMITED — wait a minute and try again.';
  if(e.status===404) return 'MODEL NOT FOUND — check the model name in AI setup. ('+e.message+')';
  if(e.name==='AbortError') return 'CANCELLED.';
  return (e.status?'HTTP '+e.status+': ':'NETWORK: ')+e.message;
}
function verifyProgram(src){
  const m=M(); let r,ex,ev=[];
  try{ r=m.run(src); ex=m.expand(r); ev=m.analyse(r,ex)||[]; }catch(e){ return {ok:false,text:'INTERNAL ERROR: '+e.message,errs:[e.message],crashes:[],warns:[]}; }
  const nb=i=>r.blocks[i]&&r.blocks[i].n!=null?r.blocks[i].n:'?';
  const errs=r.errors.map(e=>`BLOCK ${nb(e.block)}: ${e.msg}`);
  const crashes=ev.filter(e=>e.sev==='crash').map(e=>`BLOCK ${nb(e.block)}: ${e.msg}`);
  const warns=ev.filter(e=>e.sev==='warn').map(e=>`BLOCK ${nb(e.block)}: ${e.msg}`);
  if(!r.moves.length) errs.push('THE PROGRAM MAKES NO MOVES');
  return {ok:!errs.length&&!crashes.length,errs,crashes,warns,moves:r.moves.length,
    text:[...errs,...crashes,...warns].join('\n'), name:(/BEGIN\s+PGM\s+(\w+)/i.exec(src)||[])[1]};
}
let aiAbort=null;
/* ================= AI generation, live: the dialog closes, the program appears block by block in the listing,
   the path grows in 3-D, the run pane shows progress, the exact request and every repair round ================= */
const AI_LIVE='AI_LIVE.H';
function aiLiveEl(){ let el=$('ailive'); if(el) return el;
  el=document.createElement('div'); el.id='ailive'; el.className='coach ailive'; el.hidden=true;
  const tp=document.querySelector('.tp'), sc=tp.querySelector('.scrub'); tp.insertBefore(el,sc?sc.nextSibling:tp.firstChild); return el; }
function aiLiveOpen(){ const el=aiLiveEl(); el.hidden=false; document.querySelector('.tp').classList.add('lesson'); S.aiLive={log:[],reqs:[],prevPgm:S.pgm,t0:Date.now(),lastCompile:0}; aiLiveRender(); }
function aiLiveClose(){ const el=$('ailive'); if(el) el.hidden=true; if(!S.lesson) document.querySelector('.tp').classList.remove('lesson');
  if(pg()[AI_LIVE]!=null){ delete pg()[AI_LIVE]; } S.aiLive=null; renderSK(); }
function aiLiveRender(p){
  const L=S.aiLive, el=$('ailive'); if(!L||!el) return;
  const kc=n=>n<1000?n+' chars':(n/1000).toFixed(1)+'k chars';
  const line=p?(p.stage==='thinking'?`<span class="ai-spin"></span> Thinking… ${Math.round(p.secs)} s · ${kc(p.reasoningChars||0)} of reasoning`
    :`<span class="ai-spin"></span> Writing the program… ${Math.round(p.secs)} s · ${kc(p.chars||0)} · ${S.res&&S.res.blocks?S.res.blocks.length:0} blocks so far`):(L.done?'':'<span class="ai-spin"></span> Sending…');
  el.innerHTML=`<div class="coach-hd"><span class="k" style="color:#ff7ac8">AI</span><span class="t">${esc(getModel())} · ${esc(L.mode==='modify'?'changing '+L.prevPgm:'new program')}</span></div>
    <div class="coach-bd"><div class="ailine">${line}</div>${p&&p.stage==='thinking'&&p.reasoningTail?`<div class="aithink">${esc(p.reasoningTail.slice(-220))}</div>`:''}
    <div class="ailog">${L.log.map(x=>`<div>${x}</div>`).join('')}</div></div>
    <div class="coach-ft"><button class="cbtn" id="ai-req">Request (${L.reqs.length})</button>${L.done?'<button class="cbtn pri" id="ai-close">Close</button>':'<button class="cbtn" id="ai-cancel">Cancel</button>'}</div>`;
  $('ai-req').onclick=aiShowRequest;
  if($('ai-cancel')) $('ai-cancel').onclick=()=>{ if(aiAbort) aiAbort.abort(); };
  if($('ai-close')) $('ai-close').onclick=aiLiveClose;
  const lg=el.querySelector('.ailog'); if(lg) lg.scrollTop=lg.scrollHeight;
}
function aiLog(h){ if(S.aiLive){ S.aiLive.log.push(h); aiLiveRender(S.aiLive.lastP); } }
/* the program so far: from the fence or BEGIN PGM, complete lines only */
function aiPartial(text){
  let t=String(text||''), i=t.search(/```[a-z]*\s*\n/i); if(i>=0) t=t.slice(t.indexOf('\n',i)+1); else { const b=t.search(/BEGIN\s+PGM/i); if(b<0) return ''; t=t.slice(b); }
  t=t.replace(/```[\s\S]*$/,''); const cut=t.lastIndexOf('\n'); return cut>0?t.slice(0,cut):'';
}
function aiLiveProgram(src){
  if(!src||!S.aiLive) return; const now=Date.now(); if(now-S.aiLive.lastCompile<700) return; S.aiLive.lastCompile=now;
  if(S.mode!=='test') setMode('test');
  pg()[AI_LIVE]=src; S.pgm=AI_LIVE; S.text=src; raw.value=src; compile();
  S.cursor=Math.max(0,S.res.blocks.length-1); markRows(true); seek(S.total,false);      // the path so far, the tool at its end
}
function aiShowRequest(){
  const L=S.aiLive; if(!L||!L.reqs.length){ say('NO REQUEST SENT YET'); return; }
  let m=$('m-aireq'); if(!m){ m=document.createElement('div'); m.className='modal'; m.id='m-aireq'; m.hidden=true;
    m.innerHTML='<div class="mcard dev" role="dialog" aria-modal="true"><div class="mhead"><span class="mt">AI request — exactly what goes to OpenRouter (key not shown)</span><button class="x" data-close>Close <small>ESC</small></button></div><div class="mbody"><pre id="aireq-pre" style="white-space:pre-wrap"></pre></div></div>';
    document.body.appendChild(m); m.addEventListener('click',e=>{ if(e.target===m||e.target.closest('[data-close]')) closeModal(); }); }
  $('aireq-pre').textContent=L.reqs.map((b,i)=>`=== ROUND ${i+1}${i?' (repair: the simulator\'s errors go back to the model)':''} ===\nPOST https://openrouter.ai/api/v1/chat/completions\n`+JSON.stringify(b,null,2)).join('\n\n');
  openModal('m-aireq');
}
async function aiGenerate(){
  const out=$('ai-stat'), prompt=$('ai-prompt').value.trim(), key=getKey();
  const flog=(h)=>{ out.hidden=false; out.innerHTML+=h+'\n'; out.scrollTop=out.scrollHeight; };
  out.innerHTML='';
  if(!AI){ flog('<span class="bad">The AI module is not in this build.</span>'); return; }
  if(!key){ flog('<span class="bad">No key yet.</span> Open <b>AI setup</b> first — it takes five minutes.'); return; }
  if(prompt.length<8){ flog('<span class="bad">Describe the part in a sentence or two.</span>'); return; }
  const mc=M().machine, sys=(AI.system?AI.system(mtools()):AI.FALLBACK_SYSTEM)+(mc?`\n\nTHIS MACHINE (${M().label}): spindle max S${mc.sMax}, feed max F${mc.fMax}, rotary axes B ${mc.limits.B.join('..')} deg and A ${mc.limits.A.join('..')} deg (swivel head; B+ tilts the tip to X+, A+ to Y+).
For tilted machining use CYCL DEF 19.0 WORKING PLANE / CYCL DEF 19.1 A+.. B+.. C+0 (it also positions the head); reset with 19.1 A+0 B+0 C+0. Never use M128.`:'');
  const modify=S.aiMode==='modify', before=S.text, beforePgm=S.pgm;
  const full=modify?'Here is the current program:\n```klartext\n'+S.text+'\n```\nChange it as follows: '+prompt+'\nKeep everything else as it is. Return the COMPLETE changed program.':prompt;
  closeModal(); if(S.editing) endEdit(false); if(S.mgt) closeMgt(); if(S.tt) closeTT();
  aiLiveOpen(); S.aiLive.mode=modify?'modify':'new'; aiAbort=new AbortController(); showPane('gfx');
  aiLog(`<span class="dim">${esc(getModel())} · thinking ${esc(aiThink())} · max ${aiMaxTok()} tokens · ${esc(M().label)}</span>`);
  let res=null;
  try{
    res=await AI.generate({key,model:getModel(),prompt:full,system:sys,verify:verifyProgram,signal:aiAbort.signal,maxRepairs:1,
      reasoning:aiThink()==='default'?undefined:aiThink(), maxTokens:aiMaxTok(),
      onStep:s=>{
        if(s.phase==='request'){ S.aiLive.reqs.push(s.body); aiLog(s.attempt?'<b>Round 2</b> — the simulator\'s errors went back to the model for one repair (see Request).':'<b>Round 1</b> — request sent (see Request).'); }
        if(s.phase==='progress'){ S.aiLive.lastP=s; aiLiveRender(s); aiLiveProgram(aiPartial(s.text)); }
        if(s.phase==='checked'){ const r=s.report;
          aiLog(r.ok?`<span class="ok">Checked: ${r.moves} moves, no errors, no crashes${r.warns.length?', '+r.warns.length+' warning(s)':''}.</span>`
                  :`<span class="bad">Checked: ${r.errs.length} error(s), ${r.crashes.length} crash(es):</span><pre style="margin:2px 0 0;white-space:pre-wrap">${esc(r.text)}</pre>`); } }});
  }catch(e){ aiLog('<span class="bad">'+esc(aiErr(e))+'</span>'); }
  delete pg()[AI_LIVE];
  if(res){
    let nm;
    if(modify){ nm=beforePgm; S.pgm=beforePgm; S.text=before; raw.value=before; if(S.mode!=='edit') setMode('edit'); edit(res.src,0,'AI CHANGED '+nm+' — CTRL+Z UNDOES IT'); }
    else nm=addPgm((res.report.name||'AI_PART'),res.src,{open:true});
    download(nm,new Blob([listing(res.src)],{type:'text/plain'}),'AI-GEN');
    aiLog(`<span class="${res.report.ok?'ok':'bad'}">${res.report.ok?(modify?'Changed':'Saved'):'Done — still has problems, see Checks'} ${modify?'':'as '}${esc(nm)} · also saved to TNC-SIMULATOR/AI-GEN.</span> Cost about $${(res.cost||0).toFixed(4)} · ${Math.round((Date.now()-S.aiLive.t0)/1000)} s.`);
    if(res.report.ok){ setMode('test'); reset(); if(S.speed===0) setSpeed(16,true); start(); }         // and it runs
  } else { S.pgm=beforePgm; S.text=pg()[beforePgm]; raw.value=S.text; compile(); }
  if(S.aiLive){ S.aiLive.done=true; S.aiLive.lastP=null; aiLiveRender(); }
  aiAbort=null;
}
/* thinking effort and the answer cap: a budget guard for slow reasoning models */
function aiThink(){ return local.get('tnc426.aithink')||'low'; }
function aiMaxTok(){ return +(local.get('tnc426.aimaxtok')||12000); }

/* ---------- NEW PROGRAM ---------- */
function openNew(which){
  openModal('m-new'); $('new-opts').hidden=true; $('new-scratch').hidden=true; $('new-ai').hidden=true;
  if(which!=='ai'){ S.aiMode='new'; $('m-new-t').textContent='New program'; }
  $('ns-tool').innerHTML=mtools().map(t=>`<option value="${t.t}"${t.t===4?' selected':''}>T${t.t} ${esc(t.name)} (R${t.r})</option>`).join('');
  keyPill(); newGo(which||'scratch');
}
/* ================= MODEL PICKER — one catalogue (TNC_AI.listModels): the recommended model, frontier quick picks
   computed from OpenRouter's live list, a sortable / filterable table (↑↓ Enter Esc), and any id typed by hand.
   The pick is stored under MODEL_LS in this browser (as before); every request uses getModel(). ================= */
const MP={cat:null,sort:'created',dir:-1,q:'',prov:'',act:0,rows:[]};
const MP_COLS=[['name','Model'],['provider','Provider'],['context','Context'],['pin','$/M in'],['pout','$/M out']];
/* prices: US$ per million tokens. Table: fixed decimals so the column lines up; cards and chips: trailing zeros dropped */
const mpUsd=(v,col)=>{ if(v==null) return '—'; if(v===0) return 'free'; const t=v<0.1?v.toFixed(3):col||v<100?v.toFixed(2):v.toFixed(0); return '$'+(col?t:t.replace(/\.0+$|(\.\d*[1-9])0+$/,'$1')); };
const mpCtx=n=>!n?'—':n>=1e6?+(n/1e6).toFixed(1)+'M':Math.round(n/1000)+'K';
const mpProvName=p=>AI&&AI.providerName?AI.providerName(p):p;
const mpMeta=m=>`<span>${mpCtx(m.context)} context</span><span>${mpUsd(m.pin)} in</span><span>${mpUsd(m.pout)} out</span><small>per M tokens</small>`;
const MP_ID=/^[\w.-]+\/[\w.:~-]+$/;
/* fuzzy: each query word matches as a substring, or as its letters in order within a short span ("gmn 3" → gemini-3) */
function mpFuzzy(hay,t){ if(hay.includes(t)) return true;
  for(let s=hay.indexOf(t[0]);s>=0;s=hay.indexOf(t[0],s+1)){ let j=s,k=0; while(j<hay.length&&k<t.length){ if(hay[j]===t[k]) k++; j++; } if(k===t.length&&j-s<=t.length*3) return true; }
  return false; }
function mpRows(){
  const L=(MP.cat&&MP.cat.models)||[], toks=MP.q.toLowerCase().split(/\s+/).filter(Boolean), k=MP.sort, d=MP.dir;
  const r=L.filter(m=>{ if(MP.prov&&m.provider!==MP.prov) return false; const h=m._h||(m._h=(m.name+' '+m.id+' '+mpProvName(m.provider)).toLowerCase()); return toks.every(t=>mpFuzzy(h,t)); });
  return r.sort((a,b)=>{ let x=a[k], y=b[k]; if(k==='provider'){ x=mpProvName(x); y=mpProvName(y); }
    if(x==null||y==null) return (x==null)-(y==null)||b.created-a.created;                 // unknown price / context last, either way
    return (typeof x==='string'?x.localeCompare(y,undefined,{sensitivity:'base'}):x-y)*d||b.created-a.created; });
}
function mpMount(root){
  if(!root) return;
  if(root.dataset.mp){ mpTop(root); mpLoad(root); return; }
  root.dataset.mp='1'; root.classList.add('mp');
  root.innerHTML=`<div class="mp-top"></div>
  <div class="mp-bar"><button type="button" class="mp-all" aria-expanded="false">All models <span class="mp-cnt"></span><span class="mp-car">▾</span></button>
    <input class="mp-id" spellcheck="false" autocomplete="off" placeholder="…or type any OpenRouter id: provider/model" aria-label="Model id">
    <button type="button" class="mp-use">Use id</button></div>
  <div class="mp-pal" hidden>
    <div class="mp-tools"><input class="mp-q" spellcheck="false" autocomplete="off" placeholder="Filter — name or provider" aria-label="Filter models">
      <select class="mp-prov" aria-label="Provider"><option value="">All providers</option></select><span class="mp-n"></span></div>
    <div class="mp-scroll"><table class="mp-t"><colgroup><col class="c-n"><col class="c-p"><col class="c-x"><col class="c-i"><col class="c-o"></colgroup>
      <thead><tr>${MP_COLS.map(([k,l])=>`<th data-s="${k}"${k==='name'||k==='provider'?'':' class="num"'}><button type="button">${l}<i></i></button></th>`).join('')}</tr></thead><tbody></tbody></table></div>
    <div class="mp-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> pick <kbd>Esc</kbd> close <span>·</span> click a column to sort; again reverses, a third time goes back to newest first</div>
  </div>`;
  const q=root.querySelector('.mp-q'), pal=root.querySelector('.mp-pal'), idf=root.querySelector('.mp-id');
  root.addEventListener('click',e=>{
    const pk=e.target.closest('[data-pick]'); if(pk){ mpPick(root,pk.dataset.pick); return; }
    const tr=e.target.closest('tbody tr[data-i]'); if(tr){ mpPick(root,MP.rows[+tr.dataset.i].id,true); return; }
    const th=e.target.closest('th[data-s]'); if(th){ const s=th.dataset.s, d0=s==='context'?-1:1;
      if(MP.sort!==s){ MP.sort=s; MP.dir=d0; } else if(MP.dir===d0) MP.dir=-d0; else { MP.sort='created'; MP.dir=-1; }
      MP.act=0; root.querySelector('.mp-scroll').scrollTop=0; mpTable(root); q.focus(); return; }
    if(e.target.closest('.mp-all')) mpOpen(root,pal.hidden);
    if(e.target.closest('.mp-use')) mpUseId(root);
  });
  q.addEventListener('input',()=>{ MP.q=q.value; MP.act=0; mpTable(root); });
  root.querySelector('.mp-prov').onchange=e=>{ MP.prov=e.target.value; MP.act=0; mpTable(root); q.focus(); };
  q.addEventListener('keydown',e=>{ const k=e.key, n=MP.rows.length;
    if(k==='ArrowDown'||k==='ArrowUp'||k==='PageDown'||k==='PageUp'){ e.preventDefault(); if(!n) return;
      const st=k==='ArrowDown'?1:k==='ArrowUp'?-1:k==='PageDown'?10:-10; MP.act=Math.max(0,Math.min(n-1,MP.act+st)); mpAct(root); }
    else if(k==='Enter'){ e.preventDefault(); if(n) mpPick(root,MP.rows[MP.act].id,true); else if(MP_ID.test(q.value.trim())) mpPick(root,q.value.trim(),true); }
    else if(k==='Escape'){ e.preventDefault(); e.stopPropagation(); if(q.value){ q.value=''; MP.q=''; MP.act=0; mpTable(root); } else mpOpen(root,false); }
  });
  idf.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); mpUseId(root); } });
  mpTop(root); mpLoad(root);
}
function mpLoad(root){
  if(!AI||!AI.listModels) return;
  AI.listModels().then(cat=>{ const changed=!MP.cat||MP.cat.live!==cat.live; MP.cat=cat; if(!root.isConnected) return;
    const provs={}; cat.models.forEach(m=>provs[m.provider]=(provs[m.provider]||0)+1);
    const sel=root.querySelector('.mp-prov');
    sel.innerHTML=`<option value="">All providers (${cat.models.length})</option>`+Object.keys(provs).sort((a,b)=>mpProvName(a).localeCompare(mpProvName(b))).map(p=>`<option value="${esc(p)}">${esc(mpProvName(p))} (${provs[p]})</option>`).join('');
    if(!provs[MP.prov]) MP.prov=''; sel.value=MP.prov;
    root.querySelector('.mp-cnt').textContent=cat.models.length;
    mpTop(root); if(!root.querySelector('.mp-pal').hidden) mpTable(root);
    if(changed&&!cat.live) say('OPENROUTER MODEL LIST UNREACHABLE — SHORT OFFLINE LIST; ANY ID CAN STILL BE TYPED'); });
}
function mpOpen(root,on){ const pal=root.querySelector('.mp-pal'), b=root.querySelector('.mp-all');
  pal.hidden=!on; b.setAttribute('aria-expanded',on); root.classList.toggle('open',on);
  if(on){ MP.act=0; mpTable(root); const i=MP.q?-1:MP.rows.findIndex(m=>m.id===getModel()); if(i>=0){ MP.act=i; mpAct(root); } root.querySelector('.mp-q').focus(); }
  else { const q=root.querySelector('.mp-q'); if(q.value){ q.value=''; MP.q=''; } b.focus(); } }
function mpPick(root,id,close){
  if(!MP_ID.test(id)){ say('MODEL ID LOOKS LIKE provider/model'); return; }
  local.set(MODEL_LS,id); say('MODEL '+id); mpTop(root);
  if(close) mpOpen(root,false); else if(!root.querySelector('.mp-pal').hidden) mpTable(root);
}
function mpUseId(root){ const f=root.querySelector('.mp-id'), v=f.value.trim(); if(!v){ f.focus(); return; } mpPick(root,v,true); if(MP_ID.test(v)) f.value=''; }
function mpTop(root){
  const cat=MP.cat, cur=getModel(), L=cat?cat.models:[], find=id=>L.find(m=>m.id===id);
  const recId=AI?AI.DEFAULT_MODEL:'deepseek/deepseek-v4.1-flash', rec=find(recId)||(AI&&AI.RECOMMENDED)||{id:recId,name:recId};
  const fr=cat?cat.frontier.filter(m=>m.id!==recId):[], curM=find(cur), known=cur===recId||fr.some(m=>m.id===cur);
  root.querySelector('.mp-top').innerHTML=`<div class="mp-hd"><span class="mp-lbl">Model</span>
    <span class="mp-src${cat&&cat.live?' live':''}">${!cat?'<span class="ai-spin"></span>loading the OpenRouter list…':cat.live?'live from OpenRouter · '+L.length+' models':'offline list — OpenRouter unreachable'}</span></div>
  <button type="button" class="mp-rec${cur===recId?' sel':''}" data-pick="${esc(recId)}">
    <span class="mp-star">★ Recommended</span><span class="mp-rn">${esc(rec.name)}</span><span class="mp-rid">${esc(recId)}</span>
    <span class="mp-rmeta">${mpMeta(rec)}</span>
    <span class="mp-why">Fast and cheap, and writes clean Klartext: a whole program costs a fraction of a US cent.</span>
    <span class="mp-use1">${cur===recId?'✓ In use':'Use'}</span></button>
  <div class="mp-frow"><span class="mp-lbl">Frontier</span><div class="mp-chips">${fr.map(m=>`<button type="button" class="mp-chip${cur===m.id?' sel':''}" data-pick="${esc(m.id)}" title="${esc(m.id)} · ${esc(mpCtx(m.context))} context">
    <span class="p">${esc(mpProvName(m.provider))}</span><span class="n">${esc(m.name)}</span><span class="c">${mpUsd(m.pin)} / ${mpUsd(m.pout)}</span></button>`).join('')||'<span class="mp-dim">…</span>'}</div></div>
  ${known?'':`<div class="mp-curl"><span class="mp-lbl">In use</span><b>${esc(curM?curM.name:cur)}</b><code>${esc(cur)}</code>${curM?`<span class="mp-cm">${mpMeta(curM)}</span>`:cat&&cat.live?'<span class="mp-warn">not in the live list — check the id</span>':''}</div>`}`;
}
function mpTable(root){
  const rows=MP.rows=mpRows(), cur=getModel(); if(MP.act>=rows.length) MP.act=Math.max(0,rows.length-1);
  root.querySelector('.mp-t tbody').innerHTML=rows.length?rows.map((m,i)=>`<tr data-i="${i}"${m.id===cur?' class="sel" aria-selected="true"':''}>
    <td class="nm"><b>${esc(m.name)}</b><span>${esc(m.id)}</span></td><td>${esc(mpProvName(m.provider))}</td><td class="num">${mpCtx(m.context)}</td><td class="num">${mpUsd(m.pin,1)}</td><td class="num">${mpUsd(m.pout,1)}</td></tr>`).join('')
    :`<tr class="empty"><td colspan="5">No model matches.${MP_ID.test(MP.q.trim())?' Enter uses <code>'+esc(MP.q.trim())+'</code> as typed.':''}</td></tr>`;
  root.querySelectorAll('.mp-t th').forEach(th=>{ const on=th.dataset.s===MP.sort; th.setAttribute('aria-sort',on?(MP.dir>0?'ascending':'descending'):'none'); th.querySelector('i').textContent=on?(MP.dir>0?' ↑':' ↓'):''; });
  root.querySelector('.mp-n').textContent=rows.length+' of '+((MP.cat&&MP.cat.models.length)||0)+(MP.sort==='created'?' · newest first':'');
  mpAct(root);
}
function mpAct(root){ const tb=root.querySelector('.mp-t tbody'); tb.querySelectorAll('tr.act').forEach(r=>r.classList.remove('act'));
  const r=tb.querySelector(`tr[data-i="${MP.act}"]`); if(r){ r.classList.add('act'); r.scrollIntoView({block:'nearest'}); } }
/* the AI dialog: prompt, then the model picker, then thinking effort and the answer cap */
function aiModelUI(){
  if($('ai-think')){ mpMount($('ai-mp')); return; }
  const mp=document.createElement('div'); mp.id='ai-mp'; mp.style.marginTop='16px';
  const box=document.createElement('div'); box.className='fgrid'; box.style.marginTop='12px';
  box.innerHTML=`<label class="fld"><span>THINKING (REASONING MODELS)</span><select id="ai-think"><option value="off">Off — fastest, cheapest</option><option value="low">Low (recommended)</option><option value="medium">Medium</option><option value="high">High — slow, can cost more</option></select></label>
    <label class="fld"><span>MAX ANSWER TOKENS (BUDGET GUARD)</span><input id="ai-maxtok" inputmode="numeric" value="12000"></label>`;
  const ta=$('ai-prompt').closest('.fld'); ta.parentNode.insertBefore(box,ta.nextSibling); ta.parentNode.insertBefore(mp,box);
  $('ai-think').value=aiThink(); $('ai-think').onchange=()=>{ local.set('tnc426.aithink',$('ai-think').value); };
  $('ai-maxtok').value=aiMaxTok(); $('ai-maxtok').addEventListener('keydown',e=>e.stopPropagation());
  $('ai-maxtok').onchange=()=>{ const v=Math.round(+$('ai-maxtok').value); if(v>=1000&&v<=200000) local.set('tnc426.aimaxtok',v); else { say('MAX TOKENS 1000–200000'); $('ai-maxtok').value=aiMaxTok(); } };
  mpMount(mp);
}

/* AI: 'new' writes a new program, 'modify' changes the program on screen (undoable) */
function openAI(mode){ S.aiMode=mode; openNew('ai'); aiModelUI();
  $('m-new-t').textContent=mode==='modify'?'AI — change '+S.pgm:'AI — new program';
  $('ai-title').textContent=mode==='modify'?'Say what to change in '+S.pgm:'Describe the part';
  $('ai-lead').textContent=mode==='modify'?'The AI gets this program and your words, returns the whole changed program, and the simulator checks it (one repair round). CTRL+Z undoes it.'
    :'Blank size, material, features, tools if you care. The AI writes Klartext for this simulator, the simulator runs every check on it, and anything that fails goes back to the AI once for a fix.';
  $('ai-go').textContent=mode==='modify'?'Change the program':'Generate';
  $('ai-prompt').placeholder=mode==='modify'?'e.g. make the pocket 8 mm deep in 4 passes, and add a 1 mm chamfer around the outside':'e.g. 120 x 80 x 15 aluminium plate. Face 0.5 mm. A 60 x 30 pocket 6 mm deep in the middle, 4 passes.'; }
function newGo(w){
  if(w==='learn'){ openHelp('learn'); return; }
  $('new-opts').hidden=true; $('new-scratch').hidden=w!=='scratch'; $('new-ai').hidden=w!=='ai';
  (w==='scratch'?$('ns-name'):$('ai-prompt')).focus();
}
$('m-new').addEventListener('click',e=>{ const g=e.target.closest('[data-go]'); if(g) newGo(g.dataset.go);
  if(e.target.closest('[data-back]')) closeModal(); });
$('ai-go').onclick=aiGenerate; $('ai-setup').onclick=()=>openHelp('ai');
const sgn=v=>{ v=+v; return (v<0?'-':'+')+Math.abs(v); };
$('ns-go').onclick=()=>{
  const name=($('ns-name').value.trim()||'MY_PART').toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,16);
  const txt=[`BEGIN PGM ${name} MM`,`END PGM ${name} MM`].join('\n');     // what the control creates: nothing else
  closeModal(); addPgm(name,txt); setMode('edit'); moveCursor(0); showPane('pgm'); insertBlock();
  say('NEW PROGRAM — TYPE A BLOCK · TAB TAKES THE GREY SUGGESTION · ENT STORES · I INSERTS THE NEXT');
};
/* the New dialog asks for the name only; the rest is written block by block */
['ns-axis','ns-tool','ns-x0','ns-y0','ns-z0','ns-x1','ns-y1','ns-z1','ns-s'].forEach(id=>{ const f=$(id)&&$(id).closest('.fld'); if(f) f.hidden=true; });

/* ---------- DEV ---------- */
let devTab='features';
const DEVTXT={features:()=>window.TNC_DEVLOG,history:()=>window.TNC_HISTORY,releases:()=>window.TNC_RELEASES};
function renderDev(){ [...$('dev-tabs').children].forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===devTab));
  $('dev-pre').textContent=(DEVTXT[devTab]&&DEVTXT[devTab]())||'Not written yet — in progress.'; }
$('dev-tabs').addEventListener('click',e=>{ const b=e.target.closest('[data-tab]'); if(b){ devTab=b.dataset.tab; renderDev(); } });
$('b-dev').onclick=()=>{ openModal('m-dev'); renderDev(); };

/* ================= PROFILE: name, autosave, export / import, tool table ================= */
function profChip(saved){
  const b=$('b-prof'); if(!b) return;
  b.textContent=(PROF&&PROF.name)?PROF.name:'Who are you?';
  const t=PSTORE.lastSaved; b.title=(PROF&&PROF.name?PROF.name+' · ':'')+(t?'autosaved '+t.toLocaleTimeString():'not saved yet')+(saved===false?' · STORAGE BLOCKED — EXPORT TO KEEP YOUR WORK':'');
  b.classList.toggle('warn',saved===false);
  if(openModalEl===$('m-prof')) { const st=$('prof-saved'); if(st) st.textContent=t?'Autosaved '+t.toLocaleTimeString()+' — in this browser':'Not saved yet'; }
}
function openProfile(){ openModal('m-prof'); renderProfile(); }
function profCounts(){ let pg_=0; for(const id in S.pgms) for(const n in S.pgms[id]) if(n!==TEMP&&S.pgms[id][n]!==S.orig[id][n]) pg_++;
  return {programs:pg_, projects:S.projects.length, tools:Object.values(S.tools).reduce((a,t)=>a+(t||[]).length,0)}; }
function renderProfile(){
  const c=profCounts(), t=PSTORE.lastSaved, tools=mtools();
  $('prof-body').innerHTML=`<div class="prose">${PROF&&PROF.name?'':'<h4>Welcome. What\'s your name?</h4><p>Everything you make — programs, projects, tools, settings — is kept under your name in this browser and saved automatically. Export it to move it to another computer.</p>'}</div>
<div class="fgrid" style="max-width:760px">
 <label class="fld wide"><span>YOUR NAME</span><input id="prof-name" maxlength="40" autocomplete="name" spellcheck="false" value="${esc(PROF&&PROF.name||'')}" placeholder="your name"></label>
</div>
<p class="note" id="prof-saved" style="margin:8px 0 0">${t?'Autosaved '+t.toLocaleTimeString()+' — in this browser':'Not saved yet'}</p>
<p class="note" style="margin:4px 0 0">${c.programs} program(s) of yours · ${c.projects} project(s) · ${c.tools} tool(s) of yours · machines: ${Object.values(MACHINES).map(m=>esc(m.label)).join(', ')}</p>
<div class="fgrid" style="max-width:760px;margin-top:8px"><label class="fld"><span>CONTROL LANGUAGE</span><select id="prof-lang"><option value="en">English</option><option value="sv">Svenska (MP 7230 = 7)</option></select></label></div>
<div class="actrow"><button class="cbtn" id="prof-dldir">Downloads folder…</button><span class="note" id="prof-dlnote">${window.showDirectoryPicker?'Pick your Downloads folder once: files go to TNC-SIMULATOR/AI-GEN, USER-GEN, SETTINGS, TOOL-TABLES.':'This browser saves to Downloads as TNC-SIMULATOR_AI-GEN_… (Chrome/Edge can write the folders).'}</span></div>
<div class="actrow"><button class="cbtn pri" id="prof-export">Export profile (.zip)</button><button class="cbtn" id="prof-import">Import…</button>
 <button class="cbtn" id="prof-new">Start a new profile…</button></div>
<div id="prof-ask"></div>
<p class="note" style="margin-top:14px">The tool list (TOOL.T) is under <b>TOOL LIST</b>, next to PROGRAMS, or key T.</p>`;
  const nm=$('prof-name');
  nm.addEventListener('input',()=>{ PROF.name=nm.value.trim().slice(0,40); profChip(); persist(); });
  nm.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); nm.blur(); } });
  $('prof-export').onclick=exportProfile;
  $('prof-dldir').onclick=pickDlDir;
  const pl=$('prof-lang'); if(pl){ pl.value=(window.TNC_I18N&&TNC_I18N.lang)||'en'; pl.disabled=!window.TNC_I18N;
    pl.onchange=()=>{ try{ TNC_I18N.set(pl.value); }catch(e){} renderSK(); renderChecks(); setMode(S.mode); say(pl.value==='sv'?'SPRÅK: SVENSKA':'LANGUAGE: ENGLISH'); }; }
  $('prof-import').onclick=loadFromDisk;
  $('prof-new').onclick=newProfile;
  if(!(PROF&&PROF.name)) setTimeout(()=>nm.focus(),30);
}
function toolTableHTML(){
  return `<div class="tblw"><table class="ttab"><thead><tr><th>T</th><th>NAME</th><th>L</th><th>R</th><th></th></tr></thead><tbody>${
  mtools().map(x=>`<tr data-t="${x.t}"${x.mine?' class="mine"':''}${x.t===curToolT?' data-cur="1"':''}><td>${x.t}${x.mine?' *':''}</td><td><input data-k="name" value="${esc(x.name)}" maxlength="16" aria-label="T${x.t} name"></td>
   <td><input data-k="l" inputmode="decimal" value="${(+x.l).toFixed(3)}" aria-label="T${x.t} length"></td><td><input data-k="r" inputmode="decimal" value="${(+x.r).toFixed(3)}" aria-label="T${x.t} radius"></td>
   <td>${x.mine?`<button data-del="${x.t}" title="Remove your entry" aria-label="Remove T${x.t}">×</button>`:''}</td></tr>`).join('')}</tbody></table></div>
<div class="actrow"><label class="fld" style="flex-direction:row;align-items:center;gap:6px"><span>T</span><input data-tt="new" inputmode="numeric" style="width:70px" aria-label="New tool number"></label>
 <button class="cbtn" data-tt="add">Add tool</button><button class="cbtn" data-tt="missing">Add tools this program calls</button>
 <button class="cbtn" data-tt="import">Import TOOL.T</button><button class="cbtn" data-tt="export">Export TOOL.T</button></div>`;
}
function wireToolTable(root,rerender){
  root.querySelectorAll('[data-tt]').forEach(b=>{ const k=b.dataset.tt; if(k==='new') return; b.onclick=()=>{
    if(k==='add'){ const t=parseInt(root.querySelector('[data-tt=new]').value,10); if(!(t>=0&&t<=32767)){ say('TOOL NUMBER 0–32767'); return; } mergeTools([{t,name:'T'+t,l:0,r:3}],true); }
    else if(k==='missing') addMissingTools();
    else if(k==='import') loadFromDisk();
    else if(k==='export'&&window.TNC_PROFILE) download('TOOL_TNC'+S.machine+'.T',new Blob([TNC_PROFILE.toolT(mtools())],{type:'text/plain'}),'TOOL-TABLES'); }; });
  const tb=root.querySelector('.ttab'); if(!tb) return;
  tb.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Enter') e.target.blur(); });
  tb.addEventListener('change',e=>{ const inp=e.target.closest('input'); if(!inp) return; const tr=inp.closest('tr'), t=+tr.dataset.t;
    const cur=mtools().find(x=>x.t===t); if(!cur) return; const v=inp.dataset.k==='name'?inp.value.trim().toUpperCase().slice(0,16)||('T'+t):parseFloat(String(inp.value).replace(',','.'));
    if(inp.dataset.k!=='name'&&!isFinite(v)){ say('NOT A NUMBER'); rerender(); return; }
    if(inp.dataset.k==='r'&&v<0){ say('RADIUS MUST BE ≥ 0'); rerender(); return; }
    const e2={t,name:cur.name,l:+cur.l,r:+cur.r}; e2[inp.dataset.k]=v; mergeTools([e2],true); });
  tb.addEventListener('click',e=>{ const d=e.target.closest('[data-del]'); if(!d) return; const t=+d.dataset.del;
    S.tools[S.machine]=(S.tools[S.machine]||[]).filter(x=>x.t!==t); persist(); curToolT=null; compile(); rerender(); say('T'+t+' REMOVED FROM YOUR TABLE'); });
}
function mergeTools(list,quiet){
  const mine=(S.tools[S.machine]=S.tools[S.machine]||[]);
  list.forEach(n=>{ const i=mine.findIndex(x=>x.t===n.t); const e={t:n.t,name:String(n.name||'T'+n.t).toUpperCase().slice(0,16),l:+n.l||0,r:+n.r||0}; if(i>=0) mine[i]=e; else mine.push(e); });
  persist(); curToolT=null; compile(); if(openModalEl===$('m-prof')) renderProfile(); if(S.tt) renderTT(); if(!quiet) say(list.length+' TOOL(S) IN YOUR TABLE');
}
/* uploaded programs: every TOOL CALL number missing from the table gets an entry (radius from ";T5 D=+8" or TOOL DEF, else R3) */
function toolsFor(texts){
  const have=new Set(mtools().map(t=>t.t)), add={};
  texts.forEach(t=>{ const hint={}, def=new Set();
    t.split(/\r?\n/).forEach(l=>{ let m; if((m=/;\s*T(\d+)\s+D=\s*([+-]?\d+\.?\d*)/i.exec(l))) hint[+m[1]]=Math.abs(parseFloat(m[2]))/2;
      if((m=/TOOL\s+DEF\s+(\d+)\s+L/i.exec(l))) def.add(+m[1]); });
    t.split(/\r?\n/).forEach(l=>{ const m=/TOOL\s+CALL\s+(\d+)/i.exec(l); if(!m) return; const n=+m[1];
      if(n&&!have.has(n)&&!def.has(n)&&!add[n]) add[n]={t:n,name:'T'+n+(hint[n]!=null?'_D'+(hint[n]*2):''),l:0,r:hint[n]!=null?hint[n]:3}; }); });
  const list=Object.values(add); if(list.length) mergeTools(list,true); return list.length;
}
/* tools called by the program but missing from the table: radius from a CAM comment (";T5 D=+8") when there is one */
function addMissingTools(){
  const miss=[...new Set((S.res.errors||[]).map(e=>(/^TOOL (\d+) NOT DEFINED/.exec(e.msg)||[])[1]).filter(Boolean).map(Number))];
  if(!miss.length){ say('EVERY TOOL THIS PROGRAM CALLS IS IN THE TABLE'); return; }
  const hint={}; S.text.split('\n').forEach(l=>{ const m=/;\s*T(\d+)\s+D=\s*([+-]?\d+\.?\d*)/i.exec(l); if(m) hint[+m[1]]=Math.abs(parseFloat(m[2]))/2; });
  mergeTools(miss.map(t=>({t,name:'T'+t+(hint[t]!=null?'_D'+(hint[t]*2):''),l:0,r:hint[t]!=null?hint[t]:3})),true);
  say(miss.length+' TOOL(S) ADDED'+(miss.some(t=>hint[t]==null)?' — CHECK THE RADII, SOME ARE GUESSES (R3)':' — RADII FROM THE PROGRAM COMMENTS'));
}
function exportProfile(){
  if(!window.TNC_PROFILE){ say('PROFILE MODULE MISSING FROM THIS BUILD'); return; }
  PROF=profileNow();
  const lst=(m,t)=>{ const keep=S.machine; S.machine=MACHINES[m]?m:keep; const r=listing(t); S.machine=keep; return r; };
  TNC_PROFILE.exportZip(PROF,lst).then(r=>{ download(r.name,r.blob,'SETTINGS'); say('PROFILE EXPORTED — '+r.count+' PROGRAM(S)'); }).catch(e=>say(String(e.message||e)));
}
function profImportAsk(inc,fname){
  const box=$('prof-ask'); if(!box) return;
  const n=Object.values(inc.machines||{}).reduce((a,m)=>a+Object.keys(m.pgms||{}).length,0);
  box.innerHTML=`<div class="warnbox" style="margin-top:12px"><b>${esc(fname)}</b> — profile “${esc(inc.name||'unnamed')}”, ${n} program(s), ${(inc.projects||[]).length} project(s).<br>
   <b>Merge</b> adds its programs, projects and tools to yours (name clashes get _IMP). <b>Replace</b> throws yours away — export first if unsure.
   <div class="actrow"><button class="cbtn pri" id="imp-merge">Merge into mine</button><button class="cbtn" id="imp-replace">Replace mine</button><button class="cbtn" id="imp-cancel">Cancel</button></div></div>`;
  $('imp-cancel').onclick=()=>{ box.innerHTML=''; };
  $('imp-merge').onclick=async()=>{ const m=TNC_PROFILE.merge(profileNow(),inc); m.profile.name=(PROF&&PROF.name)||inc.name||''; await finishImport(m.profile,'MERGED'+(m.renamed?' · '+m.renamed+' RENAMED':'')); };
  $('imp-replace').onclick=async()=>{ if(!confirm('Replace your whole profile with '+(inc.name||'this one')+'? Your current programs will be gone.')) return; await finishImport(inc,'REPLACED'); };
}
async function finishImport(prof,msg){
  clearTimeout(persistT); PROF=prof; await PSTORE.save(PROF); sess.set('tnc.flash','PROFILE '+msg);
  location.reload();                                  // a clean start on the imported state
}
async function newProfile(){
  if(!confirm('Start a new, empty profile? Your programs, projects and tools in this browser will be deleted.\n\nPress Cancel and use “Export profile” first if you want to keep them.')) return;
  clearTimeout(persistT); await PSTORE.wipe(); try{ localStorage.removeItem(LS_KEY); }catch(e){}
  PROF=PSTORE.blank(''); await PSTORE.save(PROF); location.reload();
}
if($('b-prof')) $('b-prof').onclick=openProfile;


/* ================= programming dialogs (dialogs.js): one question per step, soft keys for the choices ================= */
const DLG=window.TNC_DIALOGS||null;
function startWiz(spec){
  if(!spec) return;
  if(S.mode!=='edit') setMode('edit');
  if(S.editing) endEdit(false); if(S.raw) toggleRaw(); if(S.mgt) closeMgt(); if(S.tt) closeTT();
  S.pick=null; S.running=false; S.wiz={spec, i:0, v:{}};
  dlgIn.disabled=false; wizShow();
}
function wizStep(){ return S.wiz.spec.steps[S.wiz.i]; }
function wizShow(){
  const st=wizStep(), d=st.dflt!=null&&st.dflt!==''?st.dflt:null;
  dlgPr.textContent=st.ask;
  dlgHint.textContent=S.wiz.spec.title+' · '+(S.wiz.i+1)+'/'+S.wiz.spec.steps.length+' · ENT '+(d!=null?'= '+d:(st.opt||st.type==='feed'||st.type==='m'?'= NONE':''))
    +(padStep(st)?' · '+(st.type==='coords'?'X 10 Y 20 · ':'')+'I INCR.'+(st.type==='coords'?' · P POLAR':''):'')+' · ⇧ENT NO ENT · END · ESC DEL';
  dlgIn.value=''; dlgIn.placeholder=d!=null?d:''; renderSK(); dlgIn.focus();
}
function wizSK(){
  const st=wizStep(), tail=[['NO\nENT','wskip'],['ENT','wok'],['END','wend'],['DEL','wcancel']];   // manual 4.5 p. 67: NO ENT ignores, END ends, DEL aborts
  let k=[];
  if(st.type==='choice') k=st.opts.map(o=>[o,'wv:'+o]);
  else if(padStep(st)) k=wizPad(st);
  else if(st.type==='feed') k=[['F MAX','wv:FMAX'],['F AUTO','wv:FAUTO']];
  else if(st.type==='tool') k=mtools().slice(0,13).map(t=>['T'+t.t+'\n'+String(t.name).slice(0,10),'wv:'+t.t]);
  return k.concat(tail);
}
const NUMRE=/^[+-]?(?:\d+\.?\d*|\.\d+|Q\d+)$/i;
function wizAccept(raw,skip){
  if(!S.wiz) return;
  const st=wizStep(); let v=String(raw==null?'':raw).trim().replace(/,/g,'.'), d=st.dflt!=null&&st.dflt!==''?st.dflt:null;
  if(v===''){
    if(d!=null&&!skip) v=d;
    else if(!(st.opt||st.type==='feed'||st.type==='m'||st.type==='choice'||(skip&&d!=null))){ say('ENTRY REQUIRED — '+st.ask); dlgIn.focus(); return; }
    else if(skip&&d!=null&&!st.opt) v=d;
  }
  if(v!==''){
    if(st.pol){ const e=DLG.PAD.polar(v,st.k.toUpperCase()); if(e){ say(e); dlgIn.select(); return; } }
    else if(st.type==='num'||st.type==='tool'){ if(!NUMRE.test(v)){ say('ENTER A NUMBER (OR Q PARAMETER)'); dlgIn.select(); return; } }
    else if(st.type==='choice'){ const u=v.toUpperCase(); v=st.opts.find(o=>o===u||o.replace(/[^A-Z0-9]/g,'')===u.replace(/[^A-Z0-9]/g,''))||(d!=null?d:st.opts[0]); }
    else if(st.type==='feed'){ const u=v.toUpperCase().replace(/\s+/g,''); v=/^F?MAX$/.test(u)?'FMAX':/^F?AUTO$/.test(u)?'FAUTO':u.replace(/^F/,''); if(!/^(FMAX|FAUTO)$/.test(v)&&!NUMRE.test(v)){ say('FEED RATE: A NUMBER, F MAX OR F AUTO'); dlgIn.select(); return; } }
    else if(st.type==='m'){ v=v.toUpperCase().replace(/M/g,' ').trim(); if(!/^\d+(\s+\d+)*$/.test(v)){ say('M FUNCTION: A NUMBER, e.g. 3 OR 3 8'); dlgIn.select(); return; } }
    else if(st.type==='coords'){ const c=wizCoords(v); if(!c){ say('COORDINATES: e.g. X+10 Y-5 or 10 -5'); dlgIn.select(); return; } v=c; }
  }
  S.wiz.v[st.k]=v; S.wiz.i++;
  if(S.wiz.i>=S.wiz.spec.steps.length) wizFinish(); else wizShow();
}
/* the COORDINATES ? answer -> block words: TNC_DIALOGS.PAD.coords (dialogs.js) */
function wizCoords(v){ return DLG.PAD.coords(v,M().axes||['X','Y','Z']); }
/* ---- the coordinate keypad (TNC 426/430 keyboard, manual inside front cover: "Coordinate axes and numbers"):
   axis keys X Y Z IV V, 0-9, decimal point, -/+, P polar, I incremental, Q parameter, actual-position capture,
   NO ENT, ENT, END, CE, DEL. Every key works on the word being entered = the last word on the line.
   The PC keyboard does the same: axis letters, I, P, + -, # = actual position, DELETE = CE, SHIFT+ENTER = NO ENT.
   NOT verified against a control (key images only in the manual): I and -/+ toggle the word being entered,
   I after a word that has its value starts the next word (X 1 0 I Y 5 = X+10 IY+5, as typing x10iy5);
   CE pressed twice also drops the axis; "actual position" = the simulated tool position (DRO).
   PR / PA questions take bare (-90, I-90) and whole words (PA-90, IPA+60). ---- */
const padStep=st=>!!st&&(st.type==='coords'||!!st.pol);
function wizPad(st){
  const C=st.type==='coords', ax=M().axes||['X','Y','Z'], roman=['IV','V'];
  const axk=C?ax.slice(0,5).map((a,i)=>[i<3?a:roman[i-3]+'\n'+a,'wa:'+a]):[];   // 430: IV = B, V = A (machine axis order, machines.js)
  while(axk.length<5) axk.push(['','']);
  return axk.concat([['I','wi'],C?['P','wp']:['',''],['Q','wq']],
    '12345678'.split('').map(d=>[d,'wd:'+d]),
    [['9','wd:9'],['0','wd:0'],['.','wd:.'],['−/+','wsign'],C?['ACTUAL\nPOSITION','wact']:['',''],['CE','wce'],['',''],['','']]);
}
/* the word logic is TNC_DIALOGS.PAD (dialogs.js, tested in tests/manual.js); these put its result on the line */
function cwSet(line){ dlgIn.value=line; dlgIn.focus(); const L=dlgIn.value.length; dlgIn.setSelectionRange(L,L); }
function ckAxis(a){ if(S.wiz) cwSet(DLG.PAD.axis(dlgIn.value,a)); }
function ckDigit(d){ if(S.wiz) cwSet(DLG.PAD.digit(dlgIn.value,d)); }
function ckSign(force){ if(S.wiz) cwSet(DLG.PAD.sign(dlgIn.value,force)); }
function ckInc(){ if(S.wiz) cwSet(DLG.PAD.inc(dlgIn.value,wizStep().type==='coords')); }
function ckQ(){ if(S.wiz) cwSet(DLG.PAD.q(dlgIn.value)); }
function ckCE(){ if(S.wiz) cwSet(DLG.PAD.ce(dlgIn.value)); }
function ckPolar(){ if(!S.wiz) return; const sp=S.wiz.spec, t=sp.polar&&DLG&&DLG.PATH[sp.polar];
  if(wizStep().type!=='coords') return;
  if(!t){ say(sp.key==='CC'?'P: THE POLE CC IS ENTERED IN CARTESIAN COORDINATES ONLY':'P: NO POLAR FORM OF '+sp.title); return; }
  const no=sp.polarIf&&sp.polarIf(S.wiz.v); if(no){ say(no); return; }
  S.wiz={spec:t, i:S.wiz.i, v:S.wiz.v}; wizShow();                       // answers so far are kept (APPR/DEP: the form)
  say('POLAR COORDINATES — '+(S.wiz.v.form?t.key.split(' ')[0]+' P'+S.wiz.v.form:t.title)); }
/* the simulator's "actual position" = the tool position at the current point of the run (the DRO) */
function actPos(){ const p=S.pos||{x:0,y:0,z:0}, s=S.seg, o={X:p.x,Y:p.y,Z:p.z}, u=s?clamp((S.t-s.t0)/Math.max(1e-9,s.t1-s.t0),0,1):0;
  (M().axes||[]).filter(a=>/[ABC]/.test(a)).forEach(a=>{ const k=a.toLowerCase(); o[a]=s&&s.a&&s.a[k]!=null?s.a[k]+((s.b[k]||0)-s.a[k])*u:0; });
  return o; }
const fmtPos=n=>(n<-5e-4?'-':'+')+(+Math.abs(n).toFixed(3));
function ckActual(){ if(!S.wiz||wizStep().type!=='coords') return; const c=DLG.PAD.word(dlgIn.value), P=actPos();
  if(c.a&&!c.n){ cwSet(c.head+c.a+fmtPos(P[c.a])); say('ACTUAL POSITION '+c.a+fmtPos(P[c.a])); return; }   // the selected axis
  const have=new Set((c.v.toUpperCase().match(/I?[XYZABC]/g)||[]).map(x=>x.slice(-1)));                        // no axis selected: the missing ones
  const add=(S.wiz.spec.key==='CC'?['X','Y']:['X','Y','Z']).filter(a=>!have.has(a)).map(a=>a+fmtPos(P[a]));
  if(!add.length) return; cwSet((c.v.trim()?c.v.trim()+' ':'')+add.join(' ')); say('ACTUAL POSITION '+add.join(' ')); }
function wizKey(e){
  if(!S.wiz||e.ctrlKey||e.metaKey||e.altKey) return false;
  const k=e.key;
  if(k==='Enter'){ if(e.shiftKey) wizAccept('',true); else wizAccept(dlgIn.value); return true; }
  if(k==='Escape'){ wizCancel(); return true; }
  if(k==='End'){ wizEnd(); return true; }
  const st=wizStep(); if(!padStep(st)) return false;
  if(k==='Delete'){ ckCE(); return true; }
  if(k==='#'&&st.type==='coords'){ ckActual(); return true; }
  const L=dlgIn.value.length; if(dlgIn.selectionStart!==L||dlgIn.selectionEnd!==L||k.length!==1) return false;   // caret inside the line: plain text editing
  if(k.toUpperCase()==='P'&&st.type==='coords'){ ckPolar(); return true; }
  const nl=DLG.PAD.type(dlgIn.value,k,st.type==='coords',M().axes||['X','Y','Z']);   // axis letters, I, + - (dialogs.js PAD)
  if(nl==null) return false; cwSet(nl); return true;
}
function wizEnd(){
  if(!S.wiz) return;
  if(dlgIn.value.trim()){ const i0=S.wiz.i; wizAccept(dlgIn.value); if(!S.wiz||S.wiz.i===i0) return; }   // END takes the entry on the line first — NOT VERIFIED: p. 67 says only "end the dialog immediately" (CONTINUE OPEN K1)
  while(S.wiz&&S.wiz.i<S.wiz.spec.steps.length){
    const st=wizStep(), d=st.dflt!=null&&st.dflt!==''?st.dflt:null;
    if(d==null&&!(st.opt||st.type==='feed'||st.type==='m'||st.type==='choice')){ wizShow(); say('ENTRY REQUIRED — '+st.ask); return; }
    S.wiz.v[st.k]=d!=null?d:(st.type==='choice'?st.opts[0]:''); S.wiz.i++;
  }
  if(S.wiz) wizFinish();
}
function wizDone(){ S.wiz=null; dlgIn.value=''; dlgIn.placeholder=''; dlgIn.disabled=true; dlgPr.textContent='BLOCK'; dlgHint.textContent='E edit · I insert · D delete'; renderSK(); }
function wizCancel(){ if(!S.wiz) return; wizDone(); say('DIALOG CANCELLED'); }
function wizFinish(){
  const txt=S.wiz.spec.build(S.wiz.v), add=txt.split('\n'), ls=lines();
  let i=srcLine(S.cursor); if(/^\s*(\d+\s+)?END\s+PGM/i.test(ls[i]||'')) i--;                 // never after END PGM
  ls.splice(i+1,0,...add); wizDone();
  edit(ls.join('\n'),Math.min(i+1,Math.max(0,S.res.blocks.length)),'BLOCK STORED — '+add[0]);
  markRows(true);
}

/* ================= tool table in the machine view (T) ================= */
function openTT(){ if(S.wiz) wizCancel(); if(S.editing) endEdit(false); if(S.mgt) closeMgt(); S.tt=true;
  plist.hidden=true; $('flow').hidden=true; mgtEl.hidden=false; renderTT(); renderSK(); $('pgm-path').textContent='TNC:\\TOOL.T'; showPane('pgm'); }
function renderTT(){ const ms=mset(); mgtEl.innerHTML=`<div class="ttview"><div class="mhd" style="display:block">TOOL LIST · ${esc(M().label)} · TNC:\\TOOL.T · * = YOURS · ENT STORES A VALUE · T / END CLOSES</div>
  <div class="actrow" style="padding:6px 10px"><span class="note">L = gauge length, spindle face to tool tip. L = 0: measured on the machine — drawn at holder A + a typical stick-out, holder check off.</span>
  <label class="fld" style="flex-direction:row;align-items:center;gap:8px"><span>HOLDER</span><select id="tt-ht"><option value="ISO50">ISO 50 (SK50) · DIN 69871 ER32 · A = 100 mm</option><option value="SK40">SK40 · DIN 69871 ER32 · A = 70 mm</option></select></label></div>
  ${toolTableHTML()}</div>`;
  const ht=$('tt-ht'); ht.value=ms.holderType;
  ht.addEventListener('change',()=>{ ms.holderType=ht.value; persist(); curToolT=null; compile(); say('HOLDER '+ht.options[ht.selectedIndex].text); });
  wireToolTable(mgtEl,renderTT); const cur=mgtEl.querySelector('tr[data-cur]'); if(cur){ cur.style.outline='2px solid var(--cyan)'; cur.scrollIntoView({block:'nearest'}); } }
function closeTT(){ if(!S.tt) return; S.tt=false; mgtEl.hidden=true; plist.hidden=S.flowView&&!!FLOW; $('flow').hidden=!(S.flowView&&FLOW); renderSK(); $('pgm-path').textContent='TNC:\\'+S.pgm; }

/* ================= focus view: listing + graphics only ================= */
function toggleFocus(){ S.focusView=!S.focusView; document.body.classList.toggle('focus',S.focusView); if($('b-focus')) $('b-focus').setAttribute('aria-pressed',S.focusView);
  writePrefs(); renderSK(); requestAnimationFrame(()=>{ resize(); requestAnimationFrame(resize); }); say(S.focusView?'FOCUS VIEW — F TO RETURN':'FULL VIEW'); }
if($('b-focus')) $('b-focus').onclick=toggleFocus;


/* ================= right pane: DIAGNOSTICS · REFERENCE · <name>'s PROGRAMS ================= */
function setSideTab(t){ S.sideTab=t; [...$('stabs').children].forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===t));
  ['diag','ref','progs'].forEach(k=>{ const el=$('sp-'+k); if(el) el.hidden=k!==t; }); if(t==='ref') renderRef(); if(t==='progs') renderUserPrograms(); writePrefs(); }
$('stabs').addEventListener('click',e=>{ const b=e.target.closest('[data-tab]'); if(b) setSideTab(b.dataset.tab); });
function refOptions(){
  const o=[['keys','Keys'],['cycles','Cycles — CYCL DEF'],['tools','Tool list'],['machine','Machine: '+M().label]], Ls=lessonsOf();
  (Ls&&Ls.manual||[]).forEach((sec,i)=>o.push(['man:'+i,'Manual · '+sec.title]));
  const sel=$('ref-sel'), cur=S.ref||'keys'; sel.innerHTML=o.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join(''); sel.value=o.some(x=>x[0]===cur)?cur:'keys';
}
$('ref-sel').addEventListener('change',()=>{ S.ref=$('ref-sel').value; renderRef(); writePrefs(); });
$('ref-sel').addEventListener('keydown',e=>e.stopPropagation());
function renderRef(){
  refOptions(); const v=$('ref-sel').value, b=$('ref-body'), Ls=lessonsOf();
  if(v==='keys') b.innerHTML='<table>'+KEYS.map(([k,d])=>`<tr><td style="color:var(--amber);white-space:nowrap">${esc(k)}</td><td>${esc(d)}</td></tr>`).join('')+'</table>';
  else if(v==='cycles'&&DLG) b.innerHTML='<p class="note">Click a cycle to program it (PROGRAM mode, one question per parameter).</p><table>'+
    DLG.GROUPS.map(g=>`<tr><th colspan="2" style="color:var(--cyan)">${esc(g[1].replace(/\n/g,' '))}</th></tr>`+DLG.cycleList(g[0]).map(c=>`<tr class="cyc" data-cy="${c.num}"><td>${c.num}</td><td>${esc(c.name)}</td></tr>`).join('')).join('')+'</table>';
  else if(v==='tools') b.innerHTML='<p class="note">T opens the editable list. * = yours.</p><table><tr><th>T</th><th>NAME</th><th>R</th><th>L</th></tr>'+
    mtools().map(t=>`<tr${t.t===curToolT?' style="color:var(--cyan)"':''}><td>${t.t}${t.mine?' *':''}</td><td>${esc(t.name)}</td><td>${(+t.r).toFixed(3)}</td><td>${(+t.l).toFixed(2)}</td></tr>`).join('')+'</table>';
  else if(v==='machine'){ const mc=M().machine; b.innerHTML=mc?`<table>
    <tr><td>Axes</td><td>${esc(M().axes.join(' '))}</td></tr>`+Object.entries(mc.limits).map(([a,l])=>`<tr><td>Limit ${a}</td><td>${l[0]} … ${l[1]}${'AB'.includes(a)?'°':' mm'}</td></tr>`).join('')+
    `<tr><td>Spindle max</td><td>${mc.sMax} rpm (MP 3515)</td></tr><tr><td>Feed max</td><td>${mc.fMax} mm/min (MP 1020)</td></tr>
     <tr><td>Rapid X Y Z</td><td>${mc.rapid.x} / ${mc.rapid.y} / ${mc.rapid.z} mm/min</td></tr><tr><td>Rapid A B</td><td>${mc.rapid.a} / ${mc.rapid.b} °/min</td></tr>
     <tr><td>Acceleration</td><td>${mc.accel} m/s² (MP 1060)</td></tr><tr><td>Arc end tolerance</td><td>${mc.arcTol} mm (MP 7431)</td></tr>
     <tr><td>Pocket overlap</td><td>${mc.pocketK} × R (MP 7430)</td></tr><tr><td>Head</td><td>B carries A · A+ → Y+ · B+ → X+ · pivots ≈ ${mc.head.pivotA} mm</td></tr>
     <tr><td>Cycle 19</td><td>positions A/B itself (MP 7500 bit 2)</td></tr></table>`
    :'<p>Generic TNC 426: no machine limits. Choose <b>TNC 430</b> in the machine selector for the operator\'s machine.</p>'; }
  else if(/^man:/.test(v)&&Ls){ const sec=Ls.manual[+v.slice(4)]; b.innerHTML=`<div class="prose"><h4>${esc(sec.title)}</h4>${md(sec.body)}`+
    (sec.rows&&sec.rows.length?`<div class="tblw"><table><thead><tr>${sec.rows[0].map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${sec.rows.slice(1).map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'')+'</div>'; }
  b.onclick=e=>{ const c=e.target.closest('[data-cy]'); if(c) act('cy:'+c.dataset.cy); };
}
const fmtD=iso=>{ if(!iso) return '—'; const d=new Date(iso); return d.toLocaleDateString(undefined,{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}); };
function renderUserPrograms(){
  const who=(PROF&&PROF.name)?PROF.name:'My', rows=[];
  for(const id in S.pgms) for(const n in S.pgms[id]){ if(n===TEMP) continue; const mine=S.orig[id][n]==null||S.pgms[id][n]!==S.orig[id][n]; if(!mine) continue;
    const m=(S.meta[id]||{})[n]||{}; rows.push({id,n,m}); }
  rows.sort((a,b)=>String(b.m.m||'').localeCompare(String(a.m.m||'')));
  const tab=$('tab-progs'); if(tab) tab.textContent=(who==='My'?'My':who+"'s")+' programs';
  $('up-t').textContent=(who==='My'?'My':who+"'s")+' programs'; $('up-n').textContent=rows.length;
  $('uplist').innerHTML=rows.length?'<table><tr><th>PROGRAM</th><th>MACHINE</th><th>CREATED</th><th>EDITED</th><th>V</th></tr>'+
    rows.map(r=>`<tr class="pg${r.id===S.machine&&r.n===S.pgm?' cur':''}" data-m="${r.id}" data-n="${esc(r.n)}"><td>${esc(r.n)}</td><td>${esc((MACHINES[r.id]||{}).label||r.id)}</td><td>${fmtD(r.m.c)}</td><td>${fmtD(r.m.m)}</td><td>${r.m.v||'—'}</td></tr>`).join('')+'</table>'
    :'<p class="note" style="padding:0 12px 10px">Nothing yet. Every program you create, change, upload or save shows up here by itself.</p>';
  const pn=$('proj-t'); if(pn) pn.textContent=S.projects.length;
}
$('uplist').addEventListener('click',e=>{ const r=e.target.closest('tr.pg'); if(!r) return; if(r.dataset.m!==S.machine) setMachine(r.dataset.m); openPgm(r.dataset.n); renderUserPrograms(); });
if($('b-tools')) $('b-tools').onclick=()=>act('tt');


/* ================= header menus: + NEW · LESSONS · AI ================= */
let menuEl=null;
function closeMenu(){ if(menuEl){ menuEl.remove(); menuEl=null; } }
function openMenu(btn,items){
  if(menuEl&&menuEl.dataset.for===btn.id){ closeMenu(); return; } closeMenu();
  const m=document.createElement('div'); m.className='hmenu'; m.setAttribute('role','menu'); m.dataset.for=btn.id;
  m.innerHTML=items.map((it,i)=>it.head?`<div class="mh">${esc(it.head)}</div>`:`<button role="menuitem" data-i="${i}">${esc(it.label)}</button>`).join('');
  document.body.appendChild(m); const r=btn.getBoundingClientRect();
  m.style.left=Math.min(r.left,innerWidth-m.offsetWidth-8)+'px'; m.style.top=(r.bottom+4)+'px';
  m.onclick=e=>{ const b=e.target.closest('[data-i]'); if(!b) return; const it=items[+b.dataset.i]; closeMenu(); it.act(); };
  m.addEventListener('keydown',e=>{ e.stopPropagation(); const bs=[...m.querySelectorAll('button')], i=bs.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){ e.preventDefault(); (bs[i+1]||bs[0]).focus(); } else if(e.key==='ArrowUp'){ e.preventDefault(); (bs[i-1]||bs[bs.length-1]).focus(); }
    else if(e.key==='Escape'){ e.preventDefault(); closeMenu(); btn.focus(); } });
  menuEl=m; const f=m.querySelector('button'); if(f) f.focus();
}
addEventListener('pointerdown',e=>{ if(menuEl&&!menuEl.contains(e.target)&&!e.target.closest('#b-new,#b-lessons,#b-ai')) closeMenu(); });
$('b-new').onclick=()=>openMenu($('b-new'),[{label:'NEW PRG — MANUAL',act:()=>openNew('scratch')},{label:'NEW PRG — AI',act:()=>openAI('new')}]);
$('b-lessons').onclick=()=>{ const L=lessonsOf(); if(!L){ say('LESSONS ARE NOT IN THIS BUILD'); return; }
  openMenu($('b-lessons'),[{head:'LEARN'},...L.learn.map((x,i)=>({label:(i+1)+' · '+x.title,act:()=>startLesson('learn',i)})),
    {head:'BREAK IT — crash it safely, then fix it'},...L.breakit.map((x,i)=>({label:(i+1)+' · '+x.title,act:()=>startLesson('breakit',i)}))]); };
$('b-ai').onclick=()=>openMenu($('b-ai'),[{label:'Change this program ('+S.pgm+')…',act:()=>openAI('modify')},{label:'New program from a description…',act:()=>openAI('new')},
  {label:'AI setup — OpenRouter key',act:()=>openHelp('ai')}]);

/* ================= machine selector ================= */
function setMachine(id){
  if(!MACHINES[id]||id===S.machine) return;
  if(S.lesson) endLesson(true);
  if(S.pgm!==TEMP) S.cur[S.machine]=S.pgm;
  S.machine=id; S.pgm=(S.cur[id]&&pg()[S.cur[id]]!=null)?S.cur[id]:Object.keys(pg())[0];
  if(!S.pgm){ S.pgm='NEW.H'; pg()[S.pgm]='BEGIN PGM NEW MM\nEND PGM NEW MM'; }
  S.text=pg()[S.pgm]; raw.value=S.text; S.cursor=0; curToolT=null; compile(); persist(); writePrefs();
  document.querySelector('.ttl').textContent=M().label; say(M().label+' SELECTED');
}
if(Object.keys(MACHINES).length>1){
  const sel=document.createElement('select'); sel.className='chb'; sel.id='mach-sel'; sel.setAttribute('aria-label','Machine');
  sel.innerHTML=Object.values(MACHINES).map(m=>`<option value="${m.id}">${esc(m.label)}</option>`).join('');
  $('pgm-path').before(sel); sel.onchange=()=>{ setMachine(sel.value); sel.blur(); };
}

/* ================= modes, toggles, keyboard ================= */
function setMode(m){ if(m!=='edit'){ if(S.wiz) wizCancel(); S.pick=null; } S.mode=m;
  const tps=$('tp-state'); if(tps) tps.textContent={edit:'1 PRG EDIT · soft keys write blocks · Y CYCL DEF · W TOOL CALL',test:'2 TEST · SPACE = NC START / STOP',single:'3 SINGLE-BLOCK · SPACE = next block · ↑↓ moves the machine',full:'4 FULL-RUN · SPACE = NC START / STOP'}[m]||''; [...document.querySelectorAll('.mode')].forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===m));
  if(!S.mgt) renderSK(); if(m==='edit'){ S.running=false; setState('EDITING'); } else setState('READY'); writePrefs(); }
$('modes').addEventListener('click',e=>{ const b=e.target.closest('.mode'); if(b) setMode(b.dataset.m); });
function setSpeed(v,quiet){ S.speed=v; [...$('spd').children].forEach(b=>b.dataset.on=(+b.dataset.s===v)?'1':'0'); writePrefs();
  if(v===0&&S.running) runMax(); if(!quiet) say(v?'SPEED '+v+'×':'MAX — RUNS TO THE END OR THE FIRST CRASH'); }
$('spd').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) setSpeed(+b.dataset.s); });
function syncToggles(){ $('b-fx').dataset.on=S.fx?'1':'0'; $('b-cool').dataset.on=S.fxCool?'1':'0'; $('b-fire').dataset.on=S.fxFire?'1':'0';
  $('b-labels').dataset.on=S.labels?'1':'0'; $('b-vice').dataset.on=S.vice?'1':'0'; if(window.TNC_STOCK) TNC_STOCK.VICE.on=S.vice; $('b-sound').dataset.on=S.sound?'1':'0'; fxApply(); if(CO) CO.setVisible(S.labels); writePrefs(); }
function tog(k,label){ S[k]=!S[k]; syncToggles(); say(label+(S[k]?' ON':' OFF')); }
$('b-fx').onclick=()=>tog('fx','CHIPS & SPARKS'); $('b-cool').onclick=()=>tog('fxCool','COOLANT');
$('b-fire').onclick=()=>tog('fxFire','SMOKE & FIRE'); $('b-labels').onclick=()=>tog('labels','LABELS'); $('b-sound').onclick=()=>tog('sound','SOUND');
$('b-vice').onclick=()=>{ tog('vice','VICE'); compile(); };   // standard vice (TNC_STOCK.VICE): drawn + crash-checked; off = part on a fixture plate
if(!window.TNC_FX){ ['b-fx','b-cool','b-fire'].forEach(id=>$(id).hidden=true); }
if(!window.TNC_CALLOUTS) $('b-labels').hidden=true;
$('b-start').onclick=ncStart; $('b-stop').onclick=stop; $('b-step').onclick=stepBlock; $('b-reset').onclick=reset;
scrub.addEventListener('input',()=>{ S.running=false; seek(+scrub.value/1000*S.total,false); });

const KEYS=[['↑ ↓','Block cursor'],['← →','Scrub the run (Shift ×5)'],['ENTER','Step one block · edit in EDIT mode'],['ESC','Stop · cancel · close'],
  ['SPACE','NC START (what the mode does) / NC STOP'],['S · R','Single block · reset'],['E I D C','Edit · insert · delete · copy'],['CTRL+Z','Undo  (CTRL+SHIFT+Z / CTRL+Y redo)'],
  ['CTRL+S','Save as .H'],['CTRL+O','Load .H from your computer'],['TAB','Raw text editor'],['M','Programs'],['H','Help, lessons, manual'],
  ['V','Flowchart view'],['G','3D / TOP / FRONT / SIDE'],['1 – 4','Operating mode'],['5 – 9','Speed 1× 4× 16× 64× MAX'],['T','Tool table'],['F','Focus view (listing + graphics)'],['PRG EDIT','Y CYCL DEF · W TOOL CALL · A APPR/DEP · Q Q-parameter · soft keys for L CC C CR CT CP RND CHF, TOOL DEF, LBL'],
  ['COORDINATES ?','X Y Z (B A) axis · I incremental · P polar · Q parameter · + − sign · # actual position · DELETE = CE · ENTER = ENT · ⇧ENTER = NO ENT · END · ESC = DEL'],['+ / −','Feed override'],
  ['P K B','Chips · coolant · smoke & fire'],['L','Labels'],['N','Next lesson step'],['HOME/END','First / last block'],['PGUP/PGDN','Page']];
$('klist').innerHTML=KEYS.map(([k,d])=>`<div><kbd>${k}</kbd><span>${d}</span></div>`).join('');

const VIEWS=['3D','TOP','FRONT','SIDE'];
addEventListener('keydown',e=>{
  const k=e.key, mod=e.ctrlKey||e.metaKey;
  if(!$('boot').hidden){ e.preventDefault(); dismissBoot(); return; }
  if(S.aiLive&&!S.aiLive.done&&!openModalEl){ if(k==='Escape'&&aiAbort){ e.preventDefault(); aiAbort.abort(); } return; }
  if(openModalEl){ if(k==='Escape'){ e.preventDefault(); closeModal(); } return; }
  if(mod&&k.toLowerCase()==='s'){ e.preventDefault(); saveH(); return; }
  if(mod&&k.toLowerCase()==='o'){ e.preventDefault(); loadFromDisk(); return; }
  if(S.wiz){ if(e.target!==dlgIn) dlgIn.focus(); if(wizKey(e)) e.preventDefault(); return; }
  if(S.pick&&k==='Escape'){ e.preventDefault(); if(S.pickPath&&S.pickPath.length>2&&S.pickPath[1]==='CYCL DEF') act('cycldef'); else { S.pick=null; renderSK(); } return; }
  if(S.tt&&k==='Escape'){ e.preventDefault(); closeTT(); return; }
  if(S.editing&&e.target!==dlgIn){                               // editing a block: keys belong to the block line
    if(k==='Tab'){ e.preventDefault(); dlgIn.focus(); ghostAccept(); } else if(k==='Enter'){ e.preventDefault(); endEdit(true); } else if(k==='Escape'){ e.preventDefault(); endEdit(false); } else dlgIn.focus(); return; }
  if(S.editing||S.raw) return;
  const tg=e.target.tagName; if(tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT') return;
  if(mod&&(k==='y'||(k.toLowerCase()==='z'&&e.shiftKey))){ e.preventDefault(); redo(); return; }
  if(mod&&k.toLowerCase()==='z'){ e.preventDefault(); undo(); return; }
  if(mod||e.altKey) return;                                       // leave browser shortcuts alone
  if(S.mgt){ mgtKey(e); return; }
  const nb=(S.res.blocks||[]).length;
  switch(k){
    case 'ArrowUp': e.preventDefault(); moveCursor(S.cursor-1); followCursor(); break;
    case 'ArrowDown': e.preventDefault(); moveCursor(S.cursor+1); followCursor(); break;
    case 'ArrowLeft': e.preventDefault(); S.running=false; seek(S.t-(e.shiftKey?5:1),false); break;
    case 'ArrowRight': e.preventDefault(); S.running=false; seek(S.t+(e.shiftKey?5:1),false); break;
    case 'Enter': e.preventDefault(); if(S.mode==='edit') beginEdit(); else stepBlock(); break;
    case 'Escape': e.preventDefault(); if(!alarmEl.hidden) hideAlarm(); else stop(); break;
    case ' ': e.preventDefault(); S.running?stop():ncStart(); break;
    case 'Home': e.preventDefault(); moveCursor(0); break;
    case 'End': e.preventDefault(); moveCursor(nb-1); break;
    case 'PageUp': e.preventDefault(); moveCursor(S.cursor-12); break;
    case 'PageDown': e.preventDefault(); moveCursor(S.cursor+12); break;
    case 'Tab': e.preventDefault(); toggleRaw(); break;
    case 'Delete': e.preventDefault(); deleteBlock(); break;
    case '+': case '=': act('ovru'); break;
    case '-': case '_': act('ovrd'); break;
    default:{
      const K=k.toLowerCase();
      if(/^[1-4]$/.test(k)) setMode(['edit','test','single','full'][+k-1]);
      else if(/^[5-9]$/.test(k)) setSpeed([1,4,16,64,0][+k-5]);
      else if(/^F[1-4]$/.test(k)){ e.preventDefault(); setMode(['edit','test','single','full'][+k[1]-1]); }
      else if(K==='t') act('tt'); else if(K==='f') toggleFocus();
      else if(S.mode==='edit'&&K==='y') act('cycldef'); else if(S.mode==='edit'&&K==='w') act('w:TOOLCALL');
      else if(S.mode==='edit'&&K==='a') act('apprdep'); else if(S.mode==='edit'&&K==='q') act('w:Q');
      else if(K==='s') stepBlock(); else if(K==='r') reset();
      else if(K==='e'){ e.preventDefault(); beginEdit(); } else if(K==='i'){ e.preventDefault(); insertBlock(); }
      else if(K==='d'){ e.preventDefault(); deleteBlock(); } else if(K==='c'){ e.preventDefault(); copyBlock(); }
      else if(K==='m'){ e.preventDefault(); openMgt(); } else if(K==='h'){ e.preventDefault(); openHelp(); }
      else if(K==='v'){ toggleFlow(); } else if(K==='g'){ setView(VIEWS[(VIEWS.indexOf(S.view)+1)%4]); }
      else if(K==='p') $('b-fx').click(); else if(K==='k') $('b-cool').click(); else if(K==='b') $('b-fire').click();
      else if(K==='l') $('b-labels').click(); else if(K==='n'&&S.lesson) $('coach-next').click();
    }
  }
});

/* ================= mobile panes ================= */
const mainEl=document.querySelector('.main');
function showPane(p){ if(!matchMedia('(max-width:900px)').matches) return; mainEl.dataset.pane=p;
  [...$('mtabs').children].forEach(b=>b.setAttribute('aria-selected',b.dataset.pane===p)); requestAnimationFrame(resize); }
$('mtabs').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) showPane(b.dataset.pane); });

/* ================= boot screen ================= */
function dismissBoot(){ $('boot').hidden=true; sess.set(BOOT_SS,'1'); if(PROF&&!PROF.name) openProfile(); }
$('boot').addEventListener('click',dismissBoot);

/* ================= render loop ================= */
function resize(){
  const r=gfxEl.getBoundingClientRect(); if(r.width<2||r.height<2) return;
  renderer.setSize(r.width,r.height,false); camera.aspect=r.width/r.height; camera.updateProjectionMatrix();
  if(FXO) try{ FXO.resize(r.height,camera.fov,renderer.getPixelRatio()); }catch(e){}
  if(CO) try{ CO.resize(r.width,r.height); }catch(e){}
  emit('resize',{w:r.width,h:r.height});
}
new ResizeObserver(resize).observe(gfxEl);
addEventListener('resize',resize);

let last=performance.now(), kvT=0, paintAcc=0;
function tick(now){
  const dt=Math.min(.1,(now-last)/1000); last=now;
  if(S.running&&S.speed>0){ const nt=S.t+dt*S.speed*(S.ovr/100);
    if(nt>=S.total){ seek(S.total,true); if(S.running){ S.running=false; setState('PROGRAM END · M2'); } } else seek(nt,true); }
  if(hmDirty){ paintAcc+=dt; if(paintAcc>(NX*NY>60000?.1:.05)){ paintHM(); paintAcc=0; } }
  if(gPath){ const n=S.segs.length?segAt(S.t)+1:0; gPath.geometry.setDrawRange(0,S.t>0?n*2:0); }
  renderDro(now);
  if(toolCutter&&S.seg&&S.seg.spindle&&!REDUCED) toolCutter.rotation.z+=dt*Math.sign(S.seg.spindle)*-Math.min(Math.abs(S.seg.spindle)/60,9)*Math.PI*2*.25;
  { const s=S.seg, p=S.pos;
    const cutting=!!(s&&p&&s.kind==='feed'&&s.spindle&&p.z<ST.z1-1e-3&&p.x>ST.x0-s.toolR&&p.x<ST.x1+s.toolR&&p.y>ST.y0-s.toolR&&p.y<ST.y1+s.toolR);
    if(FXO){ let dir={x:0,y:0}; if(s){ const dx=s.b.x-s.a.x, dy=s.b.y-s.a.y, l=Math.hypot(dx,dy); if(l>1e-6) dir={x:dx/l,y:dy/l}; }
      try{ FXO.update(dt,{running:S.running,cutting,pos:p?toWorld(p):{x:0,y:0,z:0},dir,toolR:s?s.toolR:3,spindle:s?s.spindle:0,
        coolant:!!(s&&s.coolant),speed:S.speed||64,stockTop:ST.z1}); }catch(e){} }
    if(BUS.tick) emit('tick',dt,{running:S.running,cutting,pos:p?toWorld(p):null,seg:s}); }
  traceTick(dt);
  if(now-kvT>250){ kvT=now; renderKV();
    const b=S.res.blocks[S.cursor];
    $('ovl-l').innerHTML=`PGM <b style="color:var(--cyan)">${esc(S.pgm)}</b><br>BLOCK <b>${b&&b.n!=null?b.n:'--'}</b> / ${(S.res.blocks.filter(x=>x.n!=null).pop()||{n:0}).n}<br>`+
      `BLANK <b>${fmt(ST.x1-ST.x0)}×${fmt(ST.y1-ST.y0)}×${fmt(ST.z1-ST.z0)}</b> mm`;
    $('ovl-r').innerHTML=`${S.view} · ${S.speed?S.speed+'×':'MAX'}<br>${fmtT(S.t)} / ${fmtT(S.total)}<br>OVR <b style="color:var(--amber)">${S.ovr}%</b>`; }
  controls.update();
  if(CO) try{ CO.update(); }catch(e){}
  const draw=()=>{ if(UIAPI.render) try{ UIAPI.render(scene,camera); return; }catch(e){ UIAPI.render=null; } renderer.render(scene,camera); };
  if(S.shake>0){ const o=camera.position.clone(), k=S.shake*4; camera.position.x+=(Math.random()-.5)*k; camera.position.y+=(Math.random()-.5)*k; camera.position.z+=(Math.random()-.5)*k;
    draw(); camera.position.copy(o); S.shake=Math.max(0,S.shake-dt*2.2); }
  else draw();
  requestAnimationFrame(tick);
}

/* ================= boot ================= */
(window.TNC_UI_PLUGINS||[]).forEach(fn=>{ try{ fn(UIAPI); }catch(e){ console.warn('plugin failed',e); } });
(async function boot(){
let fresh=false;
try{ PROF=await PSTORE.load(); }catch(e){ PROF=null; }
if(!PROF){ PROF=PSTORE.legacy()||PSTORE.blank(''); fresh=true; }
loadStore();
if(fresh) persist();
raw.value=S.text;
document.querySelector('.ttl').textContent=M().label;
if($('mach-sel')) $('mach-sel').value=S.machine;
[...$('spd').children].forEach(b=>b.dataset.on=(+b.dataset.s===S.speed)?'1':'0');
[...document.querySelectorAll('.mode')].forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===S.mode));
document.body.classList.toggle('focus',S.focusView); if($('b-focus')) $('b-focus').setAttribute('aria-pressed',S.focusView);
if(window.TNC_I18N) try{ TNC_I18N.set(TNC_I18N.lang||'en'); }catch(e){}
compile(); renderSK(); renderProjects(); syncToggles(); keyPill(); resize(); profChip(); setSideTab(S.sideTab); renderUserPrograms();
if(S.flowView&&window.TNC_FLOW){ S.flowView=false; toggleFlow(); }
const flash=sess.get('tnc.flash'); if(flash){ sess.del('tnc.flash'); setTimeout(()=>say(flash),400); }
const embedded=!!(window.TNC_BRIDGE&&TNC_BRIDGE.embedded);      // inside the web app: no splash, no name prompt
if(!embedded&&!sess.get(BOOT_SS)) $('boot').hidden=false;
else if(!embedded&&!PROF.name) openProfile();
requestAnimationFrame(tick);
emit('ready');
})();
})();

