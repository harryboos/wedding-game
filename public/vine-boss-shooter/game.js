"use strict";

/* ============ 工具 ============ */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, dpr = 1;
let entitiesReady = false;
function resize(){
  const oldW = W, oldH = H;
  W = Math.max(1, canvas.clientWidth || window.innerWidth);
  H = Math.max(1, canvas.clientHeight || window.innerHeight);
  dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if(entitiesReady && oldW && oldH){
    const sx = W / oldW, sy = H / oldH;
    for(const item of [player, boss, ...pBullets, ...eBullets, ...bombs, ...particles]){
      item.x *= sx; item.y *= sy;
      if('tx' in item){ item.tx *= sx; item.ty *= sy; }
    }
    for(const vine of vines){ vine.x1 *= sx; vine.x2 *= sx; vine.y1 *= sy; vine.y2 *= sy; }
    clearInput();
    // A keyboard or collapsing address bar may change only the height.
    if(state === 'playing' && Math.abs(W-oldW)>oldW*0.15) setPaused(true);
  }
}
window.addEventListener('resize', resize);
resize();

const rnd = (a,b)=>a+Math.random()*(b-a);
const clamp = (v,a,b)=>v<a?a:(v>b?b:v);
const dist = (x1,y1,x2,y2)=>Math.hypot(x2-x1,y2-y1);
const angTo = (x1,y1,x2,y2)=>Math.atan2(y2-y1,x2-x1);

/* ============ 游戏全局状态 ============ */
const CFG = {
  timeLimit: 60,          // 秒
  bossMaxHp: 1200,
  driveAwayPct: 0.2,      // 20%
  playerLives: 3,
  playerHp: 3,
  fireInterval: 0.1733,   // 秒（相对 0.26 提速 1.5 倍）
  bulletDmg: 8,
  vineHp: 90,
  vineDestroyScore: 40,
  hitScore: 2,            // 每发子弹命中 BOSS 得分
  killBonus: 1500,
  driveBonus: 1000,
  timeBonusPerSec: 20,
  killTimeBonusPerSec: 5,   // 击杀胜利：每剩余 1 秒 +5 分
  lifeBonus: 15,            // 击杀胜利：每剩余 1 条命 +15 分
};
let state = 'start';      // start | playing | victory | defeat
let score = 0, timer = CFG.timeLimit, elapsed = 0;
let stats = {dmg:0, vine:0, shotsHit:0};
let playerName = '宾客';
let winReason = '';

/* ============ BOSS 立绘素材 ============ */
const BOSS_IMG = {
  idle:   document.getElementById('imgBossIdle'),
  throw:  document.getElementById('imgBossThrow'),
  charge: document.getElementById('imgBossCharge'),
  defeat: document.getElementById('imgBossDefeat'),
};
/* 玩家猎人立绘 */
const PLAYER_IMG = document.getElementById('imgPlayer');

/* ============ 实体 ============ */
let player, boss, vines = [], pBullets = [], eBullets = [], bombs = [], particles = [];

function initEntities(){
  player = { x:W/2, y:H*0.76, r:15, hp:CFG.playerHp, maxHp:CFG.playerHp,
             lives:CFG.playerLives, invincible:0, fireT:0 };
  boss = { x:W/2, y:Math.max(130,H*0.22), r:46, hp:CFG.bossMaxHp, maxHp:CFG.bossMaxHp,
           mode:'idle', idleT:1.0, pat:null, strafe:0, flash:0, shake:0,
           chargeAura:0, chargeProgress:0 };
  vines = []; pBullets = []; eBullets = []; bombs = []; particles = [];
  entitiesReady = true;
}

/* BOSS 攻击模式循环：扇形 → 螺旋 → 藤蔓 → 蓄力大招 */
const PATTERNS = [
  {type:'fan',    dur:2.5 },
  {type:'spiral', dur:3.2 },
  {type:'vine',   dur:2.8 },
  {type:'charge', dur:2.4 },
];
let patIdx = 0;

function pickPattern(){
  const p = PATTERNS[patIdx % PATTERNS.length];
  patIdx++;
  return {
    type:p.type, time:0, dur:p.dur,
    volleyT:0, angle:rnd(0, Math.PI*2), fireT:0,
    spawnT:0, spawned:0, bombFired:false, telegraph:1.15,
  };
}

/* 生成敌弹 */
function eBullet(x,y,angle,speed,r){
  eBullets.push({x,y,angle,speed,r:r||5,t:0});
}

/* 线段工具：点到线段距离 / 线段与矩形(Liang-Barsky)求交 */
function segDist(px,py,x1,y1,x2,y2){
  const dx=x2-x1, dy=y2-y1, l2=dx*dx+dy*dy;
  let t = l2 ? ((px-x1)*dx+(py-y1)*dy)/l2 : 0;
  t = clamp(t,0,1);
  const cx=x1+t*dx, cy=y1+t*dy;
  return Math.hypot(px-cx, py-cy);
}
function lineThroughRect(x,y,angle){
  const dx=Math.cos(angle), dy=Math.sin(angle);
  let t0=-Infinity, t1=Infinity;
  // Liang-Barsky：对每条边界 p*t + q >= 0
  const clip=(p,q)=>{
    if(Math.abs(p)<1e-12) return q>=0;
    const r=q/p;
    if(p<0){ if(r>t1) return false; if(r>t0) t0=r; }
    else  { if(r<t0) return false; if(r<t1) t1=r; }
    return true;
  };
  if(!clip(-dx, x)) return null;      // 左边界 x=0
  if(!clip( dx, W-x)) return null;    // 右边界 x=W
  if(!clip(-dy, y)) return null;      // 上边界 y=0
  if(!clip( dy, H-y)) return null;    // 下边界 y=H
  if(!isFinite(t0) || !isFinite(t1)) return null;
  // 端点夹取到地图内，消除浮点越界
  return [[clamp(x+t0*dx,0,W), clamp(y+t0*dy,0,H)],
          [clamp(x+t1*dx,0,W), clamp(y+t1*dy,0,H)]];
}

