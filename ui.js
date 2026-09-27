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

function download(name, blob){
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
      cool:S.fxCool, fire:S.fxFire, labels:S.labels, sound:S.sound, machine:S.machine, flow:S.flowView}));
    const path=location.pathname.replace(/[^/]*$/,'')||'/';
    document.cookie=`${PREF}=${v}; Max-Age=31536000; Path=${path}; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;
  }catch(e){}
  if(PROF) persist();
}
const prefsNow=()=>({speed:S.speed, ovr:S.ovr, view:S.view, mode:S.mode, fx:S.fx, cool:S.fxCool, fire:S.fxFire, labels:S.labels, sound:S.sound, machine:S.machine, flow:S.flowView});

/* ================= machines ================= */
const MACHINES={
  '426':{ id:'426', label:'TNC 426', axes:['X','Y','Z'], tools:TNC.TOOLS,
    run:t=>TNC.run(t,{tools:mtools('426')}), expand:r=>TNC_SIM.expand(r),
    analyse:(r,ex)=>TNC_SIM.analyse(r,ex,TNC_SIM.grid(r.stock,ex.segs)),
    programs:window.TNC_PROGRAMS||{}, lessons:window.TNC_LESSONS||null }
};
Object.keys(window.TNC_MACHINES||{}).forEach(k=>{ MACHINES[k]=window.TNC_MACHINES[k]; });
const M=()=>MACHINES[S.machine];

/* ================= state ================= */
const P=readPrefs();
const S={
  machine: MACHINES[P.machine]?P.machine:'426',
  pgms:{}, orig:{}, cur:{}, tools:{}, projects:[], active:null, pgm:null, text:'',
  res:null, ex:{segs:[],total:0}, segs:[], total:0, events:[], evIdx:0,
  t:0, stampT:0, running:false,
  speed:[1,4,16,64,0].includes(P.speed)?P.speed:4, ovr:clamp(+P.ovr||100,0,150),
  mode:['edit','test','single','full'].includes(P.mode)?P.mode:'test',
  view:['3D','TOP','FRONT','SIDE'].includes(P.view)?P.view:'3D',
  cursor:0, editing:false, raw:false, mgt:false, mgtSel:0, flowView:!!P.flow,
  fx:P.fx!==undefined?!!P.fx:!REDUCED, fxCool:P.cool!==undefined?!!P.cool:true, fxFire:!!P.fire,
  labels:P.labels!==undefined?!!P.labels:true, sound:P.sound!==undefined?!!P.sound:true,
  ref:null, pos:null, seg:null, shake:0, lesson:null, focus:null, execB:-1
};
const TEMP='LESSON.H';
const pg=()=>S.pgms[S.machine]||(S.pgms[S.machine]={});

/* ---------- the operator profile (profile.js): IndexedDB, autosaved, exported by hand ---------- */
const PSTORE=window.TNC_PROFILE||{ load:()=>Promise.resolve(null), save:()=>Promise.resolve(false), wipe:()=>Promise.resolve(),
  blank:n=>({v:2,name:n||'',created:new Date().toISOString(),prefs:{},machines:{},projects:[],active:null}), legacy:()=>null };
let PROF=null;
/* the machine's tool table: built-ins, overridden / extended by the operator's own TOOL.T */
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
    machines[id]={pgms:pg_, cur:S.cur[id]||null, tools:S.tools[id]||[]}; }
  return Object.assign({}, PROF||PSTORE.blank(''), {v:2, machines, projects:S.projects, active:S.active, prefs:prefsNow()});
}
let persistT=0;
function persist(){
  if(!PROF) return;
  clearTimeout(persistT);
  persistT=setTimeout(()=>{ PROF=profileNow(); PSTORE.save(PROF).then(r=>{ profChip(r); }); },300);
}

/* ================= undo / redo (per program) ================= */
const UNDO={}, REDO={};
const ukey=()=>S.machine+':'+S.pgm;
function snapshot(){ const k=ukey(); (UNDO[k]=UNDO[k]||[]).push({text:S.text,cursor:S.cursor});
  if(UNDO[k].length>200) UNDO[k].shift(); REDO[k]=[]; }
function setText(t){ S.text=t; pg()[S.pgm]=t; raw.value=t; compile(); persist(); }
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
  S.evIdx=0; S.t=0; S.stampT=0; S.running=false; S.execB=-1; hideAlarm();
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
  get state(){ return S; }, surfaceAt:(x,y)=>surfaceAt(x,y), say:m=>say(m) };
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
  curToolT=t; const e=toolEntry(t);
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
    if(e&&toolHolder) CO.add('holder',toolHolder,/FACEMILL/.test(e.name)?'SK40 SHELL-MILL ARBOR':(/PROBE/.test(e.name)?'TS 640 PROBE BODY':'SK40 DIN 69871 · ER COLLET CHUCK'),{anchor:[0,0,0],offset:[80,-20],color:'#a596ff'});
    const mesh=stockH?stockH.mesh:gStock;
    if(mesh) CO.add('part',mesh,`BLANK ${fmt(st.x1-st.x0)}×${fmt(st.y1-st.y0)}×${fmt(st.z1-st.z0)} ${alloy}`,{anchor:[st.x1,st.y0,st.z1],offset:[40,40],color:'#63e6b0'});
  }catch(err){}
}
const fmt=v=>(Math.round(v*100)/100).toString();

/* ---------- height field (3-axis material model) ---------- */
function buildHeightField(){
  const st=ST, w=st.x1-st.x0, h=st.y1-st.y0;
  const g=TNC_SIM.grid(st,S.segs); NX=g.NX; NY=g.NY; DX=g.DX; DY=g.DY;
  HM=new Float32Array(NX*NY).fill(st.z1);
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
  paintHM();
}
function stampDisc(cx,cy,z,r,cone){
  const st=ST;
  const i0=Math.max(0,Math.floor((cx-r-st.x0)/DX)), i1=Math.min(NX-1,Math.ceil((cx+r-st.x0)/DX));
  const j0=Math.max(0,Math.floor((cy-r-st.y0)/DY)), j1=Math.min(NY-1,Math.ceil((cy+r-st.y0)/DY));
  const r2=r*r;
  for(let j=j0;j<=j1;j++){ const dy=st.y0+j*DY-cy;
    for(let i=i0;i<=i1;i++){ const dx=st.x0+i*DX-cx, d2=dx*dx+dy*dy; if(d2>r2) continue;
      const zz=cone?z+Math.sqrt(d2):z, k=j*NX+i;          // chamfer & spot tools cut a 45° flank
      if(zz<HM[k]){ HM[k]=Math.max(st.z0,zz); hmDirty=true; } } }
}
function cutSeg(s,u0,u1){
  if(s.kind!=='feed'||!s.spindle) return;             // no removal with the spindle stopped: that is a crash, shown as such
  const len=s.len*(u1-u0); if(len<=0) return;
  const step=Math.max(0.3,Math.min(s.toolR*0.45,2)), n=Math.max(1,Math.ceil(len/step));
  for(let i=0;i<=n;i++){ const u=u0+(u1-u0)*(i/n);
    stampDisc(s.a.x+(s.b.x-s.a.x)*u, s.a.y+(s.b.y-s.a.y)*u, s.a.z+(s.b.z-s.a.z)*u, s.toolR, s.cone); }
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
  const segs=S.segs.filter(s=>s.block===bi);
  if(!segs.length){ gTrace.visible=gComet.visible=false; return; }
  const p=new Float32Array(segs.length*6); let L=0; const cum=[0];
  segs.forEach((s,i)=>{ p.set([s.a.x,s.a.y,s.a.z,s.b.x,s.b.y,s.b.z],i*6); L+=s.len; cum.push(L); });
  gTrace.geometry.setAttribute('position',new THREE.BufferAttribute(p,3)); gTrace.geometry.computeBoundingSphere();
  trace={segs,cum,L,u:0,period:clamp(L/60,0.9,3.2)};
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
  const show=!S.running && !S.lesson?.hideTrace;
  gTrace.visible=gComet.visible=show; if(!show) return;
  trace.u=(trace.u+dt/trace.period)%1;
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
  if(!S.segs.length) return;
  const b=S.segs[segAt(S.t)].block;
  if(b!==S.execB){ S.execB=b; if(!S.editing){ S.cursor=b; } markRows(); flowHighlight(); }
}
function reset(){ S.running=false; seek(0,false); hideAlarm(); if(FXO) FXO.clear(); setState('READY'); traceFor(S.cursor); }
function start(){
  if(!S.segs.length){ say('NO MOVES TO RUN'); return; }
  if(S.t>=S.total-1e-6){ seek(0,false); if(FXO) FXO.clear(); }
  hideAlarm('crash'); S.running=true; setState(S.mode==='single'?'SINGLE BLOCK':'RUNNING');
  if(S.speed===0) runMax();
}
function stop(){ if(S.running){ S.running=false; setState('FEED HOLD'); } }
function runMax(){ S.running=false; seek(S.total,true); if(S.t>=S.total-1e-6) setState('PROGRAM END'); }
function stepBlock(){
  if(!S.segs.length) return;
  const i=segAt(S.t), b=S.segs[i].block; let j=i; while(j<S.segs.length&&S.segs[j].block===b) j++;
  S.running=false; seek(j<S.segs.length?S.segs[j].t0+1e-6:S.total,true);
  if(!/CRASH/.test($('run-state').textContent)) setState('SINGLE BLOCK');
}
function setState(s){ $('run-state').textContent=s; }

/* ================= alarms ================= */
const alarmEl=$('alarm'); let alarmT=0;
function raise(ev){
  const at=ev.at?` · T${ev.tool} X${ev.at.x.toFixed(2)} Y${ev.at.y.toFixed(2)} Z${ev.at.z.toFixed(2)}`:'';
  if(ev.sev==='crash'){
    showAlarm('crash','CRASH',`BLOCK ${nOf(ev.block)} · ${ev.msg.replace(/^CRASH:\s*/,'')}${at}`);
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
function moveCursor(i){ S.cursor=clamp(i,0,Math.max(0,S.res.blocks.length-1)); markRows(); }
plist.addEventListener('click',e=>{ const d=e.target.closest('.blk'); if(!d) return;
  moveCursor(+d.dataset.i); const s=S.segs.find(x=>x.block===S.cursor); if(s&&!S.running) seek(s.t0+1e-6,false); });
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
  $('elist').innerHTML=items.length?items.map((x,i)=>`<div class="${x.cls}" data-k="${i}">BLOCK ${nOf(x.block)} &nbsp;${esc(x.msg)}</div>`).join('')
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
  else if(gTool) gTool.position.set(x,y,z);
  if(now-droT<66) return; droT=now;
  const extra=(M().axes||[]).filter(a=>/[ABC]/.test(a)).map(a=>{ const k=a.toLowerCase(); let v=0;
    if(s&&s.a&&s.a[k]!=null) v=s.a[k]+((s.b[k]||0)-s.a[k])*u; return ['s',a,(+v).toFixed(3)]; });
  const R=[['x','X',x.toFixed(3)],['y','Y',y.toFixed(3)],['z','Z',z.toFixed(3)],...extra,
           ['s','S',Math.abs(sp)+(sp<0?' M4':sp>0?' M3':' M5')],['f','F',s&&s.kind==='rapid'?'FMAX':f]];
  $('dro').innerHTML=R.map(([c,a,v])=>`<div class="drow ${c}"><span class="ax">${a}</span><span class="val">${v}</span></div>`).join('');
  $('dro-t').textContent='T'+tl+' · ACTL MM';
}

/* ================= soft keys ================= */
const sks=$('sks');
const SK={
  edit:  [['INSERT','ins'],['DELETE','del'],['EDIT','ed'],['COPY','cp'],['UNDO','undo'],['REDO','redo'],['RAW\nTEXT','rawt'],['CHECK','chk']],
  test:  [['START','start'],['START\nSINGLE','step'],['RESET\n+ START','rs'],['STOP','stop'],['3-D\nVIEW','v3'],['PLAN\nVIEW','vt'],['FRONT','vf'],['SIDE','vs']],
  single:[['NC\nSTART','step'],['NC\nSTOP','stop'],['RESET','reset'],['OVR\n−','ovrd'],['OVR\n+','ovru'],['TOOL\nTABLE','tt'],['FLOW\nVIEW','flow'],['PGM\nMGT','mgt']],
  full:  [['NC\nSTART','start'],['NC\nSTOP','stop'],['RESET','reset'],['OVR\n−','ovrd'],['OVR\n+','ovru'],['3-D\nVIEW','v3'],['FLOW\nVIEW','flow'],['PGM\nMGT','mgt']],
  mgt:   [['NEW','new'],['OPEN','open'],['LOAD\nFROM PC','load'],['SAVE\n.H','save'],['RESTORE\nORIGINAL','restore'],['DELETE','mdel'],['ADD TO\nPROJECT','padd'],['END','end']]
};
function renderSK(){ sks.innerHTML=(SK[S.mgt?'mgt':S.mode]||SK.test).map(([l,a])=>`<button class="sk" data-a="${a}">${esc(l).replace(/\n/g,'<br>')}</button>`).join(''); }
sks.addEventListener('click',e=>{ const b=e.target.closest('.sk'); if(b) act(b.dataset.a); });
function act(a){
  switch(a){
    case 'start': start(); break; case 'stop': stop(); break; case 'step': stepBlock(); break;
    case 'reset': reset(); break; case 'rs': reset(); start(); break;
    case 'v3': setView('3D'); break; case 'vt': setView('TOP'); break; case 'vf': setView('FRONT'); break; case 'vs': setView('SIDE'); break;
    case 'ovrd': S.ovr=Math.max(0,S.ovr-10); renderKV(); writePrefs(); say('FEED OVERRIDE '+S.ovr+'%'); break;
    case 'ovru': S.ovr=Math.min(150,S.ovr+10); renderKV(); writePrefs(); say('FEED OVERRIDE '+S.ovr+'%'); break;
    case 'ed': beginEdit(); break; case 'ins': insertBlock(); break; case 'del': deleteBlock(); break; case 'cp': copyBlock(); break;
    case 'undo': undo(); break; case 'redo': redo(); break; case 'rawt': toggleRaw(); break;
    case 'chk': compile(); say(S.res.errors.length?`CHECK: ${S.res.errors.length} ERROR(S)`:(S.events.some(e=>e.sev==='crash')?'CHECK: WILL CRASH — SEE CHECKS':'PROGRAM CHECKED OK')); break;
    case 'tt': showTools(); break; case 'flow': toggleFlow(); break; case 'mgt': openMgt(); break;
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
  dlgPr.textContent='BLOCK '+(b.n==null?'':b.n); dlgHint.textContent='ENT accept · ESC cancel';
  dlgIn.focus(); dlgIn.select();
}
function endEdit(accept){
  if(!S.editing) return;
  const val=dlgIn.value; S.editing=false; dlgIn.disabled=true; dlgIn.value='';
  dlgPr.textContent='BLOCK'; dlgHint.textContent='E edit · I insert · D delete';
  if(accept){ const ls=lines(), i=srcLine(S.cursor), ind=(ls[i].match(/^\s*/)||[''])[0];
    ls[i]=(S.res.blocks[S.cursor]&&S.res.blocks[S.cursor].indent?ind:'')+val.trim(); edit(ls.join('\n'),S.cursor,'BLOCK '+nOf(S.cursor)+' STORED'); }
  document.activeElement&&document.activeElement.blur();
}
function insertBlock(){ const ls=lines(), i=srcLine(S.cursor); ls.splice(i+1,0,'L X+0 Y+0 R0 F500'); edit(ls.join('\n'),S.cursor+1); beginEdit(); }
function deleteBlock(){ const ls=lines(); if(ls.length<=1) return; const i=srcLine(S.cursor), n=nOf(S.cursor);
  ls.splice(i,1); edit(ls.join('\n'),S.cursor,'BLOCK '+n+' DELETED — CTRL+Z TO UNDO'); }
function copyBlock(){ const ls=lines(), i=srcLine(S.cursor); ls.splice(i+1,0,ls[i]); edit(ls.join('\n'),S.cursor+1,'BLOCK COPIED'); }
dlgIn.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); endEdit(true); }
  else if(e.key==='Escape'){ e.preventDefault(); endEdit(false); } e.stopPropagation(); });
function toggleRaw(){
  S.raw=!S.raw; raw.hidden=!S.raw; crt.hidden=S.raw;
  if(S.raw){ raw.value=S.text; raw.focus(); say('RAW TEXT — TAB TO RETURN'); }
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
}
function addPgm(name,text,{open=true,project=true}={}){
  const n=uniqueName(name); pg()[n]=text;
  if(project&&S.active){ const p=S.projects.find(p=>p.id===S.active); if(p&&!p.pgms.some(r=>r.m===S.machine&&r.name===n)) p.pgms.push({m:S.machine,name:n}); }
  persist(); renderProjects(); if(open) openPgm(n); return n;
}
function deletePgm(name){
  if(!name) return;
  if(S.orig[S.machine][name]!=null){ say('BUILT-IN PROGRAM — USE RESTORE ORIGINAL INSTEAD'); return; }
  if(!confirm('Delete '+name+'? This cannot be undone.')) return;
  delete pg()[name]; S.projects.forEach(p=>p.pgms=p.pgms.filter(r=>!(r.m===S.machine&&r.name===name)));
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
function openMgt(){ if(S.editing) endEdit(false); if(S.raw) toggleRaw(); S.running=false; S.mgt=true;
  S.mgtSel=Math.max(0,mgtNames().indexOf(S.pgm)); plist.hidden=true; $('flow').hidden=true; mgtEl.hidden=false;
  renderMgt(); renderSK(); $('pgm-path').textContent='TNC:\\  PGM MGT'; setState('PGM MGT'); showPane('pgm'); }
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
  $('proj-t').textContent=act?act.name:'none active';
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
  $('b-view').textContent=S.flowView?'Listing':'Flow'; if(S.flowView) flowUpdate(); writePrefs(); showPane('pgm');
}
$('b-view').onclick=toggleFlow;
if(!window.TNC_FLOW) $('b-view').hidden=true;

/* ================= lessons: the coach ================= */
const coach=$('coach');
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
  coach.hidden=false; $('coach-k').textContent=kind==='learn'?'LEARN':'BREAK IT';
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
  if(!S.lesson) return; const prev=S.lesson.prev; S.lesson=null; S.focus=null; coach.hidden=true;
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
  body.innerHTML='<div class="prose">'+(Ls.manual||[]).map(sec=>`<h4>${esc(sec.title)}</h4>${md(sec.body)}`+
    (sec.rows&&sec.rows.length?`<div class="tblw"><table><thead><tr>${sec.rows[0].map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
      sec.rows.slice(1).map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'')).join('')+'</div>';
}
$('b-help').onclick=()=>openHelp();

