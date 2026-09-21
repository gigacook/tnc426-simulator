/* ============================================================
   TNC 426 SIMULATOR — UI, graphics and machine behaviour
   Depends on: THREE, THREE.OrbitControls, TNC (core.js)
   ============================================================ */
(function(){
'use strict';

/* ---------- sample program (editable) ---------- */
const SAMPLE = [
'BEGIN PGM BRACKET MM',
'BLK FORM 0.1 Z X+0 Y+0 Z-20',
'BLK FORM 0.2 X+120 Y+80 Z+0',
'; ---------- FACE THE TOP ----------',
'TOOL CALL 6 Z S1200',
'L Z+50 R0 FMAX M3',
'L X-30 Y+15 R0 FMAX M8',
'L Z-0.5 R0 FMAX',
'L X+150 R0 F900',
'L Y+40 R0 FMAX',
'L X-30 R0 F900',
'L Y+65 R0 FMAX',
'L X+150 R0 F900',
'L Z+50 R0 FMAX',
'; ---------- RECTANGULAR POCKET, 3 PASSES ----------',
'TOOL CALL 5 Z S3200',
'FN 0: Q1 = -3',
'FN 0: Q2 = +0',
'L Z+50 R0 FMAX',
'L X+30 Y+25 R0 FMAX',
'L Z+1 R0 FMAX',
'LBL 1',
'FN 1: Q2 = +Q2 + +Q1',
'L Z+Q2 R0 F220',
'L X+90 Y+25 R0 F700',
'L X+90 Y+55 R0',
'L X+30 Y+55 R0',
'L X+30 Y+25 R0',
'CALL LBL 1 REP 3/3',
'L Z+50 R0 FMAX',
'; ---------- CIRCULAR SLOT ----------',
'L X+78 Y+40 R0 FMAX',
'L Z+1 R0 FMAX',
'L Z-6 R0 F200',
'CC X+60 Y+40',
'C X+42 Y+40 DR+',
'C X+78 Y+40 DR+',
'L Z+50 R0 FMAX',
'; ---------- 4 HOLES ----------',
'TOOL CALL 2 Z S2400',
'CYCL DEF 200 DRILLING',
'  Q200=2   ;SET-UP CLEARANCE',
'  Q201=-22 ;DEPTH',
'  Q206=180 ;FEED RATE FOR PLNGNG',
'  Q202=6   ;PLUNGING DEPTH',
'  Q210=0   ;DWELL TIME AT TOP',
'  Q203=+0  ;SURFACE COORDINATE',
'  Q204=30  ;2ND SET-UP CLEARANCE',
'L Z+50 R0 FMAX M3',
'L X+15 Y+15 R0 FMAX M99',
'L X+105 Y+15 R0 FMAX M99',
'L X+105 Y+65 R0 FMAX M99',
'L X+15 Y+65 R0 FMAX M99',
'L Z+100 R0 FMAX M9',
'TOOL CALL 0 Z',
'L Z+250 R0 FMAX M2',
'END PGM BRACKET MM'
].join('\n');

/* ---------- state ---------- */
const S = {
  pgms: Object.assign({'BRACKET.H':SAMPLE}, window.TNC_PROGRAMS||{}),
  pgm: (window.TNC_PROGRAMS&&TNC_PROGRAMS['TRIFUNOVIC.H'])?'TRIFUNOVIC.H':'BRACKET.H',
  text: (window.TNC_PROGRAMS&&TNC_PROGRAMS['TRIFUNOVIC.H'])||SAMPLE,
  res: null,          // TNC.run result
  segs: [],           // expanded, timed segments
  total: 0,           // total seconds
  t: 0,               // sim time
  stampT: 0,          // material removed up to this time
  running: false,
  speed: 4,
  mode: 'test',
  cursor: 0,
  editing: false,
  view: '3D',
  ovr: 100,           // feed override %
  ref: null,          // comparison reference {stats, text}
  raw: false
};

/* ---------- dom ---------- */
const $ = id => document.getElementById(id);
const plist=$('plist'), crt=$('crt'), dlgIn=$('dlg-in'), dlgPr=$('dlg-pr'), dlgHint=$('dlg-hint'),
      sks=$('sks'), scrub=$('scrub'), toast=$('toast'), raw=$('raw');

function say(msg){ toast.textContent=msg; toast.classList.add('on');
  clearTimeout(say._t); say._t=setTimeout(()=>toast.classList.remove('on'),1600); }

/* ============================================================
   COMPILE + SEGMENT EXPANSION
   ============================================================ */
function tessArc(mv, out){
  const {from,to,cx,cy,ccw}=mv;
  const r=Math.hypot(from.x-cx, from.y-cy);
  let a0=Math.atan2(from.y-cy, from.x-cx), a1=Math.atan2(to.y-cy, to.x-cx);
  let sweep=a1-a0;
  if(ccw){ while(sweep<=1e-9) sweep+=Math.PI*2; }
  else   { while(sweep>=-1e-9) sweep-=Math.PI*2; }
  const n=Math.max(6, Math.ceil(Math.abs(sweep)/(Math.PI/36)));
  let prev=from;
  for(let i=1;i<=n;i++){
    const a=a0+sweep*(i/n);
    const p={x:cx+r*Math.cos(a), y:cy+r*Math.sin(a), z:from.z+(to.z-from.z)*(i/n)};
    out.push([prev,p]); prev=p;
  }
}

function expand(res){
  const segs=[]; let t=0;
  const rapid=res.stats.rapidRate||18000;
  for(const mv of res.moves){
    const pairs=[];
    if(mv.kind==='arc' && mv.cx!=null) tessArc(mv,pairs);
    else pairs.push([mv.from,mv.to]);
    for(const [a,b] of pairs){
      const len=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
      if(len<1e-9) continue;
      const f = mv.kind==='rapid' ? rapid : Math.max(1, mv.feed||500);
      const dt = len/f*60;
      segs.push({a,b,len,f,kind:mv.kind==='rapid'?'rapid':'feed',
                 block:mv.block, tool:mv.tool, toolR:mv.toolR||3,
                 spindle:mv.spindle||0, coolant:!!mv.coolant, cycle:mv.cycle||null,
                 t0:t, t1:t+dt});
      t+=dt;
    }
  }
  return {segs, total:t};
}

function compile(){
  S.pgms[S.pgm]=S.text;
  let res;
  try { res = TNC.run(S.text); }
  catch(e){ res={blocks:[],moves:[],stock:{x0:0,y0:0,z0:-20,x1:120,y1:80,z1:0},
            stats:{},errors:[{block:0,msg:'INTERNAL: '+e.message}]}; }
  S.res=res;
  const ex=expand(res); S.segs=ex.segs; S.total=ex.total;
  S.t=0; S.stampT=0; S.running=false;
  buildScene();
  renderList(); renderErrors(); renderKV(); renderCompare();
  scrub.max=1000; scrub.value=0;
  return res;
}

/* ============================================================
   THREE.JS SCENE
   ============================================================ */
const canvas=$('gl');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x04070d);
const camera=new THREE.PerspectiveCamera(40,1,1,4000);
camera.up.set(0,0,1);
const controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.dampingFactor=.09;

scene.add(new THREE.HemisphereLight(0x9fc4ff,0x0a0f18,.6));
const key=new THREE.DirectionalLight(0xffffff,1.35); key.position.set(180,-140,260); scene.add(key);
const fill=new THREE.DirectionalLight(0x6fa8ff,.5); fill.position.set(-200,160,120); scene.add(fill);

let gStock=null, gSkirt=null, gFloor=null, gPath=null, gTool=null, gGrid=null, gAxes=null;
let HM=null, NX=0, NY=0, DX=0, DY=0, ST=null, hmDirty=false;

function clearGroup(o){ if(!o)return; scene.remove(o);
  o.traverse&&o.traverse(c=>{c.geometry&&c.geometry.dispose();c.material&&c.material.dispose&&c.material.dispose();}); }

function buildScene(){
  [gStock,gSkirt,gFloor,gPath,gTool,gGrid,gAxes].forEach(clearGroup);
  const st = S.res.stock || {x0:0,y0:0,z0:-20,x1:120,y1:80,z1:0};
  ST=st;
  const w=Math.max(1,st.x1-st.x0), h=Math.max(1,st.y1-st.y0);
  if(window.TNC_SIM){ const g=TNC_SIM.grid(st,S.segs); NX=g.NX; NY=g.NY; DX=g.DX; DY=g.DY; }
  else { NX=Math.min(200,Math.max(30,Math.round(w/0.8))); NY=Math.min(160,Math.max(30,Math.round(h/0.8)));
         DX=w/(NX-1); DY=h/(NY-1); }
  HM=new Float32Array(NX*NY).fill(st.z1);

  /* top surface */
  const pos=new Float32Array(NX*NY*3), col=new Float32Array(NX*NY*3);
  const idx=[];
  for(let j=0;j<NY;j++)for(let i=0;i<NX;i++){
    const k=(j*NX+i)*3;
    pos[k]=st.x0+i*DX; pos[k+1]=st.y0+j*DY; pos[k+2]=st.z1;
  }
  for(let j=0;j<NY-1;j++)for(let i=0;i<NX-1;i++){
    const a=j*NX+i,b=a+1,c=a+NX,d=c+1;
    idx.push(a,b,d, a,d,c);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  g.setAttribute('color',new THREE.BufferAttribute(col,3));
  g.setIndex(idx);
  gStock=new THREE.Mesh(g,new THREE.MeshStandardMaterial({
    vertexColors:true,metalness:.55,roughness:.52,side:THREE.DoubleSide}));
  scene.add(gStock);

  /* skirt (4 sides, follows the heightmap edge down to z0) */
  const sp=[],sc=[];
  gSkirt=new THREE.Mesh(new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({color:0x6b7686,metalness:.6,roughness:.5,side:THREE.DoubleSide}));
  scene.add(gSkirt);

  /* bottom */
  const bg=new THREE.PlaneGeometry(w,h);
  gFloor=new THREE.Mesh(bg,new THREE.MeshStandardMaterial({color:0x4a535f,metalness:.5,roughness:.6,side:THREE.DoubleSide}));
  gFloor.position.set((st.x0+st.x1)/2,(st.y0+st.y1)/2,st.z0);
  scene.add(gFloor);

  /* table grid + axes */
  gGrid=new THREE.GridHelper(Math.max(w,h)*2, 20, 0x1d3752, 0x122437);
  gGrid.rotation.x=Math.PI/2;
  gGrid.position.set((st.x0+st.x1)/2,(st.y0+st.y1)/2,st.z0-0.3);
  scene.add(gGrid);
  gAxes=new THREE.Group();
  const L=Math.max(w,h)*0.28;
  [[ [L,0,0],0xff6b5e ],[ [0,L,0],0x7ddc7d ],[ [0,0,L],0x6fa8ff ]].forEach(([v,c])=>{
    const gg=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(...v)]);
    gAxes.add(new THREE.Line(gg,new THREE.LineBasicMaterial({color:c})));
  });
  gAxes.position.set(st.x0,st.y0,st.z1+.2);
  scene.add(gAxes);

  /* toolpath, coloured per segment, revealed with drawRange */
  const n=S.segs.length;
  const pp=new Float32Array(n*6), pc=new Float32Array(n*6);
  const CA=new THREE.Color(0xffb03a), CF=new THREE.Color(0x6fdcff);
  S.segs.forEach((s,i)=>{
    pp.set([s.a.x,s.a.y,s.a.z,s.b.x,s.b.y,s.b.z],i*6);
    const c=s.kind==='rapid'?CA:CF;
    pc.set([c.r,c.g,c.b,c.r,c.g,c.b],i*6);
  });
  const pg=new THREE.BufferGeometry();
  pg.setAttribute('position',new THREE.BufferAttribute(pp,3));
  pg.setAttribute('color',new THREE.BufferAttribute(pc,3));
  pg.setDrawRange(0,0);
  gPath=new THREE.LineSegments(pg,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.85}));
  scene.add(gPath);

  /* tool */
  gTool=new THREE.Group();
  const body=new THREE.Mesh(new THREE.CylinderGeometry(1,1,40,20),
    new THREE.MeshStandardMaterial({color:0xd8dee8,metalness:.9,roughness:.22}));
  body.rotation.x=Math.PI/2; body.position.z=20; body.name='body';
  const flute=new THREE.Mesh(new THREE.CylinderGeometry(1,1,14,20),
    new THREE.MeshStandardMaterial({color:0x2f3742,metalness:.75,roughness:.4}));
  flute.rotation.x=Math.PI/2; flute.position.z=7; flute.name='flute';
  gTool.add(body); gTool.add(flute);
  scene.add(gTool);

  updateSkirt(); paintHM(); fitView();
}