/* 生成藤蔓：从 BOSS 当前位置以随机斜率横穿整张地图的直线障碍 */
function spawnVine(){
  if (vines.length >= 2) return;
  // Leave a small gap around the hunter instead of trapping them on spawn.
  for(let attempt=0; attempt<16; attempt++){
    const seg = lineThroughRect(boss.x, boss.y, rnd(0, Math.PI));
    if(!seg || segDist(player.x,player.y,seg[0][0],seg[0][1],seg[1][0],seg[1][1]) < player.r+14) continue;
    vines.push({ x1:seg[0][0], y1:seg[0][1], x2:seg[1][0], y2:seg[1][1],
                 hp:CFG.vineHp, maxHp:CFG.vineHp, wobble:rnd(0,6.28) });
    return;
  }
}

/* 蓄力大招：橙色炸弹（蓄力已在 BOSS 本体体现，落地即爆） */
function fireBomb(){
  const speed = 250;
  let tx = clamp(player.x, 30, W-30), ty = clamp(player.y, 30, H-30);
  bombs.push({ x:boss.x, y:boss.y, tx, ty, speed, r:13, arrived:false, boomR:95 });
}

/* ============ 输入 ============ */
const keys = Object.create(null);
const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
let pointerOn = false, pointerId = null, pointerX = 0, pointerY = 0;
let dragOffsetX = 0, dragOffsetY = 0;
function releasePointer(){
  const id = pointerId;
  pointerOn = false; pointerId = null;
  if(id !== null && canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
}
function clearInput(){
  for(const key of Object.keys(keys)) delete keys[key];
  releasePointer();
}
function pointerPosition(event){
  const rect = canvas.getBoundingClientRect();
  return {x: (event.clientX-rect.left)*W/rect.width, y: (event.clientY-rect.top)*H/rect.height};
}
window.addEventListener('keydown', event=>{
  if(event.target?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
  if(state !== 'playing') return;
  if(event.code === 'KeyP' || event.code === 'Escape'){
    event.preventDefault();
    if(!event.repeat) togglePause();
  } else if(MOVE_KEYS.has(event.code)){
    event.preventDefault();
    if(!paused){ releasePointer(); keys[event.code] = true; }
  }
});
window.addEventListener('keyup', event=>{ delete keys[event.code]; });
canvas.addEventListener('pointerdown', event=>{
  if(state !== 'playing' || paused || pointerId !== null || event.isPrimary === false || event.button > 0) return;
  event.preventDefault();
  const point = pointerPosition(event);
  clearInput();
  pointerId = event.pointerId; pointerOn = true;
  // Touch dragging is relative so a finger can stay clear of the hunter.
  dragOffsetX = event.pointerType === 'touch' ? player.x-point.x : 0;
  dragOffsetY = event.pointerType === 'touch' ? player.y-point.y : 0;
  pointerX = point.x + dragOffsetX; pointerY = point.y + dragOffsetY;
  canvas.setPointerCapture?.(event.pointerId);
});
canvas.addEventListener('pointermove', event=>{
  if(event.pointerId !== pointerId || !pointerOn) return;
  const point = pointerPosition(event);
  pointerX = point.x + dragOffsetX; pointerY = point.y + dragOffsetY;
});
for(const type of ['pointerup', 'pointercancel', 'lostpointercapture']){
  canvas.addEventListener(type, event=>{ if(event.pointerId === pointerId) releasePointer(); });
}
window.addEventListener('blur', ()=>{ clearInput(); if(state === 'playing') setPaused(true); });
window.addEventListener('pagehide', ()=>{ clearInput(); if(state === 'playing') setPaused(true); });
document.addEventListener('visibilitychange', ()=>{
  clearInput(); last = null; accumulator = 0;
  if(document.hidden && state === 'playing') setPaused(true);
});

/* ============ 音效（用户手势后启用） ============ */
let audio = null, muted = true;
function initAudio(){
  if(muted) return;
  try {
    if(!audio) audio = new (window.AudioContext||window.webkitAudioContext)();
    if(audio.state === 'suspended') audio.resume().catch(()=>{});
  } catch(e){}
}
function tone(freq,dur,type,vol){
  if(!audio || muted || paused || document.hidden) return;
  try{
    const o=audio.createOscillator(), g=audio.createGain();
    o.type=type||'square'; o.frequency.value=freq;
    g.gain.value=vol||0.05;
    o.connect(g); g.connect(audio.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime+dur); o.stop(audio.currentTime+dur);
  }catch(e){}
}
const S = {
  shot:()=>tone(880,0.05,'square',0.018),
  hit:()=>tone(160,0.12,'sawtooth',0.05),
  bossHit:()=>tone(320,0.08,'triangle',0.04),
  vine:()=>tone(520,0.18,'sawtooth',0.05),
  boom:()=>{tone(70,0.5,'sawtooth',0.09); tone(40,0.6,'sine',0.09);},
  die:()=>{tone(200,0.4,'sawtooth',0.07); setTimeout(()=>tone(120,0.5,'sawtooth',0.07),120);},
  win:()=>{[523,659,784,1046].forEach((f,i)=>setTimeout(()=>tone(f,0.18,'triangle',0.06),i*130));},
  lose:()=>{[392,330,262,196].forEach((f,i)=>setTimeout(()=>tone(f,0.22,'triangle',0.06),i*150));},
};

/* ============ 粒子 ============ */
function burst(x,y,n,color,speed,life,size){
  for(let i=0;i<n && particles.length<420;i++){
    const a=rnd(0,Math.PI*2), sp=rnd(speed*0.3,speed);
    particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,t:0,maxLife:life||0.5,color,size:size||3});
  }
}
function ring(x,y,r,color,life){
  particles.push({x,y,vx:0,vy:0,t:0,maxLife:life||0.4,color,size:r,ring:true});
}

