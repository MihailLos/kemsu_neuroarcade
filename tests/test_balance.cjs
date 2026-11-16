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
    assert.equal(bag.filter(kind=>kind==='good').length,14);
    assert.equal(bag.filter(kind=>kind==='bad').length,5);
    assert.equal(bag.filter(kind=>kind==='wide').length,1);
    assert.notEqual(bag[0],'bad');
    assert.notEqual(bag.at(-1),'bad');
    assert.ok(bag.every((kind,i)=>kind!=='bad'||bag[i-1]!=='bad'));
  }
});

test('после трёх волн интервал сокращается до 0,75 с, обычный поток не ускоряется',async()=>{
  let reference;
  for(const fps of [10,60,120]){
    const app = await round();
    app.run(`
      const slots = [];
      const baseSpawn = spawnNextBlock;
      spawnNextBlock = ()=>{
        slots.push({contact:nextContactAt,flight:nextContactAt-nextSpawnAt});
        baseSpawn();
      };
      spawnObject = ()=>{};
      for(let i=0;i<${fps}*190;i++) advanceGame(1/${fps},800,600);
    `);
    const slots = app.run('slots');
    assert.equal(app.run('state'),'playing');
    assert.equal(slots[0].flight,3);
    assert.ok(slots[100].flight < 3 && slots[100].flight > 1.65);
    assert.ok(Math.abs(slots.at(-1).flight-1.65)<1e-9);
    const region = t=>Math.floor(t/30)*2+(t%30>=20?1:0);
    for(let i=1;i<slots.length;i++){
      const {contact} = slots[i];
      const previous = slots[i-1].contact;
      if(region(contact) === region(previous)){
        const interval = contact>=110 && contact%30>=20 ? .75 : .85;
        assert.ok(Math.abs(contact-previous-interval)<1e-9);
      } else {
        assert.ok(contact-previous<=1.7);
      }
    }
    assert.ok(slots.some(({contact})=>contact>180));
    const schedule = JSON.stringify(slots);
    if(reference) assert.equal(schedule,reference);
    reference = schedule;
  }
});

test('волны расширяют одиночные красные на пять процентов до потолка и оставляют выход на узком поле',async()=>{
  const app = await round();
  app.run('Math.random=()=>.99; boostUntil=10;');
  const base = app.run('redWidth(800,null)');
  for(let wave=0;wave<9;wave++){
    assert.ok(Math.abs(app.run(`redWidth(800,${wave})`)/base-(1+Math.min(wave*.05,.25)))<1e-9);
    assert.ok(app.run(`platformHalfWidth(300)+redWidth(300,${wave})/2+COLLISION_MARGIN`)<300*.45);
  }
});

test('быстрый блок даёт секунду предупреждения и падает в отмеченное место за 0,32 с',async()=>{
  const app = await round();
  app.element('game').clientHeight=600;
  app.run(`
    const spawns = [];
    spawnObject = (kind,flight,lane,placement)=>spawns.push({kind,flight,lane,placement,at:elapsed});
    advanceGame(20,800,600);
    player.x=.3;
    advanceGame(2.6,800,600);
    updateHud();
  `);
  assert.match(app.element('waveNotice').textContent,/Быстрый блок/);
  assert.equal(app.element('strikeZone').classList.contains('hidden'),false);
  assert.equal(app.run('waveStrike.target'),.3);
  assert.equal(app.run('spawns.some(block=>block.flight===.32)'),false);
  const warnAt = app.run('waveStrike.warnAt');
  const dropAt = app.run('waveStrike.dropAt');
  assert.ok(Math.abs(dropAt-warnAt-1)<1e-9);
  app.run('player.x=.8; advanceGame(1,800,600); updateHud();');
  const strike = app.run('spawns.find(block=>block.flight===.32)');
  assert.ok(Math.abs(strike.at-dropAt)<=.05);
  assert.equal(strike.kind,'bad');
  assert.equal(strike.placement.x,240);
  assert.equal(app.element('strikeZone').classList.contains('hidden'),true);
  const waveSingles = app.run('spawns.filter(block=>block.lane!=null).slice(0,3).map(block=>block.lane)');
  assert.equal(new Set(waveSingles).size,3);
});

test('в поздней волне пара оставляет проход для расширенной платформы',async()=>{
  const app = await round();
  app.run('let pairs=0; spawnRedPair=()=>pairs++; spawnObject=()=>{}; advanceGame(110,800,600);');
  assert.equal(app.run('pairs'),0);
  app.run('advanceGame(10,800,600);');
  assert.equal(app.run('pairs'),1);
  const real = await round();
  for(const width of [300,370,800,1240]){
    real.element('game').clientWidth=width;
    real.run('boostUntil=10; objects=[]; spawnRedPair(2,5);');
    const [left,right] = real.run('objects');
    assert.equal(left.speed,right.speed);
    assert.ok(left.x-left.w/2>=0 && right.x+right.w/2<=width);
    const gap = right.x-right.w/2-(left.x+left.w/2);
    assert.ok(gap>real.run(`2*(platformHalfWidth(${width})+COLLISION_MARGIN)`));
  }
});

test('волна сохраняет серию и отложенное золото, при попадании серия сбрасывается',async()=>{
  const app = await round();
  app.run(`
    const spawns = [];
    spawnObject = kind=>spawns.push(kind);
    advanceGame(18.2,800,600);
    updateHud();
  `);
  assert.match(app.element('waveNotice').textContent,/Скоро/);
  app.run("pendingGold=1; streak=4; spawns.length=0; advanceGame(2,800,600); updateHud();");
  assert.match(app.element('waveNotice').textContent,/Уворачивайтесь/);
  assert.equal(app.run('pendingGold'),1);
  assert.equal(app.element('combo').textContent,'4/5');
  assert.ok(app.run("spawns.length>0 && spawns.every(kind=>kind==='bad')"));
  app.run("catchObject({kind:'bad',x:400,y:500}); updateHud();");
  assert.equal(app.element('combo').textContent,'0/5');
  assert.equal(app.run('pendingGold'),1);
  app.run('advanceGame(9.7,800,600); updateHud();');
  assert.equal(app.run('pendingGold'),1,'золото не появляется вверху поля до конца волны');
  app.run('advanceGame(5,800,600); updateHud();');
  assert.equal(app.run('pendingGold'),0);
  assert.ok(app.run("spawns.includes('gold')"));
  assert.equal(app.element('waveNotice').textContent,'');
});

test('обычный красный может появиться в центре; на узком поле есть выход даже с расширением',async()=>{
  const app = await round();
  for(const width of [300,370,1240]){
    app.element('game').clientWidth = width;
    app.run(`
      objects=[];
      Math.random=()=>.5;
      boostUntil=10;
      spawnObject('bad',3);
      spawnObject('bad',3,1);
    `);
    for(const obj of app.run('objects')){
      assert.ok(Math.abs(obj.x-width/2)<1e-9);
      // Камера доводит центр платформы лишь до 5% или 95% ширины.
      assert.ok(app.run(`platformHalfWidth(${width})`)+obj.w/2+8 < width*.45);
    }
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