/* ---------- AI setup + generation (ai.js) ---------- */
const AI=window.TNC_AI||null;
function getKey(){ return sess.get(KEY_LS)||local.get(KEY_LS)||window.TNC_AI_LOCAL_KEY||''; }   // last: .env, local build only
function getModel(){ return local.get(MODEL_LS)||(AI?AI.DEFAULT_MODEL:'deepseek/deepseek-v4.1-flash'); }
function keyPill(){ const p=$('ai-keypill'), k=getKey(); p.textContent=k?(k===window.TNC_AI_LOCAL_KEY&&!sess.get(KEY_LS)&&!local.get(KEY_LS)?'key from .env':'key set'):'no key'; p.className='pill '+(k?'ok':'no'); }
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
<li>Copy the key — it starts with <code>sk-or-v1-</code> — paste it below and press <strong>Test key</strong>.</li>
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
<label class="fld wide"><span>OPENROUTER API KEY</span><input id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-or-v1-…" value="${esc(k)}"></label>
<label class="fld wide"><span>MODEL</span><input id="ai-model" list="ai-models" spellcheck="false" value="${esc(getModel())}">
<datalist id="ai-models">${(AI?AI.MODELS:[]).map(m=>`<option value="${esc(m)}">`).join('')}</datalist></label>
<label class="fld chk wide"><input type="checkbox" id="ai-remember"${rem?' checked':''}> Remember the key in this browser</label>
</div>
<div class="actrow"><button class="cbtn pri" id="ai-test">Test key</button><button class="cbtn" id="ai-savekey">Save</button><button class="cbtn" id="ai-forget">Forget key</button></div>
<div class="aistat" id="ai-setstat" hidden></div>`;
}
function storeKey(k,rem){ sess.del(KEY_LS); local.del(KEY_LS); if(k){ if(rem) local.set(KEY_LS,k); else sess.set(KEY_LS,k); } keyPill(); }
function wireAiSetup(){
  const st=$('ai-setstat'), put=(h)=>{ st.hidden=false; st.innerHTML=h; };
  $('ai-savekey').onclick=()=>{ storeKey($('ai-key').value.trim(),$('ai-remember').checked); local.set(MODEL_LS,$('ai-model').value.trim()||getModel());
    put('<span class="ok">Saved.</span> '+($('ai-remember').checked?'Remembered in this browser.':'Kept for this tab only.')); };
  $('ai-forget').onclick=()=>{ storeKey('',false); $('ai-key').value=''; put('<span class="ok">Key forgotten</span> — removed from this browser.'); };
  $('ai-test').onclick=async()=>{
    const k=$('ai-key').value.trim(); if(!k){ put('<span class="bad">Paste a key first.</span>'); return; }
    if(!AI){ put('<span class="bad">The AI module is not in this build.</span>'); return; }
    storeKey(k,$('ai-remember').checked); local.set(MODEL_LS,$('ai-model').value.trim()||getModel()); put('<span class="dim">Checking the key with OpenRouter…</span>');
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
async function aiGenerate(){
  const out=$('ai-stat'), prompt=$('ai-prompt').value.trim(), key=getKey();
  const log=(h)=>{ out.hidden=false; out.innerHTML+=h+'\n'; out.scrollTop=out.scrollHeight; };
  out.innerHTML='';
  if(!AI){ log('<span class="bad">The AI module is not in this build.</span>'); return; }
  if(!key){ log('<span class="bad">No key yet.</span> Open <b>AI setup</b> first — it takes five minutes.'); return; }
  if(prompt.length<8){ log('<span class="bad">Describe the part in a sentence or two.</span>'); return; }
  const sys=AI.system?AI.system(mtools()):AI.FALLBACK_SYSTEM;   // ai.js owns the prompt; it lists this operator's tool table
  const btn=$('ai-go'); btn.disabled=true; btn.textContent='Working…'; aiAbort=new AbortController();
  log(`<span class="dim">Model ${esc(getModel())} · machine ${esc(M().label)}</span>`);
  try{
    const res=await AI.generate({key,model:getModel(),prompt,system:sys,verify:verifyProgram,signal:aiAbort.signal,maxRepairs:1,
      onStep:s=>{ if(s.phase==='request') log(s.attempt?'Sending the simulator\'s errors back for one repair…':'Writing the program…');
        if(s.phase==='checked'){ const r=s.report;
          log(r.ok?`<span class="ok">Checked: ${r.moves} moves, no errors, no crashes${r.warns.length?', '+r.warns.length+' warning(s)':''}.</span>`
                  :`<span class="bad">Checked: ${r.errs.length} error(s), ${r.crashes.length} crash(es).</span>\n${esc(r.text)}`); } }});
    const nm=addPgm((res.report.name||'AI_PART'),res.src,{open:true});
    log(`<span class="${res.report.ok?'ok':'bad'}">${res.report.ok?'Saved':'Saved anyway — still has problems, see Checks'} as ${esc(nm)}.</span> Cost about $${(res.cost||0).toFixed(4)}.`);
    setTimeout(()=>{ closeModal(); showPane('pgm'); },res.report.ok?900:2600);
  }catch(e){ log('<span class="bad">'+esc(aiErr(e))+'</span>'); }
  finally{ btn.disabled=false; btn.textContent='Generate'; aiAbort=null; }
}

/* ---------- NEW PROGRAM ---------- */
function openNew(which){
  openModal('m-new'); $('new-opts').hidden=false; $('new-scratch').hidden=true; $('new-ai').hidden=true;
  $('ns-tool').innerHTML=mtools().map(t=>`<option value="${t.t}"${t.t===4?' selected':''}>T${t.t} ${esc(t.name)} (R${t.r})</option>`).join('');
  keyPill(); if(which) newGo(which);
}
function newGo(w){
  if(w==='learn'){ openHelp('learn'); return; }
  $('new-opts').hidden=true; $('new-scratch').hidden=w!=='scratch'; $('new-ai').hidden=w!=='ai';
  (w==='scratch'?$('ns-name'):$('ai-prompt')).focus();
}
$('m-new').addEventListener('click',e=>{ const g=e.target.closest('[data-go]'); if(g) newGo(g.dataset.go);
  if(e.target.closest('[data-back]')){ $('new-opts').hidden=false; $('new-scratch').hidden=true; $('new-ai').hidden=true; } });
$('b-new').onclick=()=>openNew();
$('ai-go').onclick=aiGenerate; $('ai-setup').onclick=()=>openHelp('ai');
const sgn=v=>{ v=+v; return (v<0?'-':'+')+Math.abs(v); };
$('ns-go').onclick=()=>{
  const name=($('ns-name').value.trim()||'MY_PART').toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,16);
  const v=id=>parseFloat(String($(id).value).replace(',','.'));
  const x0=v('ns-x0'),y0=v('ns-y0'),z0=v('ns-z0'),x1=v('ns-x1'),y1=v('ns-y1'),z1=v('ns-z1'),s=Math.abs(parseInt($('ns-s').value,10)||0), t=+$('ns-tool').value;
  if([x0,y0,z0,x1,y1,z1].some(isNaN)||!(x1>x0&&y1>y0&&z1>z0)){ say('BLK FORM: MAX CORNER MUST BE ABOVE THE MIN CORNER ON EVERY AXIS'); return; }
  const txt=[`BEGIN PGM ${name} MM`,`BLK FORM 0.1 Z X${sgn(x0)} Y${sgn(y0)} Z${sgn(z0)}`,`BLK FORM 0.2 X${sgn(x1)} Y${sgn(y1)} Z${sgn(z1)}`,
    `TOOL CALL ${t} Z S${s}`,'L Z+50 R0 FMAX M3','; ---------- YOUR BLOCKS START HERE ----------',
    `L X${sgn(x0)} Y${sgn(y0)} R0 FMAX`,'L Z+100 R0 FMAX M5',`END PGM ${name} MM`].join('\n');
  closeModal(); addPgm(name,txt); setMode('edit'); moveCursor(5); showPane('pgm'); beginEdit();
  say('NEW PROGRAM — TYPE YOUR FIRST BLOCK, ENT TO STORE, I TO INSERT MORE');
};

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
<div class="actrow"><button class="cbtn pri" id="prof-export">Export profile (.zip)</button><button class="cbtn" id="prof-import">Import…</button>
 <button class="cbtn" id="prof-new">Start a new profile…</button></div>
<div id="prof-ask"></div>
<h4 class="sech">TOOL TABLE — ${esc(M().label)} <small>(TOOL.T · * = yours)</small></h4>
<div class="tblw"><table class="ttab"><thead><tr><th>T</th><th>NAME</th><th>L</th><th>R</th><th></th></tr></thead><tbody>${
  tools.map(x=>`<tr data-t="${x.t}"${x.mine?' class="mine"':''}><td>${x.t}${x.mine?' *':''}</td><td><input data-k="name" value="${esc(x.name)}" maxlength="16" aria-label="T${x.t} name"></td>
   <td><input data-k="l" inputmode="decimal" value="${(+x.l).toFixed(3)}" aria-label="T${x.t} length"></td><td><input data-k="r" inputmode="decimal" value="${(+x.r).toFixed(3)}" aria-label="T${x.t} radius"></td>
   <td>${x.mine?`<button data-del="${x.t}" title="Remove your entry" aria-label="Remove T${x.t}">×</button>`:''}</td></tr>`).join('')}</tbody></table></div>
<div class="actrow"><label class="fld" style="flex-direction:row;align-items:center;gap:6px"><span>T</span><input id="tt-new" inputmode="numeric" style="width:70px" aria-label="New tool number"></label>
 <button class="cbtn" id="tt-add">Add tool</button><button class="cbtn" id="tt-missing">Add tools this program calls</button><button class="cbtn" id="tt-export">Export TOOL.T</button></div>`;
  const nm=$('prof-name');
  nm.addEventListener('input',()=>{ PROF.name=nm.value.trim().slice(0,40); profChip(); persist(); });
  nm.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); nm.blur(); } });
  $('prof-export').onclick=exportProfile;
  $('prof-import').onclick=loadFromDisk;
  $('prof-new').onclick=newProfile;
  $('tt-add').onclick=()=>{ const t=parseInt($('tt-new').value,10); if(!(t>=0&&t<=32767)){ say('TOOL NUMBER 0–32767'); return; }
    mergeTools([{t,name:'T'+t,l:50,r:3}],true); };
  $('tt-missing').onclick=addMissingTools;
  $('tt-export').onclick=()=>{ if(!window.TNC_PROFILE) return; download('TOOL_TNC'+S.machine+'.T',new Blob([TNC_PROFILE.toolT(mtools())],{type:'text/plain'})); };
  const tb=$('prof-body').querySelector('.ttab');
  tb.addEventListener('change',e=>{ const inp=e.target.closest('input'); if(!inp) return; const tr=inp.closest('tr'), t=+tr.dataset.t;
    const cur=mtools().find(x=>x.t===t); if(!cur) return; const v=inp.dataset.k==='name'?inp.value.trim().toUpperCase().slice(0,16)||('T'+t):parseFloat(String(inp.value).replace(',','.'));
    if(inp.dataset.k!=='name'&&!isFinite(v)){ say('NOT A NUMBER'); renderProfile(); return; }
    if(inp.dataset.k==='r'&&v<0){ say('RADIUS MUST BE ≥ 0'); renderProfile(); return; }
    const e2={t,name:cur.name,l:+cur.l,r:+cur.r}; e2[inp.dataset.k]=v; mergeTools([e2],true); });
  tb.addEventListener('click',e=>{ const d=e.target.closest('[data-del]'); if(!d) return; const t=+d.dataset.del;
    S.tools[S.machine]=(S.tools[S.machine]||[]).filter(x=>x.t!==t); persist(); curToolT=null; compile(); renderProfile(); say('T'+t+' REMOVED FROM YOUR TABLE'); });
  if(!(PROF&&PROF.name)) setTimeout(()=>nm.focus(),30);
}
function mergeTools(list,quiet){
  const mine=(S.tools[S.machine]=S.tools[S.machine]||[]);
  list.forEach(n=>{ const i=mine.findIndex(x=>x.t===n.t); const e={t:n.t,name:String(n.name||'T'+n.t).toUpperCase().slice(0,16),l:+n.l||0,r:+n.r||0}; if(i>=0) mine[i]=e; else mine.push(e); });
  persist(); curToolT=null; compile(); if(openModalEl===$('m-prof')) renderProfile(); if(!quiet) say(list.length+' TOOL(S) IN YOUR TABLE');
}
/* uploaded programs: every TOOL CALL number missing from the table gets an entry (radius from ";T5 D=+8" or TOOL DEF, else R3) */
function toolsFor(texts){
  const have=new Set(mtools().map(t=>t.t)), add={};
  texts.forEach(t=>{ const hint={}, def=new Set();
    t.split(/\r?\n/).forEach(l=>{ let m; if((m=/;\s*T(\d+)\s+D=\s*([+-]?\d+\.?\d*)/i.exec(l))) hint[+m[1]]=Math.abs(parseFloat(m[2]))/2;
      if((m=/TOOL\s+DEF\s+(\d+)\s+L/i.exec(l))) def.add(+m[1]); });
    t.split(/\r?\n/).forEach(l=>{ const m=/TOOL\s+CALL\s+(\d+)/i.exec(l); if(!m) return; const n=+m[1];
      if(n&&!have.has(n)&&!def.has(n)&&!add[n]) add[n]={t:n,name:'T'+n+(hint[n]!=null?'_D'+(hint[n]*2):''),l:50,r:hint[n]!=null?hint[n]:3}; }); });
  const list=Object.values(add); if(list.length) mergeTools(list,true); return list.length;
}
/* tools called by the program but missing from the table: radius from a CAM comment (";T5 D=+8") when there is one */
function addMissingTools(){
  const miss=[...new Set((S.res.errors||[]).map(e=>(/^TOOL (\d+) NOT DEFINED/.exec(e.msg)||[])[1]).filter(Boolean).map(Number))];
  if(!miss.length){ say('EVERY TOOL THIS PROGRAM CALLS IS IN THE TABLE'); return; }
  const hint={}; S.text.split('\n').forEach(l=>{ const m=/;\s*T(\d+)\s+D=\s*([+-]?\d+\.?\d*)/i.exec(l); if(m) hint[+m[1]]=Math.abs(parseFloat(m[2]))/2; });
  mergeTools(miss.map(t=>({t,name:'T'+t+(hint[t]!=null?'_D'+(hint[t]*2):''),l:50,r:hint[t]!=null?hint[t]:3})),true);
  say(miss.length+' TOOL(S) ADDED'+(miss.some(t=>hint[t]==null)?' — CHECK THE RADII, SOME ARE GUESSES (R3)':' — RADII FROM THE PROGRAM COMMENTS'));
}
function exportProfile(){
  if(!window.TNC_PROFILE){ say('PROFILE MODULE MISSING FROM THIS BUILD'); return; }
  PROF=profileNow();
  const lst=(m,t)=>{ const keep=S.machine; S.machine=MACHINES[m]?m:keep; const r=listing(t); S.machine=keep; return r; };
  TNC_PROFILE.exportZip(PROF,lst).then(r=>{ download(r.name,r.blob); say('PROFILE EXPORTED — '+r.count+' PROGRAM(S)'); }).catch(e=>say(String(e.message||e)));
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
function setMode(m){ S.mode=m; [...document.querySelectorAll('.mode')].forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===m));
  if(!S.mgt) renderSK(); if(m==='edit'){ S.running=false; setState('EDITING'); } else setState('READY'); writePrefs(); }