/* ============ 玩家 ============ */
function movePlayer(dt){
  let vx=0, vy=0;
  if(keys['ArrowLeft']||keys['KeyA']) vx-=1;
  if(keys['ArrowRight']||keys['KeyD']) vx+=1;
  if(keys['ArrowUp']||keys['KeyW']) vy-=1;
  if(keys['ArrowDown']||keys['KeyS']) vy+=1;
  if(vx&&vy){ const inv=0.7071; vx*=inv; vy*=inv; }
  const spd = 300*dt;
  let nx = player.x + vx*spd;
  let ny = player.y + vy*spd;
  if(pointerOn){
    const dx=pointerX-player.x, dy=pointerY-player.y, d=Math.hypot(dx,dy);
    if(d>2){ const follow=Math.min(420*dt, d); nx=player.x+dx/d*follow; ny=player.y+dy/d*follow; }
  }
  // 藤蔓阻挡：先试 X 再试 Y，命中则回退
  if(!blockedByVine(nx,player.y,player.r)) player.x=nx;
  if(!blockedByVine(player.x,ny,player.r)) player.y=ny;
  player.x=clamp(player.x, player.r, W-player.r);
  player.y=clamp(player.y, Math.min(110, H*0.35)+player.r, H-65);
}

function blockedByVine(x,y,r){
  for(const v of vines){
    const nextDistance=segDist(x,y,v.x1,v.y1,v.x2,v.y2);
    const currentDistance=segDist(player.x,player.y,v.x1,v.y1,v.x2,v.y2);
    // Resizing can place an existing vine over a hunter: allow movement out.
    if(nextDistance < r+5 && nextDistance <= currentDistance+0.001) return true;
  }
  return false;
}

function playerFire(dt){
  player.fireT -= dt;
  if(player.fireT<=0){
    player.fireT += CFG.fireInterval;
    const bx=player.x, by=player.y-16;
    pBullets.push({x:bx,y:by,vy:-560,r:4});   // 单发
    S.shot();
  }
}

function damagePlayer(dmg){
  if(state !== 'playing' || player.invincible>0) return;
  player.hp -= dmg;
  burst(player.x,player.y,14,'#ff5f9d',160,0.5,4);
  if(player.hp<=0){
    player.lives--;
    S.die();
    if(player.lives<=0){ defeat('lives'); return; }
    player.hp = player.maxHp;
    player.invincible = 2;   // 原地复活，无敌 2 秒
    ring(player.x,player.y,50,'#5ef2ff',0.7);
  } else {
    player.invincible = 0.8; // 受击短暂无敌
    boss.shake = Math.max(boss.shake, 0.4);
  }
  updateHud();
}

/* ============ BOSS ============ */
function updateBoss(dt){
  // 浮动 + 巡航
  boss.strafe += dt;
  boss.x = clamp(W/2 + Math.sin(boss.strafe*0.55)*Math.min(W*0.22, 200), W*0.16, W*0.84);
  boss.y = Math.max(130,H*0.22) + Math.sin(boss.strafe*1.3)*10;
  if(boss.flash>0) boss.flash-=dt;
  if(boss.shake>0) boss.shake-=dt;

  if(boss.mode==='idle'){
    boss.idleT -= dt;
    if(boss.idleT<=0){ boss.mode='pattern'; boss.pat=pickPattern(); }
    return;
  }
  const p=boss.pat; p.time += dt;
  if(p.type==='fan')      updateFan(p,dt);
  else if(p.type==='spiral') updateSpiral(p,dt);
  else if(p.type==='vine')   updateVine(p,dt);
  else if(p.type==='charge') updateCharge(p,dt);
  if(p.time>=p.dur){ boss.mode='idle'; boss.idleT = rnd(0.7,1.25); }
}

function updateFan(p,dt){
  p.volleyT -= dt;
  if(p.volleyT<=0){
    p.volleyT = 0.42;
    const base = angTo(boss.x,boss.y,player.x,player.y);
    const spread = Math.PI/1.9;      // 约 95°
    const count = 9;
    const spd = 210;
    for(let i=0;i<count;i++){
      const a = base - spread/2 + spread*i/(count-1);
      eBullet(boss.x,boss.y,a,spd,5);
    }
    S.hit();
  }
}

function updateSpiral(p,dt){
  p.angle += dt*3.6;
  p.fireT -= dt;
  if(p.fireT<=0){
    p.fireT = 0.11;
    eBullet(boss.x,boss.y,p.angle,190,5);
    eBullet(boss.x,boss.y,p.angle+Math.PI,190,5);   // 双臂螺旋
  }
}

