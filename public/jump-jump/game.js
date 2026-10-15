"use strict";
/* ================= 画布与上下文 ================= */
const canvas = document.getElementById('game');
let ctx = canvas.getContext('2d');
const backdrop = document.createElement('canvas');
let backdropDirty = true;
let W = 0, H = 0, DPR = 1, SCALE = 0;
function resize(){
  DPR = Math.min(window.devicePixelRatio||1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W*DPR; canvas.height = H*DPR;
  canvas.style.width = W+'px'; canvas.style.height = H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  SCALE = Math.min(W,H) * 0.17;
  backdropDirty = true;
}
window.addEventListener('resize', resize);
resize();

/* ================= 配置与状态 ================= */
const COS = Math.cos(Math.PI/6), SIN = Math.sin(Math.PI/6);
const CFG = {
  W: 1,           // 平台尺寸
  centerR: 0.272, // 中心判定半径（原0.34的80%）
  minD: 1.15, maxD: 2.4375,  // 平台中心间距（最远=原1.95的125%）
  maxJump: 2.9375, // 最大跳跃距离（满蓄力刚好够到最远平台远端 = maxD+W/2）
  chargeTime: 1.2,// 蓄满所需秒数
  flightDur: 0.5, // 飞行时长
  arcH: 0.75,     // 跳跃最高点
  th: 0.30        // 平台厚度
};
// 地形类型：0=岩石 1=青苔石 2=树丛 3=山崖（color 即地形类型，用于强调描边/粒子）
const PALETTE = ['#9aa4b0','#6d8a5a','#5f9e5f','#8a6f4d'];
// 像素化地形色板
const TERRAIN = {
  0:{base:'#8a8f98', light:'#b6bcc6', dark:'#5f646c'},
  1:{base:'#6f7d66', light:'#7f9476', dark:'#4a5249', moss:'#4f6d4a'},
  2:{base:'#7d8a4f', light:'#94a35c', dark:'#555f37', leaf:'#4f8f4f', deep:'#3c6e3c'},
  3:{base:'#7d6248', light:'#9a7a58', dark:'#4a3622', crack:'#5a4632'}
};

const state = {
  name:'', scene:'home',
  lives:3, score:0, streak:0, platforms:0, bestStreak:0,
  phase:'idle',           // idle | charge | fly | land | fall
  power:0, chargeStart:0,
  current:{x:0,z:0,color:0},
  next:{x:0,z:0,color:0,dir:[1,0],D:0},
  plats:[],               // 已出现/已跳跃过的全部平台，用于保留绘制
  char:{x:0,z:0,y:0, squash:0, tilt:0},
  jump:{from:[0,0], dir:[1,0], dist:0, t0:0},
  best:0, clock:0, fallRemaining:0, paused:false,
  soundOn:true, ac:null, masterGain:null,
  shake:0, popups:[], particles:[]
};

/* ---------- 存取 best ---------- */
function loadBest(){
  let legacy = 0;
  try { legacy = Number(localStorage.getItem('tiaotiao_best') || 0); } catch (_) {}
  const shared = window.WeddingGuest?.getBest('jump');
  const sharedScore = typeof shared === 'number' ? shared : shared?.score;
  state.best = Math.max(0, Number.isFinite(legacy) ? legacy : 0, Number.isFinite(sharedScore) ? sharedScore : 0);
}
function saveBest(){ try{ localStorage.setItem('tiaotiao_best', String(state.best)); }catch(e){} }
loadBest();

/* ---------- 音频 ---------- */
function ensureAudio(){
  if(!state.soundOn) return;
  if(!state.ac){
    try{
      state.ac = new (window.AudioContext||window.webkitAudioContext)();
      state.masterGain = state.ac.createGain();
      state.masterGain.connect(state.ac.destination);
    }catch(e){}
  }
  if(state.ac && state.ac.state==='suspended') state.ac.resume().catch(()=>{});
}
function tone(freq, dur, type, vol, delay){
  if(!state.soundOn || !state.ac || !state.masterGain || state.ac.state!=='running') return;
  const t = state.ac.currentTime + (delay||0);
  const o = state.ac.createOscillator(), g = state.ac.createGain();
  o.type = type||'sine'; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(vol||0.15, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  o.connect(g); g.connect(state.masterGain);
  o.onended = ()=>{ o.disconnect(); g.disconnect(); };
  o.start(t); o.stop(t+dur+0.02);
}
const SFX = {
  jump(){ tone(320,0.18,'triangle',0.12); tone(520,0.12,'triangle',0.08,0.03); },
  land(){ tone(660,0.1,'square',0.1); },
  center(n){ tone(660,0.09,'square',0.12); tone(880,0.12,'square',0.12,0.06); if(n>=3){tone(1100,0.14,'square',0.12,0.12);} },
  miss(){ tone(220,0.35,'sawtooth',0.18); tone(140,0.4,'sawtooth',0.15,0.12); },
  win(){ [523,659,784,1047].forEach((f,i)=>tone(f,0.18,'triangle',0.16,i*0.12)); },
  lose(){ [392,330,262,196].forEach((f,i)=>tone(f,0.25,'sawtooth',0.14,i*0.16)); }
};

/* ================= 世界生成 ================= */
function pickDir(){ return Math.random()<0.5 ? [1,0] : [0,1]; }
function generateNext(){
  // 以当前平台中心为基准放置下一平台中心：新平台与当前平台严格对齐
  // （沿 dir 平移 D，故新平台上表面两条棱与当前平台上表面两条棱共线）
  const p = state.current;
  const dir = pickDir();
  const D = CFG.minD + Math.random()*(CFG.maxD-CFG.minD);
  // 第 50 个平台（platforms===49 时生成的下一个）做成 2 倍大，标识通关
  const size = state.platforms === 49 ? 2 : 1;
  state.next = {
    x: p.x + dir[0]*D, z: p.z + dir[1]*D,
    color: Math.floor(Math.random()*4),
    size: size,
    dir: dir, D: D
  };
}
function initRun(){
  cancelCharge();
  state.lives=3; state.score=0; state.streak=0; state.platforms=0; state.bestStreak=0;
  state.clock=0; state.fallRemaining=0; state.paused=false; state.shake=0;
  camX=0; camZ=0;
  state.current = {x:0,z:0,color:Math.floor(Math.random()*4), size:1};
  state.plats = [state.current];
  state.char = {x:0,z:0,y:0,squash:0,tilt:0};
  state.phase='idle'; state.power=0;
  state.popups=[]; state.particles=[];
  generateNext();
  updateHUD();
}

/* ================= 输入 ================= */
const powerWrap = document.getElementById('powerWrap');
const powerFill = document.getElementById('powerFill');
let activeInput = null;
function beginCharge(source){
  if(state.scene!=='play' || state.paused || state.phase!=='idle' || activeInput!==null) return false;
  ensureAudio();
  activeInput=source; state.phase='charge'; state.power=0;
  state.chargeStart=performance.now();
  powerFill.style.width='0%';
  powerWrap.classList.add('on');
  return true;
}
function finishCharge(source){
  if(activeInput!==source) return;
  activeInput=null;
  powerWrap.classList.remove('on');
  if(state.scene!=='play' || state.paused || state.phase!=='charge') return;
  // Read the release time directly: even a tap between animation frames is accurate.
  const power = Math.max(0, Math.min(1, (performance.now()-state.chargeStart)/1000/CFG.chargeTime));
  state.power=power;
  state.phase='fly';
  state.jump = { from:[state.char.x, state.char.z], dir:state.next.dir, dist:power*CFG.maxJump, t0:state.clock };
  SFX.jump();
}
function cancelCharge(){
  activeInput=null;
  powerWrap.classList.remove('on');
  powerFill.style.width='0%';
  state.power=0;
  if(state.phase==='charge'){
    state.phase='idle'; state.char.squash=0; state.char.tilt=0;
  }
}
canvas.addEventListener('pointerdown', e=>{
  if(!e.isPrimary || e.button!==0) return;
  if(beginCharge(e.pointerId)){
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointerup', e=>{
  if(activeInput===e.pointerId){ e.preventDefault(); finishCharge(e.pointerId); }
});
canvas.addEventListener('pointercancel', e=>{ if(activeInput===e.pointerId) cancelCharge(); });
canvas.addEventListener('lostpointercapture', e=>{ if(activeInput===e.pointerId) cancelCharge(); });
function isEditing(target){ return target?.closest?.('input, textarea, select, button, a, [contenteditable="true"]'); }
window.addEventListener('keydown', e=>{
  if(e.code==='Escape' && state.scene==='play'){
    e.preventDefault();
    if(!e.repeat) state.paused ? resumeGame() : pauseGame();
    return;
  }
  if(e.code==='Space' && state.scene==='play' && !state.paused && !isEditing(e.target)){
    e.preventDefault(); if(!e.repeat) beginCharge('keyboard');
  }
});
window.addEventListener('keyup', e=>{
  if(e.code==='Space' && activeInput==='keyboard'){ e.preventDefault(); finishCharge('keyboard'); }
});

function pauseGame(){
  if(state.scene!=='play' || state.paused) return;
  cancelCharge(); state.paused=true;
  document.getElementById('pauseOv').classList.remove('hidden');
  document.getElementById('resumeBtn').focus();
  if(state.masterGain) state.masterGain.gain.value=0;
}
function resumeGame(){
  if(state.scene!=='play' || !state.paused || document.hidden) return;
  state.paused=false; lastT=performance.now();
  document.getElementById('pauseOv').classList.add('hidden');
  document.activeElement?.blur();
  if(state.masterGain) state.masterGain.gain.value=state.soundOn?1:0;
  ensureAudio();
}
window.addEventListener('blur', pauseGame);
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden) pauseGame();
  lastT=performance.now();
});