function fitView(){
  const st=ST, w=st.x1-st.x0, h=st.y1-st.y0, d=Math.max(w,h);
  controls.target.set((st.x0+st.x1)/2,(st.y0+st.y1)/2,(st.z0+st.z1)/2);
  setView(S.view, d);
}
function setView(v,d){
  const st=ST; d=d||Math.max(st.x1-st.x0,st.y1-st.y0);
  const cx=(st.x0+st.x1)/2, cy=(st.y0+st.y1)/2, cz=(st.z0+st.z1)/2;
  const P={ '3D':[cx+d*.95,cy-d*1.05,cz+d*.85], 'TOP':[cx,cy,cz+d*1.9],
            'FRONT':[cx,cy-d*1.9,cz+d*.05], 'SIDE':[cx+d*1.9,cy,cz+d*.05] }[v]||[cx+d,cy-d,cz+d];
  camera.position.set(P[0],P[1],P[2]);
  controls.target.set(cx,cy,cz);
  S.view=v; $('gfx-rt').textContent=v==='3D'?'3-D VIEW':'PLAN VIEW '+v;
}

/* ---------- material removal ---------- */
function stampDisc(cx,cy,z,r){
  const st=ST;
  const i0=Math.max(0,Math.floor((cx-r-st.x0)/DX)), i1=Math.min(NX-1,Math.ceil((cx+r-st.x0)/DX));
  const j0=Math.max(0,Math.floor((cy-r-st.y0)/DY)), j1=Math.min(NY-1,Math.ceil((cy+r-st.y0)/DY));
  const r2=r*r;
  for(let j=j0;j<=j1;j++){
    const py=st.y0+j*DY, dy=py-cy;
    for(let i=i0;i<=i1;i++){
      const px=st.x0+i*DX, dx=px-cx;
      if(dx*dx+dy*dy>r2) continue;
      const k=j*NX+i;
      if(z<HM[k]){ HM[k]=Math.max(st.z0,z); hmDirty=true; }
    }
  }
}
function cutSeg(s,u0,u1){
  if(s.kind!=='feed') return;
  const len=s.len*(u1-u0); if(len<=0) return;
  const step=Math.max(0.35, Math.min(s.toolR*0.45, 2));
  const n=Math.max(1,Math.ceil(len/step));
  for(let i=0;i<=n;i++){
    const u=u0+(u1-u0)*(i/n);
    stampDisc(s.a.x+(s.b.x-s.a.x)*u, s.a.y+(s.b.y-s.a.y)*u, s.a.z+(s.b.z-s.a.z)*u, s.toolR);
  }
}
function removedNow(){
  if(!HM||!ST) return 0;
  let v=0; const top=ST.z1;
  for(let k=0;k<NX*NY;k++) v+=(top-HM[k]);
  return v*DX*DY;                      // mm³, integrated from the height field
}
function statsNow(){
  return Object.assign({}, S.res.stats||{}, {removedVolume: removedNow()});
}
function paintHM(){
  const p=gStock.geometry.attributes.position, c=gStock.geometry.attributes.color;
  const st=ST, span=Math.max(1e-6,st.z1-st.z0);
  for(let k=0;k<NX*NY;k++){
    const z=HM[k]; p.array[k*3+2]=z;
    const cut=(st.z1-z)/span;                        // 0 = untouched, 1 = floor
    if(cut<1e-4){ c.array[k*3]=.42; c.array[k*3+1]=.46; c.array[k*3+2]=.52; }   // raw stock
    else { c.array[k*3]=.20+cut*.10; c.array[k*3+1]=.55+cut*.20; c.array[k*3+2]=.72+cut*.22; }
  }
  p.needsUpdate=true; c.needsUpdate=true;
  gStock.geometry.computeVertexNormals();
  updateSkirt();
  hmDirty=false;
}
function updateSkirt(){
  const st=ST, quads=[];
  const at=(i,j)=>HM[j*NX+i];
  const push=(x1,y1,z1,x2,y2,z2)=>{
    quads.push(x1,y1,z1, x2,y2,z2, x2,y2,st.z0,  x1,y1,z1, x2,y2,st.z0, x1,y1,st.z0);
  };
  for(let i=0;i<NX-1;i++){
    push(st.x0+i*DX,st.y0,at(i,0), st.x0+(i+1)*DX,st.y0,at(i+1,0));
    push(st.x0+(i+1)*DX,st.y1,at(i+1,NY-1), st.x0+i*DX,st.y1,at(i,NY-1));
  }
  for(let j=0;j<NY-1;j++){
    push(st.x1,st.y0+j*DY,at(NX-1,j), st.x1,st.y0+(j+1)*DY,at(NX-1,j+1));
    push(st.x0,st.y0+(j+1)*DY,at(0,j+1), st.x0,st.y0+j*DY,at(0,j));
  }
  const g=gSkirt.geometry;
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(quads),3));
  g.computeVertexNormals();
}

