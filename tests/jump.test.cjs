// Regression checks execute the actual game source with a small browser stub.
// Run: node --test tests/jump.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function createGame(blockStorage = false) {
  let now = 0;
  const events = {}, nodes = new Map(), records = [];
  const graphics = new Proxy({}, {get: (_, key) => {
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({addColorStop() {}});
    return () => {};
  }});
  const document = {hidden:false, activeElement:null,
    addEventListener(type, cb) { events['document:' + type] = cb; },
    createElement() { return element(); },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }
  };
  function element() {
    const classes = new Set();
    return {style:{}, value:'', hidden:false, textContent:'', className:'', innerHTML:'', listeners:{},
      classList:{add:v=>classes.add(v), remove:v=>classes.delete(v), toggle(v,on) { if (on) classes.add(v); else classes.delete(v); }, contains:v=>classes.has(v)},
      getContext:()=>graphics, setAttribute() {}, appendChild() {}, setPointerCapture() {},
      addEventListener(type, cb) { this.listeners[type] = cb; },
      focus() { document.activeElement=this; }, blur() { document.activeElement=null; },
      click() { this.listeners.click?.({target:this}); }, closest:()=>null
    };
  }
  const window = {innerWidth:390, innerHeight:844, devicePixelRatio:2,
    addEventListener(type, cb) { events[type]=cb; },
    WeddingGuest:{getName:()=> '小林', setName() {}, getBest:()=>8, recordResult:(...args)=>records.push(args)}
  };
  const context = vm.createContext({window, document,
    performance:{now:()=>now}, requestAnimationFrame() {}, Image:class {},
    localStorage:{getItem() { if (blockStorage) throw Error('blocked'); return null; }, setItem() { if (blockStorage) throw Error('blocked'); }},
    console, Math
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/jump-jump/game.js'), 'utf8'), context);
  return {run:code=>vm.runInContext(code,context), time:value=>{now=value;}, events, document, records};
}

test('jump game input, pause, collision, replay, scoring and storage regressions', () => {
const game = createGame();
const run = game.run;
assert.equal(game.document.getElementById('nameInput').value,'小林');
assert.equal(run('state.best'),8);
run('startGame(); beginCharge(1)');
game.time(600);
run('finishCharge(1)');
assert.equal(run('state.jump.dist'),run('CFG.maxJump / 2'), 'release uses exact elapsed time without waiting for a frame');
run('state.phase="idle"; state.power=1; beginCharge(2)');
assert.equal(run('state.power'),0,'new charge clears stale power');
run('finishCharge(3)');
assert.equal(run('state.phase'),'charge','other pointers cannot release an active charge');
game.time(610);
run('finishCharge(2)');
assert.ok(run('state.jump.dist < 0.03'),'quick tap cannot reuse the previous charge');
run('pauseGame()');
const stoppedAt=run('state.clock');
game.time(20000);
run('loop(20000)');
assert.equal(run('state.clock'),stoppedAt,'pause freezes simulated time');
run('resumeGame(); loop(20030)');
assert.equal(run('state.phase'),'fly','flight resumes instead of jumping to its end');

run('initRun(); beginCharge(1); pauseGame()');
assert.equal(run('state.phase'),'idle','pause cancels a held charge');
assert.equal(run('activeInput'),null);
game.events.keydown({code:'Escape',repeat:true,preventDefault(){}});
assert.equal(run('state.paused'),true,'holding Escape cannot repeatedly toggle pause');
run('resumeGame(); beginCharge(7)');
game.document.getElementById('game').listeners.pointercancel({pointerId:7});
assert.equal(run('state.phase'),'idle','cancelled touch restores input');

run(`initRun(); state.next={x:1.5,z:0,color:0,size:1,dir:[1,0],D:1.5};
state.jump={from:[0,0.4],dir:[1,0],dist:1.5,t0:0}; settle();`);
assert.equal(run('state.score'),1,'a lateral offset is not a center hit');
run(`initRun(); state.next={x:1.5,z:0,color:0,size:1,dir:[1,0],D:1.5};
state.jump={from:[0,0.6],dir:[1,0],dist:1.5,t0:0}; settle();`);
assert.equal(run('state.lives'),2,'landing outside either platform axis misses');
assert.equal(run('state.phase'),'fall');
run('pauseGame(); loop(20050)');
assert.equal(run('state.fallRemaining'),0.65,'fall recovery does not continue behind pause');
run('resumeGame(); update(0.65)');
assert.equal(run('state.phase'),'idle','fall recovers through the game clock');
run('camX=20; camZ=30; initRun()');
assert.equal(run('camX+camZ'),0,'replay resets the camera');

run('initRun()');
for (let i=0; i<50; i++) run(`state.next={x:state.current.x+1.5,z:state.current.z,color:0,size:${i===49?2:1},dir:[1,0],D:1.5};
state.jump={from:[state.current.x,state.current.z],dir:[1,0],dist:1.5,t0:state.clock}; settle();`);
assert.equal(run('state.scene'),'result');
assert.equal(run('state.platforms'),50);
assert.equal(run('state.score'),1375,'50 center jumps and win bonus');
assert.equal(game.records.length,1,'result recorded once');
run('finishGame(true)');
assert.equal(game.records.length,1,'repeated finish cannot duplicate score or records');
assert.equal(game.records[0][0],'jump');
run('show("home")');
game.document.getElementById('nameInput').listeners.keydown({key:'Enter',isComposing:true,repeat:false,preventDefault(){}});
assert.equal(run('state.scene'),'home','confirming a Chinese IME candidate does not start the game');
game.document.getElementById('nameInput').listeners.keydown({key:'Enter',isComposing:false,repeat:false,preventDefault(){}});
assert.equal(run('state.scene'),'play','Enter starts after composition ends');

const blocked = createGame(true);
blocked.run('startGame(); state.lives=1; missLand(); update(0.65)');
assert.equal(blocked.run('state.scene'),'result','storage blocking does not stop play or results');
});