$('modes').addEventListener('click',e=>{ const b=e.target.closest('.mode'); if(b) setMode(b.dataset.m); });
function setSpeed(v,quiet){ S.speed=v; [...$('spd').children].forEach(b=>b.dataset.on=(+b.dataset.s===v)?'1':'0'); writePrefs();
  if(v===0&&S.running) runMax(); if(!quiet) say(v?'SPEED '+v+'×':'MAX — RUNS TO THE END OR THE FIRST CRASH'); }
$('spd').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) setSpeed(+b.dataset.s); });
function syncToggles(){ $('b-fx').dataset.on=S.fx?'1':'0'; $('b-cool').dataset.on=S.fxCool?'1':'0'; $('b-fire').dataset.on=S.fxFire?'1':'0';
  $('b-labels').dataset.on=S.labels?'1':'0'; $('b-sound').dataset.on=S.sound?'1':'0'; fxApply(); if(CO) CO.setVisible(S.labels); writePrefs(); }
function tog(k,label){ S[k]=!S[k]; syncToggles(); say(label+(S[k]?' ON':' OFF')); }
$('b-fx').onclick=()=>tog('fx','CHIPS & SPARKS'); $('b-cool').onclick=()=>tog('fxCool','COOLANT');
$('b-fire').onclick=()=>tog('fxFire','SMOKE & FIRE'); $('b-labels').onclick=()=>tog('labels','LABELS'); $('b-sound').onclick=()=>tog('sound','SOUND');
if(!window.TNC_FX){ ['b-fx','b-cool','b-fire'].forEach(id=>$(id).hidden=true); }
if(!window.TNC_CALLOUTS) $('b-labels').hidden=true;
$('b-start').onclick=start; $('b-stop').onclick=stop; $('b-step').onclick=stepBlock; $('b-reset').onclick=reset;
scrub.addEventListener('input',()=>{ S.running=false; seek(+scrub.value/1000*S.total,false); });