/* ============================================================
   TRANSPORT
   ============================================================ */
function segAt(t){
  let lo=0,hi=S.segs.length-1,r=-1;
  while(lo<=hi){const m=(lo+hi)>>1; if(S.segs[m].t1<t){lo=m+1;} else {r=m;hi=m-1;}}
  return r<0?S.segs.length-1:r;
}
function applyCuts(toT){
  if(toT<=S.stampT) return;
  for(const s of S.segs){
    if(s.t1<=S.stampT || s.t0>=toT) continue;
    const u0=Math.max(0,(S.stampT-s.t0)/(s.t1-s.t0));
    const u1=Math.min(1,(toT-s.t0)/(s.t1-s.t0));
    cutSeg(s,Math.max(0,u0),Math.min(1,u1));
  }
  S.stampT=toT;
}
function rewind(toT){
  HM.fill(ST.z1); S.stampT=0; hmDirty=true; applyCuts(toT);
}
function seek(t){
  t=Math.max(0,Math.min(S.total,t));
  if(t<S.stampT) rewind(t); else applyCuts(t);
  S.t=t;
  scrub.value=S.total>0?Math.round(t/S.total*1000):0;
  syncCursorToTime();
}
function syncCursorToTime(){
  if(!S.segs.length) return;
  const s=S.segs[segAt(S.t)];
  if(s && s.block!=null && s.block!==S.cursor && !S.editing){ S.cursor=s.block; renderList(true); }
}
function reset(){ S.running=false; seek(0); setState('READY'); }
function start(){ if(!S.segs.length){say('NO EXECUTABLE BLOCKS');return;}
  if(S.t>=S.total-1e-6) seek(0);
  S.running=true; setState(S.mode==='single'?'SINGLE BLOCK':'RUNNING'); }
