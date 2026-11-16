const assert = require('node:assert/strict');
const {test} = require('node:test');
const {fixture} = require('./helpers/game.cjs');

async function round(){
  const app = fixture();
  await app.run('loadRecord()');
  app.run("startGame(); const block = kind=>({kind,x:400,y:400});");
  return app;
}

test('кривая ускорения проходит через согласованные отметки и не ускоряет уже летящий блок',async()=>{
  const app = await round();
  for(const [time,flight] of [[0,3],[15,2.875],[30,2.75],[60,2.25],[90,1.75],[120,1.45],[190,1.45]]){
    assert.ok(Math.abs(app.run(`flightSecondsAt(${time})`)-flight)<1e-9);
  }
  app.run("spawnObject('good',3); let initialSpeed=objects[0].speed; elapsed=90; spawnNextBlock();");
  assert.equal(app.run('objects[0].speed'),app.run('initialSpeed'));
});

test('в обычном потоке один сюрприз в минуту, красные в мешке не сбиваются в серию',async()=>{
  const app = await round();
  for(let i=0;i<20;i++){
    app.run(`
      startGame();
      var contacts=[];
      spawnObject=(kind,time)=>contacts.push({kind,at:nextContactAt});
      advanceGame(170,800,600);
    `);
    const contacts = app.run('contacts');
    const surprise = contacts.filter(({kind})=>kind==='surprise');
    assert.equal(surprise.length,3);
    for(const [i,{at}] of surprise.entries()){
      assert.ok(at>=40+i*60 && at<42+i*60);
    }
    for(let j=1;j<contacts.length;j++){
      const {kind,at} = contacts[j];
      const previous = contacts[j-1];
      if(at%30<20 && previous.at%30<20){
        assert.ok(kind!=='bad'||previous.kind!=='bad');
      }
    }
  }
});

test('восемь исходов выбираются при поимке: очки, расширение и изменённая цена кода',async()=>{
  const app = await round();
  for(const [i,kind] of ['points','double','insurance','wide','penalty','cheap','reverse','fast'].entries()){
    app.run(`startGame(); Math.random=()=>${(i+.5)/8}; catchObject(block('surprise'));`);
    assert.equal(app.run('streak'),0);
    assert.equal(app.run('activeSurprise()?.kind ?? null'),['points','penalty'].includes(kind)?null:kind);
  }
  app.run("score=7; revealSurprise(block('surprise'),'penalty');");
  assert.equal(app.run('score'),0);
  app.run("revealSurprise(block('surprise'),'points');");
  assert.equal(app.run('score'),20);
  app.run("revealSurprise(block('surprise'),'wide'); elapsed=3; catchObject(block('wide'));");
  assert.equal(app.run('boostUntil'),13);
  assert.equal(app.run('activeSurprise().until'),13);
  for(const [kind,value] of [['double',20],['cheap',5]]){
    app.run(`startGame(); revealSurprise(block('surprise'),'${kind}'); catchObject(block('gold')); catchObject(block('good'));`);
    assert.equal(app.run('score'),50+value);
    assert.equal(app.run('activeSurprise().charges'),1);
    app.run("catchObject(block('good')); catchObject(block('good'));");
    assert.equal(app.run('score'),60+value*2);
    assert.equal(app.run('streak'),3);
    assert.equal(app.run('activeSurprise()'),null);
  }
  app.run("startGame(); revealSurprise(block('surprise'),'double'); elapsed=8; catchObject(block('good'));");
  assert.equal(app.run('score'),10);
});

test('страховка тратится только на потерю сердца, сохраняя штраф и сброс серии',async()=>{
  const app = await round();
  app.run(`
    score=100; streak=4; heartShieldUntil=2;
    revealSurprise(block('surprise'),'insurance');
    catchObject(block('bad'));
  `);
  assert.equal(app.run('score'),85);
  assert.equal(app.run('streak'),0);
  assert.equal(app.run('activeSurprise().charges'),1);
  app.run("elapsed=2; catchObject(block('bad'));");
  assert.equal(app.run('lives'),3);
  assert.equal(app.run('score'),70);
  assert.equal(app.run('activeSurprise()'),null);
  app.run("elapsed=3; catchObject(block('bad'));");
  assert.equal(app.run('lives'),2);
});

test('инверсия переворачивает текущий ввод и не отменяет остановку при потере ладони',async()=>{
  const app = await round();
  app.run("setPlatformInput(.25); revealSurprise(block('surprise'),'reverse');");
  assert.equal(app.run('player.targetX'),.75);
  app.run('elapsed=8; updatePlatformTarget();');
  assert.equal(app.run('player.targetX'),.25);
  app.run("revealSurprise(block('surprise'),'reverse'); player.x=.4; resetHandTracking(); elapsed=16; updatePlatformTarget();");
  assert.equal(app.run('player.targetX'),.4);
});

test('штраф ускоряет только появляющиеся новые блоки без смещения подлёта и без влияния на волну',async()=>{
  const app = await round();
  app.run(`
    elapsed=40; revealSurprise(block('surprise'),'fast');
    nextContactAt=45; nextSpawnAt=42.5;
    const launches=[];
    spawnObject=(kind,flight)=>launches.push({kind,flight,when:spawnTimeForSlot()});
    spawnNextBlock();
  `);
  const [{when,flight}] = app.run('launches');
  assert.ok(Math.abs(flight-2.5/1.2)<1e-9);
  assert.ok(Math.abs(when+flight-45)<1e-9);
  assert.equal(app.run('nextContactAt'),45.85);
  app.run('nextSpawnAt=45.9; nextContactAt=48; elapsed=46;');
  assert.ok(app.run('spawnTimeForSlot()>46'),'запланированный блок не должен рвануть раньше при окончании эффекта');
  app.run("elapsed=48; revealSurprise(block('surprise'),'fast'); nextContactAt=51; nextSpawnAt=49;");
  assert.equal(app.run('spawnTimeForSlot()'),49);
});