function updateVine(p,dt){
  p.spawnT -= dt;
  if(p.spawnT<=0){
    p.spawnT = 1.4;
    if(p.spawned<2){ spawnVine(); p.spawned++; }
  }
}

function updateCharge(p,dt){
  // 蓄力进度 0..1，橙色能量在 BOSS 核心处累积
  if(p.telegraph>0){
    p.telegraph -= dt;
    boss.chargeProgress = clamp(1 - p.telegraph/1.15,0,1);
    boss.chargeAura = 1;
    // 能量向核心汇聚的粒子
    for(let k=0;k<2;k++){
      const a=rnd(0,Math.PI*2), rr=rnd(34,66);
      const px=boss.x+Math.cos(a)*rr, py=boss.y+Math.sin(a)*rr;
      const dx=boss.x-px, dy=boss.y-py, d=Math.hypot(dx,dy)||1;
      particles.push({x:px,y:py,vx:dx/d*130,vy:dy/d*130,t:0,maxLife:0.5,color:'#ff9d3c',size:3});
    }
    if(p.telegraph<=0 && !p.bombFired){ fireBomb(); p.bombFired=true; boss.flash=0.35; }
  } else {
    boss.chargeAura = 0;
  }
}

/* ============ 子弹 / 藤蔓 / 炸弹更新 ============ */
// Continuous collision checks keep fast stones from skipping narrow vines.
function circleHitTime(ax, ay, bx, by, cx, cy, radius){
  const dx=bx-ax, dy=by-ay, ox=ax-cx, oy=ay-cy;
  const c=ox*ox+oy*oy-radius*radius;
  if(c<=0) return 0;
  const a=dx*dx+dy*dy;
  if(a===0) return Infinity;
  const b=2*(ox*dx+oy*dy), discriminant=b*b-4*a*c;
  if(discriminant<0) return Infinity;
  const t=(-b-Math.sqrt(discriminant))/(2*a);
  return t>=0 && t<=1 ? t : Infinity;
}
function vineHitTime(ax, ay, bx, by, vine, radius){
  const dx=vine.x2-vine.x1, dy=vine.y2-vine.y1, length=Math.hypot(dx,dy);
  if(!length) return circleHitTime(ax,ay,bx,by,vine.x1,vine.y1,radius);
  const ux=dx/length, uy=dy/length;
  const ox=ax-vine.x1, oy=ay-vine.y1, vx=bx-ax, vy=by-ay;
  let low=0, high=1;
  const clip=(origin, direction, min, max)=>{
    if(Math.abs(direction)<1e-9) return origin>=min && origin<=max;
    const a=(min-origin)/direction, b=(max-origin)/direction;
    low=Math.max(low,Math.min(a,b)); high=Math.min(high,Math.max(a,b));
    return low<=high;
  };
  const strip=clip(ox*ux+oy*uy,vx*ux+vy*uy,0,length) && clip(-ox*uy+oy*ux,-vx*uy+vy*ux,-radius,radius);
  return Math.min(strip ? low : Infinity,
    circleHitTime(ax,ay,bx,by,vine.x1,vine.y1,radius),
    circleHitTime(ax,ay,bx,by,vine.x2,vine.y2,radius));
}
function updatePlayerBullets(dt){
  for(let i=pBullets.length-1;i>=0;i--){
    const bullet=pBullets[i], previousY=bullet.y;
    bullet.y += bullet.vy*dt;
    let target=null, hitTime=circleHitTime(bullet.x,previousY,bullet.x,bullet.y,boss.x,boss.y,boss.r+bullet.r);
    for(const vine of vines){
      if(vine.hp<=0) continue;
      const t=vineHitTime(bullet.x,previousY,bullet.x,bullet.y,vine,5+bullet.r);
      if(t<hitTime){ target=vine; hitTime=t; }
    }
    if(Number.isFinite(hitTime)){
      pBullets.splice(i,1);
      if(target){
        target.hp-=CFG.bulletDmg;
        burst(bullet.x,previousY+(bullet.y-previousY)*hitTime,5,'#5ef2a0',90,0.3,3);
      } else {
        hitBoss();
        if(state !== 'playing') return;
      }
    } else if(bullet.y < -20) pBullets.splice(i,1);
  }
  for(let i=vines.length-1;i>=0;i--){
    if(vines[i].hp<=0){
      const vine=vines[i], mx=(vine.x1+vine.x2)/2, my=(vine.y1+vine.y2)/2;
      burst(mx,my,18,'#5ef2a0',180,0.6,4);
      ring(mx,my,40,'#5ef2a0',0.4);
      vines.splice(i,1);
      score += CFG.vineDestroyScore; stats.vine++;
      S.vine();
    }
  }
}

function hitBoss(){
  if(state !== 'playing') return;
  const damage = Math.min(boss.hp, CFG.bulletDmg);
  boss.hp = Math.max(0, boss.hp-damage);
  boss.flash = 0.08;
  score += CFG.hitScore; stats.dmg += damage; stats.shotsHit++;
  burst(boss.x+rnd(-20,20), boss.y+rnd(-20,20), 4, '#ffd166', 120, 0.3, 3);
  S.bossHit();
  if(boss.hp<=0){ boss.hp=0; victory('killed'); }
}