function stop(){ S.running=false; setState('FEED HOLD'); }
function stepBlock(){
  if(!S.segs.length) return;
  const i=segAt(S.t), b=S.segs[i].block;
  let j=i; while(j<S.segs.length && S.segs[j].block===b) j++;
  S.running=false;
  seek(j<S.segs.length?S.segs[j].t0+1e-4:S.total);
  setState('SINGLE BLOCK');
}
function setState(s){ $('run-state').textContent=s; }

/* ============================================================
   RENDER — program listing
   ============================================================ */
const HL=[
  [/(^|\s)(BEGIN PGM|END PGM|BLK FORM|TOOL CALL|CYCL DEF|CYCL CALL|CALL LBL|LBL|STOP|FN \d+:)/g,'$1<i class="t-key">$2</i>'],
  [/\b(FMAX)\b/g,'<i class="t-f">$1</i>'],
  [/\b(F\d+(?:\.\d+)?)\b/g,'<i class="t-f">$1</i>'],
  [/\b(M\d+)\b/g,'<i class="t-m">$1</i>'],
  [/\b(Q\d+)\b/g,'<i class="t-q">$1</i>'],
  [/([XYZ]|IX|IY|IZ|R|S)([+-]?\d+(?:\.\d+)?)/g,'$1<i class="t-num">$2</i>']
];
function esc(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function hi(s){
  const ci=s.indexOf(';');
  let code=ci>=0?s.slice(0,ci):s, cm=ci>=0?s.slice(ci):'';
  code=esc(code); for(const [re,rp] of HL) code=code.replace(re,rp);
  return code+(cm?'<i class="t-cm">'+esc(cm)+'</i>':'');
}
function renderList(keep){
  const bl=S.res?S.res.blocks:[];
  const curSeg=S.segs.length?S.segs[segAt(S.t)]:null;
  const execB=curSeg?curSeg.block:-1;
  plist.innerHTML=bl.map((b,i)=>{
    const cls=['blk']; if(i===S.cursor)cls.push('cur');
    if(i===execB&&i!==S.cursor)cls.push('exec');
    if(b.indent)cls.push('ind'); if(b.error)cls.push('err');
    return `<div class="${cls.join(' ')}" data-i="${i}"><span class="bn">${b.indent||b.n==null?'':b.n}</span><span class="bt">${hi(b.raw||'')}</span></div>`;
  }).join('');
  if(!keep||true){
    const el=plist.children[S.cursor];
    if(el){const r=el.offsetTop, h=crt.clientHeight;
      if(r<crt.scrollTop+12||r>crt.scrollTop+h-28) crt.scrollTop=r-h/2;}
  }
}
plist.addEventListener('click',e=>{const d=e.target.closest('.blk'); if(!d)return;
  S.cursor=+d.dataset.i; renderList();
  const s=S.segs.find(x=>x.block===S.cursor); if(s) seek(s.t0+1e-4);
});

/* ---------- errors ---------- */
function renderErrors(){
  const er=S.res.errors||[];
  $('errc').textContent=er.length?er.length+' active':'0';
  $('elist').innerHTML = er.length
    ? er.map(e=>{const b=S.res.blocks[e.block]; return `<div>BLOCK ${b&&b.n!=null?b.n:'--'} &nbsp; ${esc(e.msg)}</div>`;}).join('')
    : '<div class="ok">NO ERRORS &mdash; PROGRAM CHECKED OK</div>';
}

/* ---------- run stats ---------- */
function fmtT(s){const m=Math.floor(s/60);return (m<10?'0':'')+m+':'+(s%60<10?'0':'')+(s%60).toFixed(1);}
function renderKV(){
  const st=S.res.stats||{}, s=S.segs.length?S.segs[segAt(S.t)]:null;
  const rows=[
    ['Elapsed / total', fmtT(S.t)+' / '+fmtT(S.total)],
    ['Blocks', (S.res.blocks||[]).length],
    ['Moves', S.segs.length],
    ['Feed path', (st.pathFeed||0).toFixed(0)+' mm'],
    ['Rapid path', (st.pathRapid||0).toFixed(0)+' mm'],
    ['Min Z', (st.minZ!=null?st.minZ.toFixed(3):'--')+' mm'],
    ['Removed', (removedNow()/1000).toFixed(1)+' cm&sup3;'],
    ['Active cycle', s&&s.cycle?s.cycle:'&mdash;'],
    ['Override', S.ovr+' %']
  ];
  $('runkv').innerHTML=rows.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('');
}

/* ---------- DRO ---------- */
function renderDro(){
  const i=S.segs.length?segAt(S.t):-1;
  let x=0,y=0,z=0,f=0,sp=0,tl=0;
  if(i>=0){
    const s=S.segs[i], u=Math.max(0,Math.min(1,(S.t-s.t0)/Math.max(1e-9,s.t1-s.t0)));
    x=s.a.x+(s.b.x-s.a.x)*u; y=s.a.y+(s.b.y-s.a.y)*u; z=s.a.z+(s.b.z-s.a.z)*u;
    f=Math.round(s.f*(S.ovr/100)); sp=s.spindle||0; tl=s.tool||0;
    if(gTool){
      gTool.position.set(x,y,z);
      const r=Math.max(.6,s.toolR);
      gTool.children.forEach(c=>c.scale.set(r,1,r));
    }
  }
  const R=[['x','X',x.toFixed(3),'mm'],['y','Y',y.toFixed(3),'mm'],['z','Z',z.toFixed(3),'mm'],
           ['s','S',Math.abs(sp)+(sp<0?' M4':' M3'),'rpm'],['f','F',f,'mm/min']];
  $('dro').innerHTML=R.map(([c,a,v])=>
    `<div class="drow ${c}"><span class="ax">${a}</span><span class="val">${v}</span></div>`).join('');
  $('dro-t').textContent='T'+tl+' ACTL MM';
}

/* ---------- compare ---------- */
const CMPF=[['cycleTime','Cycle time','s',1],['pathFeed','Feed path','mm',1],
            ['pathRapid','Rapid path','mm',1],['moveCount','Moves','',1],
            ['minZ','Min Z','mm',1],['removedVolume','Removed','mm³',1]];
function renderCompare(){
  const b=statsNow(), a=S.ref?S.ref.stats:null;
  $('cmp-t').textContent=S.ref?('A: '+S.ref.name):'no reference';
  let h='<span class="h">Metric</span><span class="h">A ref</span><span class="h">B now</span><span class="h">Δ</span>';
  for(const [k,lbl,u] of CMPF){
    const bv=b[k], av=a?a[k]:null;
    const f=v=>v==null?'--':(Math.abs(v)>=100?v.toFixed(0):v.toFixed(2));
    let d='--',dc='eq';
    if(a&&av!=null&&bv!=null){ const dv=bv-av;
      d=(dv>0?'+':'')+ (Math.abs(dv)>=100?dv.toFixed(0):dv.toFixed(2));
      dc = Math.abs(dv)<1e-6?'eq':(k==='removedVolume'?(dv>0?'dn':'up'):(dv>0?'up':'dn')); }
    h+=`<span class="l">${lbl}</span><span class="v">${f(av)}</span><span class="v">${f(bv)}</span><span class="d ${dc}">${d}</span>`;
  }
  $('cmp').innerHTML=h;
}
$('b-snap').onclick=()=>{
  S.running=false; seek(S.total);        // a reference is always a finished run
  S.ref={stats:statsNow(), text:S.text,
         name:(S.res.blocks[0]&&/PGM (\S+)/.exec(S.res.blocks[0].raw||'')||[,'PGM'])[1]+' @'+new Date().toTimeString().slice(0,5)};
  renderCompare(); say('REFERENCE STORED — EDIT AND RE-RUN TO COMPARE');
};
$('b-restore').onclick=()=>{ if(!S.ref){say('NO REFERENCE STORED');return;}
  S.text=S.ref.text; raw.value=S.text; compile(); say('REFERENCE PROGRAM RESTORED'); };

/* ============================================================
   SOFT KEYS — per operating mode, like the real control
   ============================================================ */
const SK={
  edit:  [['INSERT','ins'],['DELETE','del'],['EDIT','ed'],['COPY','cp'],
          ['TOOL\nTABLE','tt'],['CYCL\nDEF','cyc'],['RAW\nEDIT','rawt'],['CHECK','chk']],
  test:  [['START','start'],['START\nSINGLE','step'],['RESET\n+ START','rs'],['STOP','stop'],
          ['3-D\nVIEW','v3'],['PLAN\nVIEW','vt'],['FRONT','vf'],['SIDE','vs']],
  single:[['NC\nSTART','start'],['NC\nSTOP','stop'],['BLOCK\nSCAN','scan'],['RESTORE\nPOS','rs'],
          ['OVR\n&minus;','ovrd'],['OVR\n+','ovru'],['TOOL\nTABLE','tt'],['RESET','reset']],
  full:  [['NC\nSTART','start'],['NC\nSTOP','stop'],['RESET','reset'],['BLOCK\nSCAN','scan'],
          ['OVR\n&minus;','ovrd'],['OVR\n+','ovru'],['3-D\nVIEW','v3'],['PLAN\nVIEW','vt']]
};
function renderSK(){
  sks.innerHTML=(SK[S.mode]||SK.test).map(([l,a])=>
    `<button class="sk" data-a="${a}">${l.replace(/\n/g,'<br>')}</button>`).join('');
}
sks.addEventListener('click',e=>{const b=e.target.closest('.sk'); if(b) act(b.dataset.a);});

function act(a){
  switch(a){
    case 'start': start(); break;
    case 'stop': stop(); break;
    case 'step': stepBlock(); break;
    case 'reset': case 'rs': reset(); if(a==='rs')start(); break;
    case 'v3': setView('3D'); break;
    case 'vt': setView('TOP'); break;
    case 'vf': setView('FRONT'); break;
    case 'vs': setView('SIDE'); break;
    case 'ovrd': S.ovr=Math.max(0,S.ovr-10); renderKV(); say('FEED OVERRIDE '+S.ovr+'%'); break;
    case 'ovru': S.ovr=Math.min(150,S.ovr+10); renderKV(); say('FEED OVERRIDE '+S.ovr+'%'); break;
    case 'ed': beginEdit(); break;
    case 'ins': insertBlock(); break;
    case 'del': deleteBlock(); break;
    case 'cp': copyBlock(); break;
    case 'rawt': toggleRaw(); break;
    case 'chk': compile(); say(S.res.errors.length?('PROGRAM CHECK: '+S.res.errors.length+' ERROR(S)'):'PROGRAM CHECK OK'); break;
    case 'tt': showTools(); break;
    case 'cyc': say('CYCL DEF 200 / 201 / 203 / 4 SUPPORTED — TYPE IT IN THE BLOCK'); break;
    case 'scan': say('BLOCK SCAN — USE ↑ ↓ THEN ENT'); break;
  }
}
function showTools(){
  const t=(TNC.TOOLS||[]).map(x=>`T${String(x.t).padStart(2)}  ${x.name.padEnd(14)} L${x.l.toFixed(2).padStart(7)}  R${x.r.toFixed(3).padStart(6)}`);
  say('TOOL TABLE → see error register'); 
  $('elist').innerHTML=t.map(l=>`<div class="ok">${esc(l)}</div>`).join('');
}

/* ============================================================
   BLOCK EDITING — the dialog line
   ============================================================ */
function lines(){ return S.text.split('\n'); }
function srcIndexOf(blockIdx){
  const b=S.res.blocks[blockIdx]; if(!b) return -1;
  const ls=lines(); let seen=0;
  for(let i=0;i<ls.length;i++){
    if(ls[i].trim()===''&&b.kind!=='BLANK') continue;
    if(seen===blockIdx) return i; seen++;
  }
  return Math.min(blockIdx,ls.length-1);
}
function beginEdit(){
  const b=S.res.blocks[S.cursor]; if(!b)return;
  S.editing=true; dlgIn.disabled=false; dlgIn.value=b.raw||'';
  dlgPr.textContent='BLOCK '+(b.n==null?'':b.n); dlgHint.textContent='ENT accept · ESC cancel';
  dlgIn.focus(); dlgIn.select();
}
function endEdit(accept){
  if(!S.editing) return;
  if(accept){
    const ls=lines(), i=srcIndexOf(S.cursor);
    if(i>=0){ ls[i]=dlgIn.value; S.text=ls.join('\n'); raw.value=S.text;
      const c=S.cursor; compile(); S.cursor=Math.min(c,S.res.blocks.length-1); renderList(); }
  }
  S.editing=false; dlgIn.disabled=true; dlgIn.value='';
  dlgPr.textContent='BLOCK'; dlgHint.textContent='E edit · I insert · D delete';
  document.body.focus();
}
function insertBlock(){
  const ls=lines(), i=srcIndexOf(S.cursor);
  ls.splice(i+1,0,'L X+0 Y+0 R0 F500');
  S.text=ls.join('\n'); raw.value=S.text; const c=S.cursor; compile();
  S.cursor=Math.min(c+1,S.res.blocks.length-1); renderList(); beginEdit();
}
function deleteBlock(){
  const ls=lines(), i=srcIndexOf(S.cursor);
  if(ls.length<=1) return;
  ls.splice(i,1); S.text=ls.join('\n'); raw.value=S.text;
  const c=S.cursor; compile(); S.cursor=Math.max(0,Math.min(c,S.res.blocks.length-1));
  renderList(); say('BLOCK DELETED');
}
function copyBlock(){
  const ls=lines(), i=srcIndexOf(S.cursor);
  ls.splice(i+1,0,ls[i]); S.text=ls.join('\n'); raw.value=S.text;
  const c=S.cursor; compile(); S.cursor=c+1; renderList(); say('BLOCK COPIED');
}
dlgIn.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();endEdit(true);}
  else if(e.key==='Escape'){e.preventDefault();endEdit(false);}
  e.stopPropagation();
});
function toggleRaw(){
  S.raw=!S.raw; raw.hidden=!S.raw; crt.hidden=S.raw;
  if(S.raw){ raw.value=S.text; raw.focus(); say('RAW EDIT — TAB TO RETURN'); }
  else { S.text=raw.value; compile(); say('PROGRAM RE-COMPILED'); }
}
raw.addEventListener('keydown',e=>{ if(e.key==='Tab'){e.preventDefault();toggleRaw();} e.stopPropagation(); });

