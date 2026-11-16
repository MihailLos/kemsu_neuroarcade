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
      let seed=42;
      Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
      const baseSpawn = spawnNextBlock;
      spawnNextBlock = ()=>{
        slots.push({contact:nextContactAt,flight:nextContactAt-nextSpawnAt,waveSlot});
        baseSpawn();
      };
      spawnObject = ()=>{};
      for(let i=0;i<${fps}*190;i++) advanceGame(1/${fps},800,600);
    `);
    const slots = app.run('slots');
    assert.equal(app.run('state'),'playing');
    assert.equal(slots[0].flight,3);
    assert.ok(slots[100].flight < 3 && slots[100].flight > 1.45);
    assert.ok(Math.abs(slots.at(-1).flight-1.45)<1e-9);
    const region = t=>Math.floor(t/30)*2+(t%30>=20?1:0);
    for(let i=1;i<slots.length;i++){
      const {contact} = slots[i];
      const previous = slots[i-1].contact;
      if(region(contact) === region(previous)){
        const intervals = contact % 30 < 20 ? [.85,1.15] :
          contact < 110 ? [.85] : [slots[i-1].waveSlot===8 ? 1.2 : .75];
        assert.ok(intervals.some(interval=>Math.abs(contact-previous-interval)<1e-9));
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

test('случайная ширина даёт три размера на большом поле и оставляет выход с расширенной платформой',async()=>{
  const app = await round();
  for(const width of [300,370,800,1240]){
    app.element('game').clientWidth = width;
    app.run(`
      objects=[];
      lastNormalRedWasGiant=false;
      boostUntil=10;
      for(const roll of [.5,.85,.99]){
        let draws=0;
        Math.random=()=>draws++===0 ? roll : .999;
        spawnObject('bad',3,null,{x:canvas.clientWidth/2});
      }
    `);
    const [normal,wide,giant] = app.run('objects');
    assert.ok(normal.w<wide.w);
    if(width >= 800) assert.ok(wide.w<giant.w && giant.w/width>.37 && giant.w/width<=.38);
    else assert.equal(wide.w,giant.w);
    const platform = app.run(`platformHalfWidth(${width})`);
    for(const obj of [normal,wide,giant]){
      const reachable = Math.max(obj.x-width*.05,width*.95-obj.x);
      assert.ok(reachable - (platform+obj.w/2+8) >= 12-1e-9);
    }
  }
});

test('гиганты не идут подряд в обычном потоке, а в каждой волне их не больше одного',async()=>{
  const app = await round();
  app.run(`
    Math.random=()=>.999;
    spawnObject('bad',3);
    spawnObject('good',3);
    spawnObject('bad',3);
    spawnObject('bad',3);
  `);
  assert.deepEqual(Array.from(app.run("objects.filter(o=>o.kind==='bad').map(o=>o.w>200)")),[true,false,true]);
  app.run(`
    objects=[];
    player.x=-10;
    const waves=[];
    const spawn=spawnObject;
    spawnObject=(kind,flight,lane,placement)=>{
      if(kind==='bad' && placement?.inWave){
        spawn(kind,flight,lane,placement);
        waves.push({cycle:Math.floor(nextContactAt/30),width:objects.at(-1).w,diagonal:placement.diagonal});
      }
    };
    advanceGame(90,800,600);
  `);
  const waves = app.run('waves');
  for(let cycle=0;cycle<3;cycle++){
    const blocks=waves.filter(block=>block.cycle===cycle);
    assert.equal(blocks.filter(block=>block.width>200).length,1);
    assert.ok(blocks.some(block=>block.diagonal && block.width<=88));
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
  assert.ok(strike.placement.width>=64 && strike.placement.width<=88);
  assert.equal(app.element('strikeZone').classList.contains('hidden'),true);
  const waveSingles = app.run('spawns.filter(block=>block.lane!=null).slice(0,3).map(block=>block.lane)');
  assert.equal(new Set(waveSingles).size,3);
});

test('в поздней волне два прохода на разных сторонах и оба подходят расширенной платформе',async()=>{
  const app = await round();
  app.run('const pairs=[]; spawnRedPair=(_flight,side)=>pairs.push(side); spawnObject=()=>{}; advanceGame(110,800,600);');
  assert.equal(app.run('pairs.length'),0);
  app.run('advanceGame(10,800,600);');
  assert.equal(app.run('pairs.join()'),'-1,1');
  const real = await round();
  for(const width of [300,370,800,1240]){
    real.element('game').clientWidth=width;
    real.run('boostUntil=10; objects=[]; spawnRedPair(2,-1); spawnRedPair(2,1);');
    const blocks = real.run('objects');
    const gaps = [];
    for(let i=0;i<4;i+=2){
      const [left,right] = [blocks[i],blocks[i+1]];
      assert.equal(left.speed,right.speed);
      assert.ok(Math.abs(left.x-left.w/2-9)<1e-9 && Math.abs(right.x+right.w/2-(width-9))<1e-9);
      const margin = real.run(`platformHalfWidth(${width})+COLLISION_MARGIN`);
      const from = left.x+left.w/2+margin;
      const to = right.x-right.w/2-margin;
      assert.ok(from<to);
      gaps.push({from,to});
    }
    assert.ok(gaps[0].to < gaps[1].from);
  }
});

test('за волну один красный смещается по диагонали; столкновение учитывает его новое положение',async()=>{
  const app = await round();
  app.run(`
    const diagonal = [];
    const spawn = spawnObject;
    spawnObject = (kind,time,lane,options)=>{
      if(options?.diagonal){
        spawn(kind,time,lane,options);
        diagonal.push(objects.at(-1));
      }
    };
    player.x=-10;
    advanceGame(30,800,600);
  `);
  assert.equal(app.run('diagonal.length'),1);
  assert.equal(app.run('diagonal[0].kind'),'bad');
  assert.ok(app.run('Math.abs(diagonal[0].vx)>0 && diagonal[0].x===diagonal[0].endX'));
  app.run(`
    nextSpawnAt=Infinity;
    player.x=.5;
    objects=[{kind:'bad',x:140,endX:400,vx:200,speed:220,y:240,w:76,h:44,rot:0,spin:0,glow:0}];
    advanceGame(1.3,800,600);
  `);
  assert.equal(app.run('lives'),2);
});

test('за красным на той же линии появляется белый, затем обычный поток возвращается',async()=>{
  const app = await round();
  app.run(`
    nextContactAt=8; nextSpawnAt=5.05;
    blockBag=['bad','good','bad','good'];
    const landings=[];
    for(let i=0;i<4;i++){
      landings.push(nextContactAt);
      spawnNextBlock();
    }
  `);
  const blocks = app.run('objects');
  const times = app.run('landings');
  assert.equal(blocks[0].kind,'bad');
  assert.equal(blocks[1].kind,'good');
  assert.equal(blocks[0].x,blocks[1].x);
  assert.ok(Math.abs(times[1]-times[0]-1.15)<1e-9);
  assert.ok(Math.abs(times[3]-times[2]-.85)<1e-9);
});

test('золото отклоняется от маршрута, а следующий белый возвращается ближе к нему',async()=>{
  const app = await round();
  app.run(`
    lastSafeLane=.5; pendingGold=1;
    blockBag=['good','good']; lastSpawnKind='good';
    spawnNextBlock(); spawnNextBlock();
  `);
  const [gold,white] = app.run('objects');
  assert.equal(gold.kind,'gold');
  assert.ok(Math.abs(gold.x-400)>=200);
  assert.equal(white.kind,'good');
  assert.ok(Math.abs(white.x-400)<=96);
});

test('таймер считает зачётное время, останавливается в результате и обнуляется при повторе',async()=>{
  const app = await round();
  app.run('nextSpawnAt=Infinity; advanceGame(125.4,800,600); updateHud();');
  assert.equal(app.element('elapsedTime').textContent,'02:05');
  await app.run('finishGame()');
  assert.equal(app.element('resultTime').textContent,'02:05');
  app.run('advanceGame(10,800,600); updateHud();');
  assert.equal(app.element('elapsedTime').textContent,'02:05');
  app.run('startGame(); updateHud();');
  assert.equal(app.element('elapsedTime').textContent,'00:00');
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
  app.run("blockBag=Array(10).fill('good'); advanceGame(9.7,800,600); updateHud();");
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