function updateEnemyBullets(dt){
  for(let i=eBullets.length-1;i>=0;i--){
    const b=eBullets[i];
    b.x += Math.cos(b.angle)*b.speed*dt;
    b.y += Math.sin(b.angle)*b.speed*dt;
    b.t += dt;
    if(b.x<-20||b.x>W+20||b.y<-20||b.y>H+20||b.t>12) eBullets.splice(i,1);
    else if(dist(b.x,b.y,player.x,player.y) < b.r+player.r){
      if(player.invincible<=0){
        eBullets.splice(i,1);
        damagePlayer(1);
        if(state !== 'playing') return;
      }
    }
  }
}

function updateBombs(dt){
  for(let i=bombs.length-1;i>=0;i--){
    const b=bombs[i];
    if(!b.arrived){
      const dx=b.tx-b.x, dy=b.ty-b.y, d=Math.hypot(dx,dy);
      if(d < b.speed*dt*1.5){
        b.arrived=true;
      } else {
        b.x+=dx/d*b.speed*dt; b.y+=dy/d*b.speed*dt;
      }
    }
    if(b.arrived){
      // 落地爆炸：范围伤害 + 特效
      if(dist(player.x,player.y,b.tx,b.ty) < b.boomR){
        if(player.invincible<=0) damagePlayer(1);
      }
      burst(b.tx,b.ty,30,'#ff9d3c',260,0.6,5);
      burst(b.tx,b.ty,20,'#ff5a5a',200,0.7,4);
      ring(b.tx,b.ty,b.boomR,'#ff9d3c',0.35);
      S.boom();
      bombs.splice(i,1);
      if(state !== 'playing') return;
    }
  }
}

function updateParticles(dt){
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];
    p.t+=dt;
    if(p.t>=p.maxLife){ particles.splice(i,1); continue; }
    p.x+=p.vx*dt; p.y+=p.vy*dt;
    const damping=Math.pow(0.92,dt*60);
    p.vx*=damping; p.vy*=damping;
  }
}

/* ============ 游戏主流程 ============ */
let paused = false;
let endTimer = 0;   // 结算动画倒计时（让玩家看到 BOSS 倒地/爆炸再弹结算）
function setPaused(value){
  if(state !== 'playing') return;
  paused = value;
  clearInput(); last = null; accumulator = 0;
  $('pauseScreen').classList.toggle('hidden', !paused);
  $('pauseBtn').textContent = paused ? '继续' : '暂停';
  if(paused) $('resumeBtn').focus({preventScroll:true});
  else { $('pauseBtn').blur(); initAudio(); }
}
function togglePause(){ setPaused(!paused); }

function update(dt){
  if(document.hidden || paused) return;
  // 结算动画期间：粒子与倒计时继续，结束后弹结算界面
  if(state==='victory'||state==='defeat'){
    if(endTimer>0){
      endTimer -= dt;
      updateParticles(dt);
      if(endTimer<=0) showResult(state==='victory');
    }
    return;
  }
  if(state!=='playing') return;
  elapsed += dt;
  timer = Math.max(0, CFG.timeLimit - elapsed);
  movePlayer(dt);
  playerFire(dt);
  if(player.invincible>0) player.invincible-=dt;
  updateBoss(dt);
  updatePlayerBullets(dt);
  if(state !== 'playing'){ updateHud(); return; }
  updateEnemyBullets(dt);
  if(state !== 'playing'){ updateHud(); return; }
  updateBombs(dt);
  if(state !== 'playing'){ updateHud(); return; }
  updateParticles(dt);

  // 时限判定：20% 及以下视为驱离 → 胜利，否则失败
  if(timer<=0){
    if(boss.hp <= CFG.bossMaxHp*CFG.driveAwayPct) victory('driven');
    else defeat('timeout');
  }
  updateHud();
}

/* ============ 胜利 / 失败 ============ */
function victory(kind){
  if(state!=='playing') return;
  state='victory';
  clearInput();
  stats.combatScore = score;
  let bonus = 0;
  if(kind==='killed'){
    score+=CFG.killBonus; winReason='成功讨伐天狗兽，赶紧回去找茛婆婆吧！';
    // 清空剩余弹幕，聚焦倒地立绘
    eBullets.length=0; vines.length=0; bombs.length=0;
    burst(boss.x,boss.y,46,'#ffd166',300,0.9,5);
    burst(boss.x,boss.y,40,'#ff7a1e',240,1.0,4);
    ring(boss.x,boss.y,110,'#ff9d3c',0.6);
    // 击败加成：剩余时长每 1 秒 +5，剩余每条命 +15
    bonus = Math.round(timer)*CFG.killTimeBonusPerSec + player.lives*CFG.lifeBonus;
  }
  else {
    score+=CFG.driveBonus; winReason='成功驱离天狗兽，赶紧回去找茛婆婆吧！';
    bonus = Math.round(timer)*CFG.timeBonusPerSec;
  }
  score += bonus;
  S.win();
  endTimer = 1.4;   // 展示 BOSS 倒地立绘 1.4 秒
}

function defeat(kind){
  if(state!=='playing') return;
  state='defeat';
  clearInput();
  stats.combatScore = score;
  if(kind==='lives') winReason='3 条命全部耗尽，猎人被天狗兽击败';
  else winReason='60 秒时限已到，未能将 BOSS 血量压至 20% 及以下';
  S.lose();
  endTimer = 1.0;
}