/* ============================================================
   MODES + KEYBOARD
   ============================================================ */
function setMode(m){
  S.mode=m;
  [...document.querySelectorAll('.mode')].forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===m));
  renderSK();
  if(m==='edit'){ S.running=false; setState('EDITING'); }
  else setState('READY');
}
$('modes').addEventListener('click',e=>{const b=e.target.closest('.mode'); if(b)setMode(b.dataset.m);});

const KEYS=[
  ['↑ ↓','Block cursor up / down'],
  ['← →','Scrub run back / forward'],
  ['ENTER','Step forward one block'],
  ['ESC','Stop / cancel edit'],
  ['SPACE','NC START / NC STOP'],
  ['S','Single block'],
  ['R','Reset to block 0'],
  ['E','Edit block'],
  ['I','Insert block'],
  ['D','Delete block'],
  ['C','Copy block'],
  ['TAB','Raw text editor'],
  ['G','Cycle 3D / TOP / FRONT / SIDE'],
  ['1 – 5','Speed 1× 4× 16× 64× MAX'],
  ['F1 – F4','Operating mode'],
  ['+ / −','Feed override'],
  ['HOME/END','First / last block'],
  ['PGUP/PGDN','Page cursor']
];
$('klist').innerHTML=KEYS.map(([k,d])=>`<div><kbd>${k}</kbd><span>${d}</span></div>`).join('');