/* ================= 投影 ================= */
// 屏幕目标：角色中心位于画布中下方
let camX=0, camZ=0;
function project(x,z,y){
  // 平移：当前平台/角色中心映射到锚点（y 项向下为正）
  const ax = camX, az = camZ;
  const sx = ((x - ax) - (z - az)) * COS * SCALE + W/2;
  // 斜上方等距视角：完整深度贡献，保留真实透视
  const sy = -((x - ax) + (z - az)) * SIN * SCALE - y*SCALE + H*0.5;
  return [sx, sy];
}

/* ================= 绘制 ================= */
// 确定性伪随机（基于种子），保证每块地形纹样稳定
function pseed(a,b,c){ let h=(Math.round(a*17)^Math.round(b*31)^Math.round(c*53))*2654435761; h^=h>>>13; h=Math.imul(h,1274126177); return ((h^h>>>16)>>>0)/4294967295; }

function drawPlatform(x, z, colorIdx, size){
  size = size || 1;
  const hw = CFG.W/2 * size, th = CFG.th, t = TERRAIN[colorIdx];
  const corners = [[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]].map(c=>project(x+c[0], z+c[1], 0));
  const bot = [[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]].map(c=>project(x+c[0], z+c[1], -th));

  // 地面软投影
  const px = project(x, z, 0.001);
  ctx.fillStyle='rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(px[0], px[1]+th*SCALE*0.9, hw*SCALE*1.08, hw*SCALE*0.52, 0, 0, Math.PI*2); ctx.fill();

  // 侧棱：平滑渐变岩壁，顶部亮底部暗，带自然明暗过渡
  const visSides = [[0,1],[3,0]];
  for(const [i,j] of visSides){
    const a=corners[i], b=corners[j], c=bot[j], d=bot[i];
    const grad = ctx.createLinearGradient(0,a[1],0,d[1]);
    grad.addColorStop(0, shade2(t.base,0.02)); grad.addColorStop(0.5, t.dark); grad.addColorStop(1, shade2(t.dark,-0.2));
    ctx.fillStyle=grad;
    ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.lineTo(c[0],c[1]); ctx.lineTo(d[0],d[1]); ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle='rgba(0,0,0,0.28)'; ctx.lineWidth=1;
  for(const [i,j] of visSides){
    ctx.beginPath(); ctx.moveTo(corners[i][0],corners[i][1]); ctx.lineTo(corners[j][0],corners[j][1]); ctx.stroke();
  }

  // 顶面写实地形
  drawTerrainTop(x,z,colorIdx,corners,size);

  // 顶面描边（柔和，做受光边）
  ctx.strokeStyle='rgba(255,255,255,0.30)'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.moveTo(corners[0][0],corners[0][1]);
  for(let i=1;i<4;i++) ctx.lineTo(corners[i][0],corners[i][1]);
  ctx.closePath(); ctx.stroke();
}

// 顶面：渐变打底 + 柔和自然色斑（模拟岩石/苔藓/草地的纹理起伏）
function drawTerrainTop(x,z,type,corners,size){
  size = size || 1;
  const t = TERRAIN[type];
  // 基底渐变（受光方向亮→暗）
  const g = ctx.createLinearGradient(corners[0][0],corners[0][1],corners[2][0],corners[2][1]);
  g.addColorStop(0, t.light); g.addColorStop(0.55, t.base); g.addColorStop(1, t.dark);
  ctx.fillStyle=g; poly(corners);
  ctx.save(); ctx.clip();

  // 柔和斑块纹理：用若干半透明椭圆色斑模拟自然肌理（随平台尺寸放大，块数按比例）
  const blobN = (type===0?9 : type===1?8 : type===2?7 : 8) * size;
  for(let k=0;k<blobN;k++){
    const u=pseed(x,z,k+31), v=pseed(x,z,k+47);
    const bx = corners[0][0]+(corners[2][0]-corners[0][0])*u;
    const by = corners[0][1]+(corners[2][1]-corners[0][1])*v;
    const rw = SCALE*(0.10+u*0.14)*size, rh = SCALE*(0.08+v*0.12)*size;
    let col;
    if(type===0){ col = pseed(x,z,k+5)<0.5 ? shade2(t.dark,0.05) : shade2(t.light,-0.05); }
    else if(type===1){ col = pseed(x,z,k+5)<0.55 ? t.moss : shade2(t.base,0.06); }
    else if(type===2){ col = pseed(x,z,k+5)<0.5 ? t.deep : t.leaf; }
    else { col = pseed(x,z,k+5)<0.5 ? t.crack : shade2(t.light,-0.04); }
    ctx.fillStyle=col; ctx.globalAlpha=0.32;
    ctx.beginPath(); ctx.ellipse(bx,by,rw,rh,pseed(x,z,k+9)*Math.PI,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();
  drawTerrainDecor(x,z,type,corners,size);
}

// 顶面装饰：写实的小树/草丛/苔藓/岩石，圆润自然（随平台尺寸缩放）
function drawTerrainDecor(x,z,type,corners,size){
  size = size || 1;
  const cx=(corners[0][0]+corners[2][0])/2, cy=(corners[0][1]+corners[2][1])/2;
  const s = SCALE*0.18*size;
  const t = TERRAIN[type];
  ctx.save();
  if(type===2){
    // 小树：树干 + 柔和圆形树冠（深浅两层）
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(cx-s*0.12, cy-s*0.85, s*0.24, s*0.6);
    ctx.fillStyle = shade2(t.leaf,0.05);
    ctx.beginPath(); ctx.arc(cx, cy-s*1.1, s*0.55, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = t.deep;
    ctx.beginPath(); ctx.arc(cx-s*0.22, cy-s*1.3, s*0.38, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx+s*0.18, cy-s*1.05, s*0.34, 0, Math.PI*2); ctx.fill();
  } else if(type===1){
    // 青苔石：石块 + 圆润苔藓簇
    ctx.fillStyle = shade2(t.base,-0.06);
    ctx.beginPath(); ctx.ellipse(cx, cy-s*0.15, s*0.42, s*0.26, 0.2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = t.moss;
    ctx.beginPath(); ctx.arc(cx-s*0.4, cy-s*0.15, s*0.2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx+s*0.25, cy-s*0.22, s*0.16, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy-s*0.4, s*0.15, 0, Math.PI*2); ctx.fill();
  } else if(type===3){
    // 山崖：棱角石块 + 纵向裂纹
    ctx.fillStyle = shade2(t.crack,-0.05);
    ctx.beginPath();
    ctx.moveTo(cx-s*0.4, cy-s*0.1); ctx.lineTo(cx-s*0.1, cy-s*0.5); ctx.lineTo(cx+s*0.25, cy-s*0.4); ctx.lineTo(cx+s*0.35, cy-s*0.05); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.15)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(cx-s*0.05, cy-s*0.15); ctx.lineTo(cx+s*0.1, cy-s*0.4); ctx.stroke();
  } else {
    // 岩石：圆润石块 + 高光
    if(pseed(x,z,5)>0.4){
      ctx.fillStyle = shade2(t.base,-0.05);
      ctx.beginPath(); ctx.ellipse(cx, cy-s*0.18, s*0.3, s*0.18, 0.1, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.ellipse(cx-s*0.08, cy-s*0.26, s*0.12, s*0.06, 0.1, 0, Math.PI*2); ctx.fill();
    }
  }
  ctx.restore();
}
// 简化取色（侧壁块明暗）
function shade2(hex, f){ const c=hexToRgb(hex); return `rgb(${clamp(c.r*(1+f))},${clamp(c.g*(1+f))},${clamp(c.b*(1+f))})`; }
function poly(pts){
  ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
  ctx.closePath(); ctx.fill();
}
function hexToRgb(hex){
  const n = parseInt(hex.slice(1),16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
}
function clamp(n){ return Math.max(0,Math.min(255,Math.round(n))); }

// 玩家形象图（乐高人偶）。CROP 用于裁掉右下角水印。
let playerImg=null, playerReady=false;
(function(){
  playerImg = new Image();
  playerImg.onload = ()=>{ playerReady = true; };
  playerImg.src = 'assets/player.png';
})();
const PLAYER_CROP = 0.965;   // 保留顶部高度比例（裁掉底部水印条）

function drawCharacter(x,z,y){
  const [sx, sy] = project(x,z,y);
  const s = SCALE*0.25;  // 角色基础尺寸（约为平台宽度的40%左右）
  const squash = state.char.squash;      // >0 压扁，<0 拉伸
  // 朝向在跳跃之前判定：始终以目标平台方向为准（>0 斜右上用原图，<0 斜左上用翻转图）
  const dir = state.next.dir;
  const dirH = dir[0]-dir[1];
  const tilt = dirH * state.char.tilt || 0;
  ctx.save();
  // 影子始终贴地：用 y=0 投影，随高度缩小、变淡
  const [shx, shy] = project(x,z,0);
  const sc = Math.max(0.25, 1 - y*0.35);
  ctx.globalAlpha = Math.max(0.12, 0.22*(1-y*0.4));
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(shx, shy, s*0.5*sc, s*0.2*sc, 0, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1;
  // 角色绕脚底中心倾斜
  ctx.translate(sx, sy);
  ctx.rotate(tilt);
  if(playerReady){
    // 用图片绘制：高度随压扁/拉伸变化，保持图片宽高比
    const ih = s*1.9*(1 + Math.max(0,-squash)*0.18 - Math.max(0,squash)*0.30);
    const iw = ih * (playerImg.width/(playerImg.height*PLAYER_CROP));
    const srcH = playerImg.height*PLAYER_CROP;
    if(dirH<0){ ctx.scale(-1,1); }   // 向左上跳时水平翻转
    ctx.drawImage(playerImg, 0, 0, playerImg.width, srcH, -iw/2, -ih, iw, ih);
  } else {
    // 回退：几何小人（图片未加载完时）
    const w = s*(0.9+Math.max(0,squash)*0.6);
    const h = s*1.6*(1+Math.max(0,-squash)*0.25 - Math.max(0,squash)*0.45);
    ctx.fillStyle = '#fda4af';
    roundRect(-w/2, -h, w, h, w*0.35);
    ctx.fill();
    ctx.fillStyle = '#fecdd3';
    ctx.beginPath(); ctx.arc(0, -h - s*0.5, s*0.55, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.beginPath(); ctx.arc(-s*0.18, -h - s*0.5 - s*0.05, s*0.09, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(s*0.18, -h - s*0.5 - s*0.05, s*0.09, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}
function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

function drawPopups(){
  for(const p of state.popups){
    const [sx,sy]=project(p.x,p.z,p.y);
    ctx.globalAlpha = p.a;
    ctx.fillStyle = p.center ? '#fbbf24' : '#e2e8f0';
    ctx.font = '800 '+Math.round(p.size)+'px sans-serif'; ctx.textAlign='center';
    ctx.fillText(p.text, sx, sy);
    ctx.globalAlpha=1;
  }
}

/* ================= 游戏逻辑 ================= */
function update(dt){
  state.clock+=dt;
  // 震屏衰减
  state.shake = Math.max(0, state.shake - dt*2.2);

  // 蓄力：角色下蹲压缩，随力度增大；轻微后仰
  if(state.phase==='charge'){
    const el = (performance.now()-state.chargeStart)/1000;
    state.power = Math.min(1, el/CFG.chargeTime);
    state.char.squash = state.power*0.7;
    state.char.tilt = -0.12*state.power;
    powerFill.style.width = (state.power*100)+'%';
  }

  // 飞行：抛物线上升下落，空中拉长、随高度前倾
  if(state.phase==='fly'){
    const j = state.jump;
    const t = Math.min(1, (state.clock-j.t0)/CFG.flightDur);
    const e = easeOutQuad(t);
    const dist = j.dist*e;
    state.char.x = j.from[0] + j.dir[0]*dist;
    state.char.z = j.from[1] + j.dir[1]*dist;
    state.char.y = CFG.arcH*4*t*(1-t);
    // 前半程起跳拉伸，后半程收腿，空中轻微前倾
    const arc = Math.sin(t*Math.PI);
    state.char.squash = -arc*0.35;
    state.char.tilt = 0.35*arc;
    if(t>=1){ settle(); }
  }

  // 落地：压扁回弹，恢复站立
  if(state.phase==='land'){
    state.char.y = Math.max(0, state.char.y - dt*4);
    state.char.squash = Math.max(0, state.char.squash - dt*5);
    state.char.tilt *= (1 - dt*6);
    if(state.char.y<=0 && state.char.squash<=0){ state.char.y=0; state.char.squash=0; state.char.tilt=0; state.phase='idle'; }
  }

  // 失败坠落
  if(state.phase==='fall'){
    state.char.y -= dt*4;
    state.char.x += state.jump.dir[0]*dt*1.6;
    state.char.z += state.jump.dir[1]*dt*1.6;
    state.char.squash=0; state.char.tilt=0.6;
    state.fallRemaining-=dt;
    if(state.fallRemaining<=0) recoverFromFall();
  }

  // popup & particles
  for(const p of state.popups){ p.a-=dt*0.9; p.y+=dt*1.4; p.size+=dt*8; }
  state.popups = state.popups.filter(p=>p.a>0);
  for(const p of state.particles){ p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=dt*3; p.a-=dt*1.2; }
  state.particles = state.particles.filter(p=>p.a>0);

  // 相机跟随角色
  const targetX = state.char.x, targetZ = state.char.z;
  camX += (targetX-camX)*Math.min(1, dt*6);
  camZ += (targetZ-camZ)*Math.min(1, dt*6);
}
function easeOutQuad(t){ return 1-(1-t)*(1-t); }

function settle(){
  const j = state.jump, D = state.next.D;
  const d = j.dist;
  const size = state.next.size || 1;
  const hw = CFG.W/2 * size;
  const landingX=j.from[0]+j.dir[0]*d;
  const landingZ=j.from[1]+j.dir[1]*d;
  const offsetX=landingX-state.next.x, offsetZ=landingZ-state.next.z;
  // Turns retain the previous landing offset, so both axes must be checked.
  const onPlat = Math.abs(offsetX)<=hw+1e-9 && Math.abs(offsetZ)<=hw+1e-9;
  if(!onPlat){
    missLand();
    return;
  }
  const center = Math.hypot(offsetX,offsetZ)<=CFG.centerR*size+1e-9;
  let gained;
  if(center){
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    gained = state.streak + 1;
  } else {
    state.streak = 0;
    gained = 1;
  }
  state.score += gained;
  state.platforms++;
  // 新平台中心 = 起跳平台中心 + dir*D（与 generateNext 同基准，保证棱共线对齐）
  state.current = { x: state.current.x + j.dir[0]*D, z: state.current.z + j.dir[1]*D, color: state.next.color, size: size };
  state.plats.push(state.current);
  // 角色落在实际位置（不吸附），保持真实落点反馈
  state.char.x = j.from[0] + j.dir[0]*d;
  state.char.z = j.from[1] + j.dir[1]*d;
  state.char.y = 0;
  state.char.squash = 0.8;
  spawnPopups(gained, center);
  spawnParticles(state.next.color);
  if(center) SFX.center(state.streak); else SFX.land();
  updateHUD();
  // 抖动反馈
  state.shake = center ? 0.18 : 0.1;

  if(state.platforms >= 50){
    finishGame(true);
    return;
  }
  generateNext();
  state.phase='land';
}
function missLand(){
  state.lives--;
  state.streak = 0;
  SFX.miss();
  state.shake = 0.5;
  state.phase='fall';
  updateHUD();
  state.fallRemaining=0.65;
}
function recoverFromFall(){
  state.fallRemaining=0;
  if(state.lives<=0){ finishGame(false); return; }
  state.char.x=state.current.x; state.char.z=state.current.z; state.char.y=0;
  state.char.squash=0; state.char.tilt=0;
  generateNext(); state.phase='idle'; state.power=0;
}
function spawnPopups(gained, center){
  // 在角色落地位置上方弹出得分
  state.popups.push({x:state.char.x, z:state.char.z, y:0.9, text:'+'+gained, a:1, size:SCALE*0.9, center});
}
function spawnParticles(color){
  const px = state.char.x, pz = state.char.z;
  const col = PALETTE[color];
  for(let i=0;i<10;i++){
    state.particles.push({x:px, z:pz, y:0.4, vx:(Math.random()-0.5)*2.5, vy:-Math.random()*3, a:1, color:col});
  }
}

/* ================= HUD ================= */
function updateHUD(){
  document.getElementById('scoreNum').textContent = state.score;
  document.getElementById('progressTip').textContent = '平台 '+state.platforms+' / 50';
  const livesBox = document.getElementById('livesBox');
  livesBox.innerHTML='';
  for(let i=0;i<3;i++){
    const s=document.createElement('span');
    s.className='life'+(i>=state.lives?' lost':'');
    s.innerHTML = i<state.lives
      ? '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="#f43f5e" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="#334155" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
    livesBox.appendChild(s);
  }
  const tip = document.getElementById('streakTip');
  if(state.streak>=2){ tip.textContent='连跳中心 ×'+state.streak; tip.classList.add('show'); }
  else tip.classList.remove('show');
}

/* ================= 场景切换 ================= */
function show(name){
  cancelCharge();
  state.scene=name;
  state.paused=false;
  document.getElementById('pauseOv').classList.add('hidden');
  document.getElementById('homeOv').classList.toggle('hidden', name!=='home');
  document.getElementById('resOv').classList.toggle('hidden', name!=='result');
  document.getElementById('hud').hidden=name!=='play';
  document.getElementById('pauseBtn').hidden=name!=='play';
  document.getElementById('playHint').hidden=name!=='play';
  if(state.masterGain) state.masterGain.gain.value=state.soundOn?1:0;
}
function startGame(){
  const inp = document.getElementById('nameInput').value.trim();
  state.name = inp || '宾客';
  window.WeddingGuest?.setName(state.name);
  document.activeElement?.blur();
  ensureAudio();
  show('play');
  initRun();
}
function finishGame(win){
  if(state.scene!=='play' || state.phase==='finished') return;
  state.phase='finished';
  if(win){
    state.score += 50;   // 通关额外奖励 50 分
    document.getElementById('scoreNum').textContent = state.score;
    SFX.win();
  } else {
    SFX.lose();
  }
  if(state.score > state.best){
    state.best = state.score; saveBest();
    document.getElementById('resBest').textContent = '新纪录！最高分 '+state.best;
  } else {
    document.getElementById('resBest').textContent = '历史最高分 '+state.best;
  }
  window.WeddingGuest?.recordResult('jump', {score:state.score, won:win, platforms:state.platforms, bestStreak:state.bestStreak});
  document.getElementById('resName').textContent = state.name+' · 本局成绩';
  document.getElementById('resBig').textContent = win?'通关！':'挑战结束';
  document.getElementById('resBig').className = 'res-big '+(win?'win':'lose');
  document.getElementById('resMsg').textContent = win?'恭喜你累计越过 50 个平台，通关奖励 +50 分':'3 条命已用完，再接再厉';
  document.getElementById('rScore').textContent = state.score;
  document.getElementById('rPlat').textContent = state.platforms;
  document.getElementById('rStreak').textContent = state.bestStreak;
  show('result');
}

/* ================= 渲染主循环 ================= */
function render(dt){
  if(backdropDirty){
    // The cave and floor do not move relative to the camera; rasterize once per resize.
    backdrop.width=canvas.width; backdrop.height=canvas.height;
    const mainContext=ctx;
    ctx=backdrop.getContext('2d'); ctx.setTransform(DPR,0,0,DPR,0,0);
    drawCaveBg(); drawCaveFloor();
    ctx=mainContext; backdropDirty=false;
  }
  ctx.clearRect(0,0,W,H);
  ctx.drawImage(backdrop,0,0,W,H);
  drawDust(dt);

  ctx.save();
  if(state.shake>0){ ctx.translate((Math.random()-0.5)*state.shake*8,(Math.random()-0.5)*state.shake*8); }

  // 保留全部平台，按屏幕纵深(远→近)排序绘制，当前/下一平台带强调
  const platDraw = state.plats.map(p=>({p, y:project(p.x,p.z,0)[1], cur:true}))
    .concat([{p:state.next, y:project(state.next.x,state.next.z,0)[1], cur:false}]);
  platDraw.sort((a,b)=>a.y-b.y);
  for(const it of platDraw){
    const [px,py]=project(it.p.x,it.p.z,0);
    const margin=SCALE*(it.p.size||1)*1.5;
    if(px < -margin || px > W+margin || py < -margin || py > H+margin) continue;
    drawPlatform(it.p.x, it.p.z, it.p.color, it.p.size);
    // 下一目标平台顶部描边更亮，提示跳跃方向
    if(!it.cur){
      ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=2;
      const hw=CFG.W/2*(it.p.size||1);
      const pts=[[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]].map(c0=>project(it.p.x+c0[0], it.p.z+c0[1], 0.001));
      ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
      for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
      ctx.closePath(); ctx.stroke();
    }
  }

  // 粒子
  for(const p of state.particles){
    const [sx,sy]=project(p.x,p.z,p.y);
    ctx.globalAlpha=p.a; ctx.fillStyle=p.color;
    ctx.beginPath(); ctx.arc(sx,sy,SCALE*0.12,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
  }

  // 角色（变形由 squash/tilt 表达，内部已自绘）
  if(state.scene==='play'){
    drawCharacter(state.char.x, state.char.z, state.char.y);
  }

  drawPopups();
  ctx.restore();
}
// 山洞背景：柔和岩壁渐变 + 自然钟乳石剪影 + 漂浮尘埃（写实）
function drawCaveBg(){
  // 洞窟渐变：底部深邃，中部岩壁微光
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#2c3547'); g.addColorStop(0.45,'#1d2332'); g.addColorStop(1,'#12151f');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

  // 岩壁柔和光斑（大范围径向渐变，模拟洞壁起伏光照）
  for(let i=0;i<6;i++){
    const bx=(i*211)%W, by=(i*149)%Math.floor(H*0.7);
    const r=Math.max(W,H)*0.3;
    const rg=ctx.createRadialGradient(bx,by,0,bx,by,r);
    const a = 0.04 + pseed(i,2,0)*0.04;
    rg.addColorStop(0,`rgba(190,205,225,${a})`); rg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=rg; ctx.fillRect(0,0,W,H);
  }

  // 顶部钟乳石剪影（柔和多边形，非像素阶梯）
  ctx.fillStyle='#141a26';
  const seg = Math.max(5, Math.floor(W/130));
  for(let i=0;i<seg;i++){
    const bx=i*(W/seg), w=W/seg;
    const len = (36 + pseed(i,1,0)*80);
    const tip = w*0.5 + (pseed(i,3,0)-0.5)*w*0.5;
    ctx.beginPath();
    ctx.moveTo(bx,0);
    ctx.lineTo(bx+w*0.12, len*0.6);
    ctx.quadraticCurveTo(bx+tip, len, bx+tip+w*0.05, len*0.45);
    ctx.quadraticCurveTo(bx+w*0.55, len*0.7, bx+w*0.75, len*0.5);
    ctx.quadraticCurveTo(bx+w*0.9, len*0.25, bx+w, 0);
    ctx.closePath(); ctx.fill();
    // 钟乳石尖端微光
    ctx.fillStyle='rgba(180,200,220,0.05)';
    ctx.beginPath(); ctx.arc(bx+tip, len*0.5, w*0.18, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle='#141a26';
  }
  // 顶部再压一层暗
  const g2 = ctx.createLinearGradient(0,0,0,H*0.32);
  g2.addColorStop(0,'rgba(0,0,0,0.5)'); g2.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g2; ctx.fillRect(0,0,W,H*0.32);

}
function drawDust(dt){
  // Motion is time based, including on high refresh rate phones.
  if(!state.dust){ state.dust=[]; for(let i=0;i<40;i++) state.dust.push({x:Math.random()*W,y:Math.random()*H,s:Math.random()<0.5?2:3,v:(Math.random()*0.3+0.1)}); }
  for(const d of state.dust){
    d.y -= d.v*dt*60; d.x += Math.sin((d.y+state.clock*0.1)*0.02)*0.3*dt*60;
    if(d.y<-5) { d.y=H+5; d.x=Math.random()*W; }
    ctx.fillStyle = 'rgba(210,220,235,'+(0.10+d.s*0.03)+')';
    ctx.fillRect(d.x, d.y, d.s, d.s);
  }
}

// 地面岩层（写实，跟随平台所在平面）
function drawCaveFloor(){
  const [ax,az]=[camX,camZ];
  const step = 0.8;
  // 深色地平面 + 柔和渐变
  const [,fy]=project(ax,az,-0.3);
  const fg=ctx.createLinearGradient(0,fy,0,H);
  fg.addColorStop(0,'rgba(30,36,52,0.2)'); fg.addColorStop(0.3,'rgba(14,17,25,0.6)'); fg.addColorStop(1,'rgba(8,10,16,0.85)');
  ctx.fillStyle=fg; ctx.fillRect(0,fy+SCALE*0.3,W,H-fy-SCALE*0.3);
  // 岩石纹理（柔和斑点）
  for(let i=-24;i<=24;i++){
    for(let j=-10;j<=10;j++){
      if(pseed(i,j,0)<0.14){
        const [gx,gy]=project(ax+i*step, az+j*step, -0.5);
        ctx.fillStyle='rgba(95,105,125,'+(0.08+pseed(i,j,3)*0.10)+')';
        ctx.beginPath(); ctx.ellipse(gx, gy, SCALE*0.14, SCALE*0.10, 0, 0, Math.PI*2); ctx.fill();
      }
    }
  }
}

/* ================= 主循环 ================= */
let lastT = performance.now();
function loop(now){
  const dt = Math.max(0, Math.min(0.05, (now-lastT)/1000));
  lastT = now;
  if(!document.hidden){
    if(state.scene==='play' && !state.paused) update(dt);
    render(state.paused?0:dt);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ================= 事件绑定 ================= */
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('nameInput').addEventListener('keydown', e=>{
  if(e.key==='Enter' && !e.isComposing && !e.repeat){ e.preventDefault(); startGame(); }
});
document.getElementById('againBtn').addEventListener('click', ()=>{ document.activeElement?.blur(); ensureAudio(); show('play'); initRun(); });
document.getElementById('pauseBtn').addEventListener('click', pauseGame);
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('homeBtn').addEventListener('click', ()=>{
  document.getElementById('homeBest').textContent = '历史最高分 '+state.best;
  show('home');
});
document.getElementById('soundBtn').addEventListener('click', ()=>{
  state.soundOn = !state.soundOn;
  const button=document.getElementById('soundBtn');
  button.textContent=state.soundOn?'🔊':'🔇';
  button.setAttribute('aria-pressed',String(!state.soundOn));
  button.setAttribute('aria-label',state.soundOn?'关闭声音':'开启声音');
  button.title=state.soundOn?'关闭声音':'开启声音';
  if(state.masterGain) state.masterGain.gain.value=state.soundOn&&!state.paused?1:0;
  try{ localStorage.setItem('tiaotiao_sound',state.soundOn?'on':'off'); }catch(_){}
  if(!state.paused) ensureAudio();
  button.blur();
});
canvas.addEventListener('contextmenu', e=>e.preventDefault());

// 初始首页显示最高分
document.getElementById('homeBest').textContent = '历史最高分 '+state.best;

// A shared nickname and per-device records also work when storage is unavailable.
document.getElementById('nameInput').value=window.WeddingGuest?.getName()||'';
try{
  if(localStorage.getItem('tiaotiao_sound')==='off') document.getElementById('soundBtn').click();
}catch(_){}