/* ============ 界面管理 ============ */
const elements = new Map();
const $ = id=>{
  if(!elements.has(id)) elements.set(id, document.getElementById(id));
  return elements.get(id);
};
const lifeNodes = [...$('livesTxt').children], hpNodes = [...$('hpSeg').children];
let hudSnapshot = {};
function guestCall(method, ...args){
  try { return window.WeddingGuest?.[method]?.(...args); } catch(error) { return undefined; }
}
function getSavedName(){
  if(window.WeddingGuest?.getName) return guestCall('getName') || '';
  try { return localStorage.getItem('wedding-guest-name') || ''; } catch(error) { return ''; }
}
function saveName(name){
  if(window.WeddingGuest?.setName){ guestCall('setName', name); return; }
  try { localStorage.setItem('wedding-guest-name', name); } catch(error) { /* Private browsing may deny storage. */ }
}
function bestScore(){
  const best = guestCall('getBest', 'boss');
  return typeof best === 'number' ? best : (best?.score || 0);
}
function setHudVisible(visible){
  for(const id of ['bossbar','hud','timerPos','score-pos','gameControls']) $(id).hidden = !visible;
}
function startGame(){
  playerName = ($('pname').value.trim() || '宾客').slice(0,12);
  saveName(playerName);
  $('pname').value = playerName === '宾客' ? '' : playerName;
  $('pname').blur();
  score=0; elapsed=0; timer=CFG.timeLimit; endTimer=0;
  stats={dmg:0,vine:0,shotsHit:0};
  patIdx=0; paused=false;
  clearInput(); last=null; accumulator=0;
  initEntities();
  state='playing';
  $('startScreen').classList.add('hidden');
  $('resultScreen').classList.add('hidden');
  $('pauseScreen').classList.add('hidden');
  $('pauseBtn').textContent = '暂停';
  setHudVisible(true);
  $('nameTxt').textContent = playerName;
  hudSnapshot = {};
  updateHud();
}
function showResult(win){
  setHudVisible(false);
  $('resultScreen').classList.remove('hidden');
  const head=$('resultHead');
  head.textContent = win?'挑战成功！':'再试一次吧';
  head.className = 'result-head '+(win?'win':'lose');
  $('resultReason').textContent = winReason;
  $('stScore').textContent = stats.combatScore ?? (stats.shotsHit*CFG.hitScore + stats.vine*CFG.vineDestroyScore);
  $('stDmg').textContent = stats.dmg;
  $('stVine').textContent = stats.vine;
  $('stName').textContent = playerName;
  $('finalScore').textContent = score;
  guestCall('recordResult', 'boss', {score, won: win, damage: stats.dmg, elapsed: Math.min(CFG.timeLimit, elapsed)});
  $('resultBest').textContent = '本机最佳：' + Math.max(score, bestScore()) + ' 分';
  head.focus({preventScroll:true});
}
function updateHud(){
  if(hudSnapshot.bossHp !== boss.hp){
    $('hpFill').style.transform = 'scaleX(' + clamp(boss.hp/boss.maxHp,0,1) + ')';
    $('hpText').textContent = 'HP '+Math.max(0,Math.round(boss.hp))+' / '+boss.maxHp;
    hudSnapshot.bossHp = boss.hp;
  }
  if(hudSnapshot.score !== score){ $('scoreTxt').textContent = score; hudSnapshot.score = score; }
  const seconds = Math.ceil(timer);
  if(hudSnapshot.timer !== seconds){
    $('timerTxt').textContent = seconds;
    $('timerTxt').className = 't'+(seconds<=10?' low':'');
    hudSnapshot.timer = seconds;
  }
  if(hudSnapshot.lives !== player.lives){
    lifeNodes.forEach((node,index)=>{ node.className = index<player.lives ? '' : 'empty'; });
    $('livesTxt').setAttribute('aria-label', '剩余 '+player.lives+' 条生命');
    hudSnapshot.lives = player.lives;
  }
  if(hudSnapshot.hp !== player.hp){
    hpNodes.forEach((node,index)=>{ node.className = index<player.hp ? (player.hp===1?'low':(player.hp===2?'mid':'on')) : ''; });
    $('hpSeg').setAttribute('aria-label', '体力 '+Math.max(0,player.hp)+' / '+player.maxHp);
    hudSnapshot.hp = player.hp;
  }
}

/* ============ 渲染 ============ */
let stars=[];
function makeStars(){
  stars=[];
  const n=Math.min(140,Math.floor(W*H/9000));
  for(let i=0;i<n;i++) stars.push({x:Math.random()*W,y:Math.random()*H,r:rnd(0.5,1.8),tw:rnd(0,6.28)});
}
window.addEventListener('resize', makeStars);
makeStars();

function drawBackground(){
  ctx.fillStyle = 'rgba(6,8,24,0.4)';
  ctx.fillRect(0,0,W,H);
  const now = visualTime;
  for(const s of stars){
    s.y += s.r*0.8*renderDt; if(s.y>H){s.y=0;s.x=Math.random()*W;}
    const a = 0.5+0.5*Math.sin(now*2+s.tw);
    ctx.globalAlpha = a*0.8;
    ctx.fillStyle='#8ea0ff';
    ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,7); ctx.fill();
  }
  ctx.globalAlpha=1;
}