const VIEWS=['3D','TOP','FRONT','SIDE'];
addEventListener('keydown',e=>{
  if(S.editing||S.raw) return;
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  const k=e.key;
  const nb=(S.res.blocks||[]).length;
  switch(k){
    case 'ArrowUp':   e.preventDefault(); S.cursor=Math.max(0,S.cursor-1); renderList(); break;
    case 'ArrowDown': e.preventDefault(); S.cursor=Math.min(nb-1,S.cursor+1); renderList(); break;
    case 'ArrowLeft': e.preventDefault(); S.running=false; seek(S.t-(e.shiftKey?5:1)); break;
    case 'ArrowRight':e.preventDefault(); S.running=false; seek(S.t+(e.shiftKey?5:1)); break;
    case 'Enter':     e.preventDefault(); if(S.mode==='edit') beginEdit(); else stepBlock(); break;
    case 'Escape':    e.preventDefault(); stop(); break;
    case ' ':         e.preventDefault(); S.running?stop():start(); break;
    case 'Home':      e.preventDefault(); S.cursor=0; renderList(); break;
    case 'End':       e.preventDefault(); S.cursor=nb-1; renderList(); break;
    case 'PageUp':    e.preventDefault(); S.cursor=Math.max(0,S.cursor-12); renderList(); break;
    case 'PageDown':  e.preventDefault(); S.cursor=Math.min(nb-1,S.cursor+12); renderList(); break;
    case 'Tab':       e.preventDefault(); toggleRaw(); break;
    case '+': case '=': act('ovru'); break;
    case '-': case '_': act('ovrd'); break;
    default:
      if(/^[1-5]$/.test(k)){ setSpeed([1,4,16,64,0][+k-1]); }
      else if(/^F[1-4]$/.test(k)){ e.preventDefault(); setMode(['edit','test','single','full'][+k[1]-1]); }
      else if(k==='s'||k==='S') stepBlock();
      else if(k==='r'||k==='R') reset();
      else if(k==='e'||k==='E'){ e.preventDefault(); beginEdit(); }
      else if(k==='i'||k==='I'){ e.preventDefault(); insertBlock(); }
      else if(k==='d'||k==='D'){ e.preventDefault(); deleteBlock(); }
      else if(k==='c'||k==='C'){ e.preventDefault(); copyBlock(); }
      else if(k==='g'||k==='G'){ setView(VIEWS[(VIEWS.indexOf(S.view)+1)%4]); }
  }
});