const KEYS=[['↑ ↓','Block cursor'],['← →','Scrub the run (Shift ×5)'],['ENTER','Step one block · edit in EDIT mode'],['ESC','Stop · cancel · close'],
  ['SPACE','NC START / NC STOP'],['S · R','Single block · reset'],['E I D C','Edit · insert · delete · copy'],['CTRL+Z','Undo  (CTRL+SHIFT+Z / CTRL+Y redo)'],
  ['CTRL+S','Save as .H'],['CTRL+O','Load .H from your computer'],['TAB','Raw text editor'],['M','Program manager'],['H','Help, lessons, manual'],
  ['V','Flowchart view'],['G','3D / TOP / FRONT / SIDE'],['1 – 5','Speed 1× 4× 16× 64× MAX'],['F1 – F4','Operating mode'],['+ / −','Feed override'],
  ['P K B','Chips · coolant · smoke & fire'],['L','Labels'],['N','Next lesson step'],['HOME/END','First / last block'],['PGUP/PGDN','Page']];
$('klist').innerHTML=KEYS.map(([k,d])=>`<div><kbd>${k}</kbd><span>${d}</span></div>`).join('');

const VIEWS=['3D','TOP','FRONT','SIDE'];
addEventListener('keydown',e=>{
  const k=e.key, mod=e.ctrlKey||e.metaKey;
  if(!$('boot').hidden){ e.preventDefault(); dismissBoot(); return; }
  if(openModalEl){ if(k==='Escape'){ e.preventDefault(); closeModal(); } return; }
  if(mod&&k.toLowerCase()==='s'){ e.preventDefault(); saveH(); return; }
  if(mod&&k.toLowerCase()==='o'){ e.preventDefault(); loadFromDisk(); return; }
  if(S.editing||S.raw) return;
  const tg=e.target.tagName; if(tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT') return;
  if(mod&&(k==='y'||(k.toLowerCase()==='z'&&e.shiftKey))){ e.preventDefault(); redo(); return; }
  if(mod&&k.toLowerCase()==='z'){ e.preventDefault(); undo(); return; }
  if(mod||e.altKey) return;                                       // leave browser shortcuts alone
  if(S.mgt){ mgtKey(e); return; }
  const nb=(S.res.blocks||[]).length;
  switch(k){
    case 'ArrowUp': e.preventDefault(); moveCursor(S.cursor-1); break;
    case 'ArrowDown': e.preventDefault(); moveCursor(S.cursor+1); break;
    case 'ArrowLeft': e.preventDefault(); S.running=false; seek(S.t-(e.shiftKey?5:1),false); break;
    case 'ArrowRight': e.preventDefault(); S.running=false; seek(S.t+(e.shiftKey?5:1),false); break;
    case 'Enter': e.preventDefault(); if(S.mode==='edit') beginEdit(); else stepBlock(); break;
    case 'Escape': e.preventDefault(); if(!alarmEl.hidden) hideAlarm(); else stop(); break;
    case ' ': e.preventDefault(); S.running?stop():start(); break;
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
      if(/^[1-5]$/.test(k)) setSpeed([1,4,16,64,0][+k-1]);
      else if(/^F[1-4]$/.test(k)){ e.preventDefault(); setMode(['edit','test','single','full'][+k[1]-1]); }
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
compile(); renderSK(); renderProjects(); syncToggles(); keyPill(); resize(); profChip();
if(S.flowView&&window.TNC_FLOW){ S.flowView=false; toggleFlow(); }
const flash=sess.get('tnc.flash'); if(flash){ sess.del('tnc.flash'); setTimeout(()=>say(flash),400); }
if(!sess.get(BOOT_SS)) $('boot').hidden=false;
else if(!PROF.name) openProfile();
requestAnimationFrame(tick);
})();
})();