function drawVines(){
  for(const v of vines){
    const dx=v.x2-v.x1, dy=v.y2-v.y1, len=Math.hypot(dx,dy)||1;
    const nx=-dy/len, ny=dx/len;
    const wob = Math.sin(v.wobble + visualTime*3.6)*4;
    const mx=(v.x1+v.x2)/2, my=(v.y1+v.y2)/2;
    const g = ctx.createLinearGradient(v.x1,v.y1,v.x2,v.y2);
    g.addColorStop(0,'#2fd47a');
    g.addColorStop(1,'#0f7a4a');
    // 发光层
    ctx.strokeStyle='rgba(94,242,160,0.35)';
    ctx.lineWidth=14; ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(v.x1+nx*wob, v.y1+ny*wob);
    ctx.lineTo(v.x2+nx*wob, v.y2+ny*wob);
    ctx.stroke();
    // 主体
    ctx.strokeStyle=g;
    ctx.lineWidth=8;
    ctx.beginPath();
    ctx.moveTo(v.x1+nx*wob, v.y1+ny*wob);
    ctx.lineTo(v.x2+nx*wob, v.y2+ny*wob);
    ctx.stroke();
    // 血量
    const pct = v.hp/v.maxHp;
    ctx.fillStyle='rgba(255,255,255,0.75)';
    ctx.font='10px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.textAlign='center';
    ctx.fillText('藤蔓 '+(pct*100).toFixed(0)+'%', mx+nx*wob, my-10);
  }
}

/* 根据 BOSS 状态选择立绘：
   idle(待机) / throw(螺旋·扇形弹幕·直线藤蔓) / charge(蓄力橙色炸弹) / defeat(血量归0) */
function bossSprite(){
  if(!boss) return null;
  if(boss.hp<=0) return BOSS_IMG.defeat;
  if(boss.mode==='pattern' && boss.pat){
    if(boss.pat.type==='charge' && boss.pat.telegraph>0) return BOSS_IMG.charge;
    if(boss.pat.type==='fan'||boss.pat.type==='spiral'||boss.pat.type==='vine') return BOSS_IMG.throw;
  }
  return BOSS_IMG.idle;
}

function drawBoss(){
  if(!boss) return;
  const bx=boss.x, by=boss.y;
  ctx.save();
  if(boss.shake>0){ ctx.translate(rnd(-4,4),rnd(-4,4)); }
  // 蓄力光环（橙色）
  if(boss.chargeAura>0){
    const g2=ctx.createRadialGradient(bx,by,10,bx,by,boss.r*2.3);
    g2.addColorStop(0,'rgba(255,157,60,0.5)');
    g2.addColorStop(1,'rgba(255,157,60,0)');
    ctx.fillStyle=g2; ctx.beginPath(); ctx.arc(bx,by,boss.r*2.3,0,7); ctx.fill();
  }
  const img = bossSprite();
  if(img && img.complete && img.naturalWidth>0){
    const charging = boss.mode==='pattern' && boss.pat && boss.pat.type==='charge' && boss.pat.telegraph>0;
    const pulse = Math.sin(visualTime/0.28)*3;
    const scale = charging ? 1 + (boss.chargeProgress||0)*0.12 : 1;
    const w = boss.r*2.1*scale, h = boss.r*2.1*scale;
    ctx.imageSmoothingEnabled = false;   // 像素风锐利
    ctx.drawImage(img, bx-w/2, by-h/2+pulse, w, h);
    // 受击时短暂高亮
    if(boss.flash>0){
      ctx.globalAlpha=Math.min(0.65, boss.flash*7);
      ctx.globalCompositeOperation='screen';
      ctx.fillStyle='#fff';
      ctx.fillRect(bx-w/2, by-h/2+pulse, w, h);
      ctx.globalCompositeOperation='source-over';
      ctx.globalAlpha=1;
    }
  }
  ctx.restore();
  // 血量百分比标注
  ctx.fillStyle='#ffd166'; ctx.font='bold 13px "Microsoft YaHei", "PingFang SC", sans-serif'; ctx.textAlign='center';
  ctx.fillText('BOSS  '+Math.max(0,Math.round(boss.hp/boss.maxHp*100))+'%', bx, by-boss.r-22);
}