function setSpeed(v){ S.speed=v;
  [...$('spd').children].forEach(b=>b.dataset.on = (+b.dataset.s===v)?'1':'0');
  if(v===0 && S.segs.length){ S.running=false; seek(S.total); say('MAX — JUMPED TO END'); }
  else say('SPEED '+v+'×');
}
$('spd').addEventListener('click',e=>{const b=e.target.closest('button'); if(b)setSpeed(+b.dataset.s);});
$('b-start').onclick=start; $('b-stop').onclick=stop;
$('b-step').onclick=stepBlock; $('b-reset').onclick=reset;
scrub.addEventListener('input',()=>{ S.running=false; seek(+scrub.value/1000*S.total); });

/* ============================================================
   LOOP
   ============================================================ */
function resize(){
  const r=canvas.parentElement.getBoundingClientRect();
  if(r.width<2||r.height<2) return;
  renderer.setSize(r.width,r.height,false);
  camera.aspect=r.width/r.height; camera.updateProjectionMatrix();
}
addEventListener('resize',resize);

let last=0, acc=0;
function tick(now){
  const dt=Math.min(.1,(now-last)/1000); last=now;
  if(S.running && S.speed>0){
    const nt=S.t+dt*S.speed*(S.ovr/100);
    if(nt>=S.total){ seek(S.total); S.running=false; setState('PROGRAM END — M2'); }
    else seek(nt);
  }
  if(hmDirty){ acc+=dt; if(acc>(NX*NY>60000?.1:.05)){ paintHM(); acc=0; } }
  if(gPath){ const n=S.segs.length?segAt(S.t)+1:0; gPath.geometry.setDrawRange(0,n*2); }
  renderDro();
  if(!tick._k||now-tick._k>200){ renderKV(); tick._k=now;
    $('ovl-l').innerHTML='PGM <b style="color:var(--cyan)">'+((/PGM (\S+)/.exec(S.text)||[,'—'])[1])+'</b><br>'+
      'BLOCK <b>'+(S.res.blocks[S.cursor]&&S.res.blocks[S.cursor].n!=null?S.res.blocks[S.cursor].n:'--')+'</b> / '+((S.res.blocks.filter(b=>b.n!=null).pop()||{n:0}).n)+'<br>'+
      'STOCK <b>'+(ST.x1-ST.x0)+'×'+(ST.y1-ST.y0)+'×'+(ST.z1-ST.z0)+'</b> mm';
    $('ovl-r').innerHTML=S.view+' &middot; '+(S.speed?S.speed+'×':'MAX')+'<br>'+
      fmtT(S.t)+' / '+fmtT(S.total)+'<br>OVR <b style="color:var(--amber)">'+S.ovr+'%</b>';
  }
  controls.update(); renderer.render(scene,camera);
  requestAnimationFrame(tick);
}

