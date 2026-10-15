'use strict';
// Run: node --test tests/boss.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict').ok;
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../public/vine-boss-shooter/game.js'), 'utf8');

function makeCtx(){
  const gradient = {addColorStop(){}};
  return new Proxy({createRadialGradient:()=>gradient,createLinearGradient:()=>gradient}, {
    get(target,key){ return target[key] || (()=>0); },
    set(target,key,value){ target[key]=value; return true; }
  });
}
function events(target){
  target._listeners={};
  target.addEventListener=(type,callback)=>{ (target._listeners[type] ||= []).push(callback); };
  target.dispatch=(type,event={})=>{ for(const callback of target._listeners[type] || []) callback({preventDefault(){},...event}); };
  return target;
}
function makeEl(id){
  const classes = new Set();
  const el=events({id,textContent:'',innerHTML:'',className:'',value:'',style:{},hidden:false,
    children:[],width:800,height:600,complete:true,naturalWidth:64,naturalHeight:64,
    getContext:()=>makeCtx(),focus(){},blur(){},setAttribute(key,value){this[key]=value;},
    getBoundingClientRect:()=>({left:0,top:0,width:800,height:600}),
    setPointerCapture(id){this.captured=id;},hasPointerCapture(id){return this.captured===id;},releasePointerCapture(){this.captured=null;},
    classList:{add(name){classes.add(name);},remove(name){classes.delete(name);},contains(name){return classes.has(name);},toggle(name,force){if(force??!classes.has(name))classes.add(name);else classes.delete(name);}}
  });
  if(id==='livesTxt'||id==='hpSeg') el.children = [makeEl('child1'),makeEl('child2'),makeEl('child3')];
  return el;
}
test('boss game combat, scoring, input, pause, collision and storage regressions', () => {
const els = {}, store = {};
const sandbox = {
  console, setTimeout:()=>0, Math, Date,
  performance:{now:()=>0},requestAnimationFrame:()=>{},
  localStorage:{getItem:key=>store[key]??null,setItem:(key,value)=>{store[key]=String(value);}},
  document:events({hidden:false,getElementById:id=>els[id] ||= makeEl(id)}),
  window:events({innerWidth:800,innerHeight:600,devicePixelRatio:2}),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// 加载游戏脚本
vm.runInContext(code, sandbox);

function step(dt, n){
  for(let i=0;i<n;i++){
    vm.runInContext(`update(${dt}); render();`, sandbox);
  }
}
function getState(){ return vm.runInContext('state', sandbox); }
function expr(e){ return vm.runInContext(e, sandbox); }

// ---- 1. 开始游戏 ----
vm.runInContext(`$('pname').value='测试舰长'; startGame();`, sandbox);
assert(getState()==='playing', 'startGame 后进入 playing');
assert(expr('player.lives')===3, '初始 3 条命');
assert(expr('player.hp')===3, '初始血量 3');
assert(expr('score')===0, '初始得分 0');

// ---- 2. 战斗循环 10 秒，无崩溃，且 BOSS 有在攻击 ----
vm.runInContext('player.invincible=100;', sandbox);
step(0.016, 620);
const eBulletCount = expr('eBullets.length');
const vineCount = expr('vines.length');
const bombCount = expr('bombs.length');
assert(getState()==='playing', '10 秒后仍在进行');
assert(eBulletCount>0 || bombCount>0 || vineCount>0, 'BOSS 已发动攻击(扇形/螺旋/藤蔓/炸弹之一)');

// ---- 3. 受击 & 复活无敌（先复位玩家状态） ----
vm.runInContext(`player.hp=3; player.lives=3; player.invincible=0; damagePlayer(1);`, sandbox);
assert(expr('player.hp')===2, '受击扣 1 血');
vm.runInContext(`player.invincible=0; player.hp=1; damagePlayer(1);`, sandbox);
assert(expr('player.hp')===3 && expr('player.lives')===2, '血量归零扣一条命并复活');
assert(expr('player.invincible')>1.9, '复活后无敌约 2 秒');
vm.runInContext(`damagePlayer(1);`, sandbox);
assert(expr('player.hp')===3, '无敌期间不受伤害');

// ---- 4. 耗尽 3 条命 → 失败 ----
vm.runInContext(`player.invincible=0; player.hp=1; damagePlayer(1); player.invincible=0; player.hp=1; damagePlayer(1); player.invincible=0; player.hp=1; damagePlayer(1);`, sandbox);
assert(getState()==='defeat', '3 条命耗尽判定失败');

// ---- 5. 时限内血量 <20% → 驱离胜利 ----
vm.runInContext(`initEntities(); state='playing'; score=0; elapsed=0; timer=CFG.timeLimit; patIdx=0;`, sandbox);
assert(getState()==='playing', '重新开战');
vm.runInContext(`boss.hp=200; elapsed=CFG.timeLimit-0.01; update(0.02);`, sandbox);
assert(getState()==='victory', '计时结束且 BOSS 血量<20% 判定胜利(驱离)');

// ---- 6. 时限内血量 >=20% → 失败 ----
vm.runInContext(`initEntities(); state='playing'; score=0; elapsed=0; timer=CFG.timeLimit; patIdx=0;`, sandbox);
vm.runInContext(`boss.hp=1000; elapsed=CFG.timeLimit-0.01; update(0.02);`, sandbox);
assert(getState()==='defeat', '计时结束且血量>=20% 判定失败');

// ---- 7. 击杀 BOSS → 胜利 ----
vm.runInContext(`initEntities(); state='playing'; score=0; elapsed=0; timer=CFG.timeLimit; patIdx=0;`, sandbox);
vm.runInContext(`boss.hp=1; hitBoss();`, sandbox);
assert(getState()==='victory', '清空 BOSS 血量判定胜利');

// ---- 8. 排行榜已移除 ----
assert(expr(`typeof saveScore==='undefined' && typeof renderBoard==='undefined'`), '排行榜功能(saveScore/renderBoard)已移除');
assert(expr(`localStorage.getItem('vine_boss_scores')===null`), '不再向本地写入排行榜数据');

// ---- 9. 四种 BOSS 攻击模式都触发 ----
vm.runInContext(`
  initEntities(); state='playing'; score=0; elapsed=0; timer=CFG.timeLimit; patIdx=0;
  player.invincible=100;
  let ebC=0,bmC=0,vnC=0;
  const _eb=eBullets.push, _bm=bombs.push;
  eBullets.push=function(){ebC++; return _eb.apply(this,arguments);};
  bombs.push=function(){bmC++; return _bm.apply(this,arguments);};
  const _sv=spawnVine;
  spawnVine=function(){vnC++; return _sv();};
`, sandbox);
step(0.016, 2200);   // 约 35 秒，覆盖完整 4 模式循环
const pats = expr(`[ebC, bmC, vnC]`);
assert(pats[0]>0, '扇形/螺旋（敌弹）已触发 ('+pats[0]+')');
assert(pats[1]>0, '蓄力橙色炸弹已触发 ('+pats[1]+')');
assert(pats[2]>0, '直线藤蔓已触发 ('+pats[2]+')');

// ---- 10. 新需求验证：射速 / 斜线藤蔓 / BOSS蓄力 / 炸弹落地即爆 ----
assert(Math.abs(expr('CFG.fireInterval')-0.1733)<0.0001, '玩家射速提速 1.5 倍（发射间隔 0.1733s）');

vm.runInContext(`initEntities(); state='playing'; boss.x=400; boss.y=120; spawnVine();`, sandbox);
const v = expr(`vines[0] ? {x1:vines[0].x1,y1:vines[0].y1,x2:vines[0].x2,y2:vines[0].y2} : null`);
if(v){
  const inBounds = v.x1>=0 && v.y1>=0 && v.x2>=0 && v.y2>=0 && v.x1<=800 && v.y1<=600 && v.x2<=800 && v.y2<=600;
  assert(inBounds, '藤蔓两端点都在地图范围内');
  const bossDist = expr(`segDist(400,120,vines[0].x1,vines[0].y1,vines[0].x2,vines[0].y2)`);
  assert(bossDist < 8, '藤蔓经过 BOSS 当前位置 (距离 '+bossDist.toFixed(1)+')');
  const spanX = Math.abs(expr('vines[0].x2')-expr('vines[0].x1'));
  const spanY = Math.abs(expr('vines[0].y2')-expr('vines[0].y1'));
  assert(spanX>1 || spanY>1, '藤蔓为有效斜线段(非退化)');
} else { assert(false, '未能生成藤蔓'); }

vm.runInContext(`initEntities(); boss.mode='pattern'; boss.pat={type:'charge',time:0,dur:2.4,telegraph:1.15,bombFired:false}; updateCharge(boss.pat,0.5);`, sandbox);
const prog = expr('boss.chargeProgress');
assert(prog>0 && expr('boss.chargeAura')===1, '蓄力阶段 BOSS 核心能量累积 (进度 '+prog.toFixed(2)+')');
vm.runInContext(`boss.pat.telegraph=0.01; updateCharge(boss.pat,0.02);`, sandbox);
assert(expr('bombs.length')>=1, '蓄力完成即发射橙色炸弹');

vm.runInContext(`initEntities(); state='playing'; fireBomb(); bombs[0].arrived=true; updateBombs(0.016);`, sandbox);
assert(expr('bombs.length')===0, '炸弹落地即爆炸移除（无玩家侧预警圈）');

// ---- 11. 立绘切换 / 结算延迟 / 柿子弹幕 ----
vm.runInContext(`initEntities(); state='playing'; boss.mode='idle'; boss.pat=null;`, sandbox);
assert(expr(`bossSprite()===BOSS_IMG.idle`), '待机状态用 idle 立绘');
vm.runInContext(`boss.mode='pattern'; boss.pat={type:'fan',time:0,dur:2.5,telegraph:1.15};`, sandbox);
assert(expr(`bossSprite()===BOSS_IMG.throw`), '扇形弹幕用 throw 立绘');
vm.runInContext(`boss.pat={type:'spiral',time:0,dur:3.2,telegraph:1.15};`, sandbox);
assert(expr(`bossSprite()===BOSS_IMG.throw`), '螺旋弹幕用 throw 立绘');
vm.runInContext(`boss.pat={type:'vine',time:0,dur:2.8,telegraph:1.15};`, sandbox);
assert(expr(`bossSprite()===BOSS_IMG.throw`), '直线藤蔓用 throw 立绘');
vm.runInContext(`boss.pat={type:'charge',time:0,dur:2.4,telegraph:0.5};`, sandbox);
assert(expr(`bossSprite()===BOSS_IMG.charge`), '蓄力大招用 charge 立绘');
vm.runInContext(`boss.hp=0; boss.mode='idle'; boss.pat=null;`, sandbox);
assert(expr(`bossSprite()===BOSS_IMG.defeat`), '血量归0用 defeat 立绘');
vm.runInContext(`initEntities(); state='playing'; boss.hp=0; victory('killed');`, sandbox);
assert(expr(`state==='victory' && endTimer>0`), '击杀后进入结算动画倒计时');
assert(expr(`bossSprite()===BOSS_IMG.defeat`), '结算动画期间显示倒地立绘');
vm.runInContext(`update(1.5);`, sandbox);
assert(expr(`state==='victory' && endTimer<=0`), '倒计时结束弹出结算界面');
assert(expr(`typeof drawPersimmon==='function'`), '柿子弹幕绘制函数存在');

// ---- 12. 玩家猎人立绘 + 小石块子弹 ----
assert(expr(`PLAYER_IMG===document.getElementById('imgPlayer')`), '玩家猎人立绘已注册(imgPlayer)');
assert(expr(`typeof drawStone==='function'`), '小石块子弹绘制函数存在');
vm.runInContext(`initEntities(); state='playing'; pBullets.push({x:100,y:200,vy:-560,r:4}); drawBullets();`, sandbox);
assert(expr(`pBullets.length===1`), '小石块子弹渲染无异常');
vm.runInContext(`initEntities(); state='playing'; drawPlayer();`, sandbox);
assert(expr(`typeof drawPlayer==='function'`), '玩家立绘绘制路径可执行');

// ---- 13. 击败胜利加分（剩余时长×5 + 剩余命×15）----
vm.runInContext(`initEntities(); state='playing'; score=0; timer=60; player.lives=2; victory('killed');`, sandbox);
assert(expr(`score === CFG.killBonus + Math.round(timer)*CFG.killTimeBonusPerSec + player.lives*CFG.lifeBonus`), '击败胜利：剩余时长每1秒+5、剩余每条命+15 正确');
vm.runInContext(`initEntities(); state='playing'; score=0; timer=40; victory('drive');`, sandbox);
assert(expr(`score === CFG.driveBonus + Math.round(timer)*CFG.timeBonusPerSec`), '驱离胜利保持原时长加成');


// ---- Regression checks for deployable, touch-friendly build ----
assert(expr('canvas.width===1600 && canvas.height===1200 && W===800 && H===600'), 'DPR canvas keeps game coordinates in CSS pixels');
vm.runInContext(`startGame(); player.invincible=100; keys.KeyW=true; pointerOn=true; pointerId=7;`, sandbox);
sandbox.window.dispatch('blur');
assert(expr(`paused && !pointerOn && Object.keys(keys).length===0`), 'Window blur pauses and clears keyboard / pointer state');
const frozen=expr('elapsed');
vm.runInContext('update(5);', sandbox);
assert(expr('elapsed')===frozen, 'Paused time does not advance');
vm.runInContext('setPaused(false);', sandbox);
sandbox.window.dispatch('keydown',{code:'KeyP',repeat:true});
assert(!expr('paused'), 'Holding pause key does not toggle repeatedly');
sandbox.document.hidden=true;
sandbox.document.dispatch('visibilitychange');
sandbox.document.hidden=false;
sandbox.document.dispatch('visibilitychange');
assert(expr('paused'), 'Returning from background waits for explicit resume');
vm.runInContext('setPaused(false);', sandbox);
sandbox.window.dispatch('keydown',{code:'KeyW',target:{matches:()=>true}});
assert(!expr('keys.KeyW'), 'Typing a nickname does not move the hunter');
els.game.dispatch('pointerdown',{pointerId:1,isPrimary:true,button:0,pointerType:'touch',clientX:200,clientY:300});
assert(expr('pointerOn && pointerId===1'), 'Primary touch captures its pointer');
els.game.dispatch('pointerdown',{pointerId:2,isPrimary:false,button:0,pointerType:'touch',clientX:500,clientY:300});
assert(expr('pointerId===1'), 'A second finger cannot take over movement');
els.game.dispatch('pointercancel',{pointerId:1});
assert(expr('!pointerOn && pointerId===null'), 'Pointer cancel clears movement');
els.game.dispatch('pointerdown',{pointerId:3,isPrimary:true,button:0,pointerType:'mouse',clientX:200,clientY:300});
sandbox.window.dispatch('keydown',{code:'KeyD'});
assert(expr('!pointerOn && keys.KeyD'), 'Keyboard input takes over from pointer movement');

vm.runInContext(`startGame(); boss.x=400; boss.y=100; vines=[{x1:100,y1:300,x2:700,y2:300,hp:90,maxHp:90}]; pBullets=[{x:400,y:320,vy:-560,r:4}]; updatePlayerBullets(0.05);`, sandbox);
assert(expr('vines[0].hp===82 && pBullets.length===0'), 'Fast stone hits a thin vine crossed between frames');
vm.runInContext(`startGame(); boss.x=400; boss.y=100; boss.hp=1; pBullets=[{x:400,y:120,vy:-560,r:4},{x:400,y:125,vy:-560,r:4}]; updatePlayerBullets(0.05);`, sandbox);
assert(expr('stats.shotsHit===1 && stats.dmg===1 && state==="victory"'), 'Killing hit stops same-frame damage and caps actual damage');
const finishedScore=expr('score');
vm.runInContext('hitBoss(); damagePlayer(100);', sandbox);
assert(expr('score')===finishedScore && expr('player.lives')===3, 'Ended round ignores further hits and damage');
vm.runInContext('update(1.5);', sandbox);
assert(Number(els.stScore.textContent)===2, 'Result battle score uses hit points rather than damage amount');

vm.runInContext('startGame(); player.x=200; player.y=300;',sandbox);
sandbox.window.innerWidth=400; sandbox.window.innerHeight=300;
sandbox.window.dispatch('resize');
assert(expr('W===400 && H===300 && player.x===100 && player.y===150 && paused'), 'Resize preserves relative position and pauses for orientation change');
sandbox.window.innerWidth=800; sandbox.window.innerHeight=600;
sandbox.window.dispatch('resize');

sandbox.localStorage.getItem=()=>{throw new Error('Storage blocked');};
sandbox.localStorage.setItem=()=>{throw new Error('Storage blocked');};
vm.runInContext(`$('pname').value=''; startGame();`,sandbox);
assert(expr('state==="playing" && playerName==="宾客"'), 'Storage restrictions and an empty name still allow play');
vm.runInContext(`PLAYER_IMG.complete=false; drawPlayer();`,sandbox);
assert(true, 'Player fallback renders before image is loaded');

// Vines must not permanently trap a hunter, including after resize.
vm.runInContext(`startGame(); boss.x=400; boss.y=130; player.x=700; player.y=400; vines=[{x1:400,y1:130,x2:800,y2:490,hp:90,maxHp:90}]; keys.KeyD=true; movePlayer(1/60);`,sandbox);
assert(expr('player.x>700'), 'A hunter already intersecting a vine can move outward');
vm.runInContext(`startGame(); for(let i=0;i<100;i++){ vines=[]; spawnVine(); if(vines[0] && segDist(player.x,player.y,vines[0].x1,vines[0].y1,vines[0].x2,vines[0].y2)<player.r+14) throw new Error('Vine spawned on hunter'); }`,sandbox);
assert(true, 'Spawned vines leave clearance around the hunter');

// Different display refresh rates must advance the same simulation time.
vm.runInContext('startGame(); player.invincible=100; loop(0); for(let ms=1000/120;ms<=1000+0.01;ms+=1000/120) loop(ms);',sandbox);
const highRefreshElapsed=expr('elapsed');
vm.runInContext('startGame(); player.invincible=100; loop(0); for(let ms=1000/30;ms<=1000+0.01;ms+=1000/30) loop(ms);',sandbox);
assert(Math.abs(expr('elapsed')-highRefreshElapsed)<0.001, '30 Hz and 120 Hz displays advance the same fixed-step simulation');

});
