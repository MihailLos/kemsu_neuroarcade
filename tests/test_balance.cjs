const assert = require('node:assert/strict');
const {test} = require('node:test');
const {fixture} = require('./helpers/game.cjs');

async function round(){
  const app = fixture();
  await app.run('loadRecord()');
  app.run('startGame()');
  return app;
}

test('мешки сохраняют состав, красные не идут подряд даже на стыках',()=>{
  const app = fixture();
  for(let i=0;i<200;i++){
    const bag = app.run('createBlockBag()');
    assert.equal(bag.length,20);
    assert.equal(bag.filter(kind=>kind==='good').length,15);
    assert.equal(bag.filter(kind=>kind==='bad').length,4);
    assert.equal(bag.filter(kind=>kind==='wide').length,1);
    assert.notEqual(bag[0],'bad');
    assert.notEqual(bag.at(-1),'bad');
    assert.ok(bag.every((kind,i)=>kind!=='bad'||bag[i-1]!=='bad'));
  }
});

test('поток сохраняет частоту и идёт дольше трёх минут, ускорение имеет предел',async()=>{
  for(const fps of [10,60,120]){
    const app = await round();
    app.run(`
      const spawns = [];
      spawnObject = (kind,flight)=>spawns.push({kind,flight,at:elapsed});
      for(let i=0;i<${fps}*190;i++) advanceGame(1/${fps},800,600);
    `);
    const spawns = app.run('spawns');
    assert.equal(app.run('state'),'playing');
    assert.equal(spawns.length,224);
    assert.equal(spawns[0].flight,3);
    assert.ok(spawns[100].flight < 3 && spawns[100].flight > 1.65);
    assert.equal(spawns.at(-1).flight,1.65);
    assert.ok(spawns.every((block,i)=>i===0||Math.abs(block.at-spawns[i-1].at-.85)<=.051));
    assert.ok(spawns.every(({kind})=>['good','bad','wide'].includes(kind)));
  }
});

test('только пять белых дают золото; награда занимает отдельный безопасный слот',async()=>{
  const app = await round();
  app.run("const catchKind = kind=>catchObject({kind,x:100,y:200}); for(let i=0;i<4;i++) catchKind('good'); catchKind('wide'); updateHud();");
  assert.equal(app.element('combo').textContent,'4/5');
  assert.equal(app.run('pendingGold'),0);
  app.run("catchKind('good'); updateHud();");
  assert.equal(app.run('score'),50);
  assert.equal(app.element('combo').textContent,'0/5');
  app.run("blockBag=['bad','good','good']; spawnNextBlock(); spawnNextBlock(); spawnNextBlock();");
  assert.equal(app.run('objects.map(o=>o.kind).join()'),'bad,good,gold');
  assert.equal(app.run('blockBag.join()'),'good');
  assert.equal(app.run('pendingGold'),0);
  app.run("catchKind('good'); catchKind('gold'); updateHud();");
  assert.equal(app.run('score'),110);
  assert.equal(app.element('combo').textContent,'1/5');
  assert.equal(app.run('bestCombo'),6);
});

test('белый обнуляет серию сразу после прохода платформы и только один раз',async()=>{
  const app = await round();
  app.run(`
    nextSpawnAt=Infinity;
    for(let i=0;i<4;i++) catchObject({kind:'good',x:400,y:0});
    objects=[{kind:'good',x:40,y:530,w:64,h:44,speed:220,rot:0,spin:0,glow:0}];
    advanceGame(.05,800,600);
    updateHud();
  `);
  assert.equal(app.element('combo').textContent,'4/5');
  app.run('advanceGame(.1,800,600); updateHud();');
  assert.equal(app.element('combo').textContent,'0/5');
  app.run("catchObject({kind:'good',x:400,y:0}); advanceGame(.1,800,600); updateHud();");
  assert.equal(app.element('combo').textContent,'1/5');
  assert.equal(app.run('pendingGold'),0);
});

test('новая игра очищает серию, отложенное золото и поток',async()=>{
  const app = await round();
  app.run("advanceGame(3,800,600); pendingGold=1; streak=4; backToMenu(); startGame();");
  assert.equal(app.element('combo').textContent,'0/5');
  assert.equal(app.run('pendingGold'),0);
  assert.equal(app.run('blockBag.length'),0);
  assert.equal(app.run('nextSpawnAt'),0);
  assert.equal(app.run('elapsed'),0);
});