/* ---------- program selector ---------- */
const pgmSel=$('pgm-sel');
function fillPgmSel(){
  pgmSel.innerHTML=Object.keys(S.pgms).map(n=>`<option value="${n}"${n===S.pgm?' selected':''}>TNC:\\${n}</option>`).join('');
}
pgmSel.addEventListener('change',()=>{
  S.pgms[S.pgm]=S.text; S.pgm=pgmSel.value; S.text=S.pgms[S.pgm];
  raw.value=S.text; S.cursor=0; compile(); pgmSel.blur(); say('PGM '+S.pgm+' SELECTED');
});
fillPgmSel();

/* ---------- DEV panel ---------- */
const dev=$('dev');
function openDev(){ $('dev-pre').textContent=window.TNC_DEVLOG||'devlog.txt missing from this build.';
  dev.hidden=false; S.running=false; $('dev-x').focus(); }
function closeDev(){ dev.hidden=true; $('b-dev').focus(); }
$('b-dev').onclick=openDev; $('dev-x').onclick=closeDev;
dev.addEventListener('click',e=>{ if(e.target===dev) closeDev(); });
addEventListener('keydown',e=>{            // capture: the panel owns the keyboard while open
  if(dev.hidden) return;
  if(e.key==='Escape'){ e.preventDefault(); closeDev(); }
  e.stopImmediatePropagation();
},true);

/* ---------- boot ---------- */
raw.value=S.text;
compile();
setMode('test');
resize(); fitView();
requestAnimationFrame(tick);
setTimeout(()=>say('READY — PRESS SPACE TO RUN, F1 TO EDIT'),400);

})();