function drawPlayer(){
  if(state!=='playing' && !(state==='victory' && endTimer>0)) return;
  const px=player.x, py=player.y;
  if(player.invincible>0 && Math.floor(visualTime/0.07)%2===0){
    ctx.globalAlpha=0.35;
    ctx.strokeStyle='#5ef2ff'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(px,py,player.r+8+Math.sin(visualTime/0.08)*3,0,7); ctx.stroke();
  }
  const blink = player.invincible>0 ? (Math.floor(visualTime/0.07)%2?1:0.35) : 1;
  ctx.save();
  ctx.globalAlpha*=blink;
  ctx.imageSmoothingEnabled=false;               // 像素风锐利
  if(PLAYER_IMG.complete && PLAYER_IMG.naturalWidth>0){
    const height=50, width=height*(PLAYER_IMG.naturalWidth/PLAYER_IMG.naturalHeight);
    ctx.drawImage(PLAYER_IMG, px-width/2, py-height/2, width, height);
  } else {
    ctx.fillStyle='#7df2ff'; ctx.beginPath(); ctx.arc(px,py,player.r,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha=1;
}

/* 柿子造型弹幕：圆润果体 + 绿色果蒂 + 高光，按飞行方向旋转 */
function drawPersimmon(x,y,r,bodyTop,bodyBottom,angle){
  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(angle);
  ctx.shadowColor = bodyBottom; ctx.shadowBlur = 8;
  const g=ctx.createRadialGradient(-r*0.35,-r*0.35,r*0.15,0,0,r);
  g.addColorStop(0,bodyTop);
  g.addColorStop(1,bodyBottom);
  ctx.fillStyle=g;
  ctx.beginPath(); ctx.arc(0,0,r,0,7); ctx.fill();
  // 顶部果蒂（柿蒂，四瓣）
  ctx.shadowBlur=0;
  ctx.fillStyle='#2f8f3c';
  ctx.strokeStyle='#1d6b2a'; ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(0,-r*0.55);
  for(let i=0;i<4;i++){
    const a = -Math.PI/2 + (i-1.5)*0.75;
    ctx.lineTo(Math.cos(a)*r*0.62, -r*0.55+Math.sin(a)*r*0.5);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // 高光
  ctx.fillStyle='rgba(255,255,255,0.4)';
  ctx.beginPath(); ctx.arc(-r*0.28,-r*0.28,r*0.2,0,7); ctx.fill();
  ctx.restore();
}

/* 小石块造型：不规则灰岩 + 裂纹高光，随射击方向无旋转（上抛小石） */
function drawStone(x,y,r){
  ctx.save();
  ctx.translate(x,y);
  const g=ctx.createLinearGradient(0,-r,0,r);
  g.addColorStop(0,'#cdd6de'); g.addColorStop(1,'#77828e');
  ctx.fillStyle=g;
  ctx.shadowColor='rgba(30,40,52,0.6)'; ctx.shadowBlur=2;
  ctx.beginPath();
  ctx.moveTo(-r*0.9,-r*0.35);
  ctx.lineTo(-r*0.45,-r*0.9); ctx.lineTo(r*0.35,-r*0.85);
  ctx.lineTo(r*0.9,-r*0.25); ctx.lineTo(r*0.6,r*0.7);
  ctx.lineTo(-r*0.05,r*0.9); ctx.lineTo(-r*0.85,r*0.5);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur=0;
  // 裂纹与高光
  ctx.strokeStyle='rgba(255,255,255,0.4)'; ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(-r*0.15,-r*0.6); ctx.lineTo(r*0.15,-r*0.15); ctx.lineTo(-r*0.2,r*0.4);
  ctx.moveTo(r*0.3,-r*0.5); ctx.lineTo(r*0.5,-r*0.1);
  ctx.stroke();
  ctx.restore();
}

function drawBullets(){
  // 玩家子弹 → 小石块
  for(const b of pBullets){
    drawStone(b.x,b.y,b.r+1.5);
  }
  // 敌弹（扇形·螺旋）→ 蓝色柿子
  for(const b of eBullets){
    drawPersimmon(b.x,b.y,b.r+1,'#8fd6ff','#2a6fe0',b.angle);
  }
  ctx.shadowBlur=0;
  // 橙色蓄力炸弹 → 橙色柿子
  for(const b of bombs){
    const a = Math.atan2(b.ty-b.y, b.tx-b.x);
    drawPersimmon(b.x,b.y,b.r+2,'#ffd166','#ff7a1e',a);
  }
  ctx.shadowBlur=0;
}

function drawParticles(){
  for(const p of particles){
    const a = 1 - p.t/p.maxLife;
    if(p.ring){
      ctx.strokeStyle=p.color; ctx.globalAlpha=a;
      ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.size*(1+a*1.6),0,7); ctx.stroke();
    } else {
      ctx.fillStyle=p.color; ctx.globalAlpha=a;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,7); ctx.fill();
    }
  }
  ctx.globalAlpha=1;
}

function render(){
  ctx.clearRect(0,0,W,H);
  drawBackground();
  drawVines();
  drawBoss();
  drawPlayer();
  drawBullets();
  drawParticles();
}

/* ============ 主循环 ============ */
let last = null, accumulator = 0, visualTime = 0, renderDt = 0;
const FIXED_STEP = 1/60;
function loop(now){
  const dt = last === null ? 0 : Math.min(0.1, Math.max(0,(now-last)/1000));
  last = now;
  if(!document.hidden){
    renderDt = paused ? 0 : dt;
    visualTime += renderDt;
    if(!paused){
      accumulator += dt;
      while(accumulator + 1e-9 >= FIXED_STEP){ update(FIXED_STEP); accumulator -= FIXED_STEP; }
    }
    render();
  }
  requestAnimationFrame(loop);
}
initEntities();
setHudVisible(false);
$('pname').value = getSavedName();
const previousBest = bestScore();
if(previousBest) $('startBest').textContent = '本机最佳：' + previousBest + ' 分';
requestAnimationFrame(loop);

/* ============ 按钮 ============ */
$('startBtn').addEventListener('click', ()=>{ initAudio(); startGame(); });
$('againBtn').addEventListener('click', ()=>{ initAudio(); startGame(); });
$('pname').addEventListener('keydown', event=>{
  if(event.key==='Enter' && !event.isComposing){ event.preventDefault(); initAudio(); startGame(); }
});
$('pauseBtn').addEventListener('click', togglePause);
$('resumeBtn').addEventListener('click', ()=>setPaused(false));
$('soundBtn').addEventListener('click', ()=>{
  muted = !muted;
  $('soundBtn').textContent = muted ? '音效：关' : '音效：开';
  $('soundBtn').setAttribute('aria-pressed', String(!muted));
  $('soundBtn').setAttribute('aria-label', muted ? '开启音效' : '关闭音效');
  initAudio();
});
