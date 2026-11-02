const assert = require('node:assert/strict');
const {test} = require('node:test');
const {fixture} = require('./helpers/game.cjs');
const snapshot = value=>JSON.parse(JSON.stringify(value));
const expected = [
  {good:11,bad:5,gold:1,wide:1,time:1},
  {good:13,bad:5,gold:2,wide:1,time:1},
  {good:15,bad:5,gold:2,wide:1,time:1},
  {good:17,bad:7,gold:1,wide:2,time:1}
];
function counts(entries){
  return entries.reduce((result,{kind})=>{result[kind]++; return result;},
                        {good:0,bad:0,gold:0,wide:0,time:0});
}
function checkPlan(plan){
  let redRun = 0;
  for(let i=0;i<plan.length;i++){
    redRun = plan[i].kind === 'bad' ? redRun+1 : 0;
    assert.ok(redRun <= 2, 'три красных подряд, включая стык этапов');
    if(i) assert.ok(plan[i].at > plan[i-1].at);
  }
  for(let phase=0;phase<4;phase++){
    const entries = plan.filter(item=>item.phase === phase);
    assert.deepEqual(counts(entries),expected[phase]);
    const specials = entries.filter(item=>!['bad','good'].includes(item.kind));
    // Каждый участок этапа содержит ровно один бонус.
    specials.forEach((entry,i)=>{
      const index = entries.indexOf(entry);
      assert.ok(index >= Math.floor(i*entries.length/specials.length));
      assert.ok(index < Math.floor((i+1)*entries.length/specials.length));
    });
  }
  assert.equal(plan.filter(item=>item.kind==='time').length,4);
  assert.ok(plan.filter(item=>item.kind==='time').every(item=>item.catchAt <= 57.5));
  assert.equal(plan.filter(item=>item.phase < 4).length,93);
  for(let start=60;start<80;start+=5){
    const entries = plan.filter(item=>item.catchAt>=start && item.catchAt<start+5);
    assert.deepEqual(counts(entries),{good:4,bad:2,gold:1,wide:0,time:0});
  }
}

test('1000 раундов: одинаковые квоты, распределённые бонусы, не более двух красных', async ()=>{
  const app = fixture();
  await app.run('loadRecord()');
  for(let i=0;i<1000;i++) checkPlan(snapshot(app.run('createSpawnPlan()')));
});

test('ограниченный генератор не зависает при крайних значениях случайности', async ()=>{
  const app = fixture();
  await app.run('loadRecord()');
  for(const value of [0,.999999]){
    app.run(`Math.random = ()=>${value}`);
    checkPlan(snapshot(app.run('createSpawnPlan()')));
  }
});

async function simulation(){
  const app = fixture();
  await app.run('loadRecord()');
  app.run(`
    finishGame = ()=>{state = 'result'; gameOverFlag = true;};
    soundCombo = ()=>{};
    soundCatch = ()=>{};
    soundBad = ()=>{};
    addParticles = ()=>{};
    addFloater = ()=>{};
    startGame();
  `);
  return app;
}

test('без пойманного времени раунд заканчивается на 60 сек при разных FPS', async ()=>{
  for(const fps of [120,60,30,20,10]){
    const app = await simulation();
    app.run('let spawned = []; spawnObject = entry=>spawned.push(entry);');
    app.run(`for(let i=0;i<${fps*81};i++) advanceGame(1/${fps},800,600);`);
    assert.equal(app.run('elapsed'),60);
    assert.equal(app.run('state'),'result');
    assert.equal(app.run('spawned.length'),93);
    assert.ok(app.run('spawned.every(entry=>entry.phase<4)'));
  }
});

test('каждый блок добавляет 5 сек; максимум 80, в продлении нет новых блоков времени', async ()=>{
  for(let caught=1;caught<=4;caught++){
    const app = await simulation();
    app.run(`for(let i=0;i<${caught};i++) catchObject({kind:'time',x:0,y:0});`);
    assert.equal(app.run('bonusSeconds'),caught*5);
    app.run('let spawned = []; spawnObject = entry=>spawned.push(entry); advanceGame(100,800,600);');
    assert.equal(app.run('elapsed'),60+caught*5);
    assert.equal(app.run('spawned.length'),93+caught*7);
    assert.equal(app.run("spawned.filter(entry=>entry.kind==='time').length"),4);
  }
  const app = await simulation();
  app.run("for(let i=0;i<10;i++) catchObject({kind:'time',x:0,y:0});");
  assert.equal(app.run('bonusSeconds'),20);
});

test('время действительно подбирается через столкновение и продлевает текущий раунд', async ()=>{
  const app = await simulation();
  app.run(`
    spawnPlan = [];
    elapsed = 59.9;
    const obj = {kind:'time',x:400,y:player.y*600-30,w:82,h:44,speed:200,rot:0,spin:0,glow:0};
    objects = [obj];
    advanceGame(.1,800,600);
    updateHud();
  `);
  assert.equal(app.run('bonusSeconds'),5);
  assert.equal(app.run('state'),'playing');
  assert.equal(app.run('objects.length'),0);
  assert.equal(app.element('timer').textContent,'00:05');
  app.run('advanceGame(5,800,600)');
  assert.equal(app.run('elapsed'),65);
  assert.equal(app.run('state'),'result');
});

test('пятый полезный блок любого типа даёт бонус, ошибка обнуляет серию', async ()=>{
  for(const kind of ['good','gold','wide','time']){
    const app = await simulation();
    app.run(`streak=4; catchObject({kind:'${kind}',x:0,y:0});`);
    assert.equal(app.run('score'),20+(kind==='good'?10:kind==='gold'?50:0));
    assert.equal(app.run('streak'),5);
    assert.equal(app.run('bestCombo'),5);
    app.run("catchObject({kind:'bad',x:0,y:0});");
    assert.equal(app.run('streak'),0);
    assert.equal(app.run('score'),5+(kind==='good'?10:kind==='gold'?50:0));
  }
});

test('повторная игра сбрасывает дополнительное время и расписание', async ()=>{
  const app = await simulation();
  app.run("catchObject({kind:'time',x:0,y:0}); elapsed=20; spawnIndex=10; backToMenu(); startGame();");
  assert.equal(app.run('bonusSeconds'),0);
  assert.equal(app.run('elapsed'),0);
  assert.equal(app.run('spawnIndex'),0);
  assert.equal(app.run('spawnPlan.length'),121);
  assert.equal(app.element('timer').textContent,'01:00');
});

test('последние блоки каждого доступного этапа успевают долететь', async ()=>{
  const app = await simulation();
  for(const height of [400,600,1200]){
    app.element('game').clientHeight = height;
    app.run('objects=[];');
    for(const entry of snapshot(app.run('spawnPlan'))){
      app.run(`spawnObject(${JSON.stringify(entry)})`);
      const flight = app.run(`(player.y*${height}+50)/objects[objects.length-1].speed`);
      const deadline = entry.phase<4 ? 60 : 60+(entry.phase-3)*5;
      assert.ok(entry.at+flight < deadline);
    }
  }
});

test('нет многосекундных пауз между этапами и внутри продления', async ()=>{
  const app = await simulation();
  for(let attempt=0;attempt<100;attempt++){
    const plan = snapshot(app.run('createSpawnPlan()'));
    for(let i=1;i<plan.length;i++){
      assert.ok(plan[i].at-plan[i-1].at <= 1.1, `пауза перед блоком ${i}`);
      assert.ok(plan[i].catchAt-plan[i-1].catchAt <= .72, `пауза в подлёте перед блоком ${i}`);
    }
    const extras = plan.filter(entry=>entry.phase>=4);
    for(let i=1;i<extras.length;i++){
      assert.ok(Math.abs(extras[i].at-extras[i-1].at-5/7)<1e-9);
    }
    assert.ok(plan.filter(entry=>entry.kind==='time').every(entry=>entry.catchAt<extras[0].at));
  }
});

test('даже последний блок времени открывает продление без залпа просроченных блоков', async ()=>{
  for(let caught=0;caught<=4;caught++){
    const app = await simulation();
    app.run(`
      let appeared = [];
      spawnObject = entry=>appeared.push({phase:entry.phase, at:elapsed});
      advanceGame(57.5,800,600);
    `);
    assert.ok(app.run('appeared.every(entry=>entry.phase<4)'));
    app.run(`
      for(let i=0;i<${caught};i++) catchObject({kind:'time',x:0,y:0});
      advanceGame(30,800,600);
    `);
    const appeared = snapshot(app.run('appeared'));
    assert.equal(appeared.length,93+caught*7);
    for(let i=1;i<appeared.length;i++){
      assert.ok(appeared[i].at-appeared[i-1].at>.45, 'несколько блоков появились залпом');
      assert.ok(appeared[i].at-appeared[i-1].at<=1.15, 'возникла пауза');
    }
    assert.equal(app.run('elapsed'),60+caught*5);
  }
});
