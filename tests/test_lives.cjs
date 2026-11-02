const assert = require('node:assert/strict');
const {test} = require('node:test');
const {fixture} = require('./helpers/game.cjs');

async function game(){
  const app = fixture(100);
  await app.run('loadRecord()');
  app.run(`
    let finishCount = 0;
    let completion;
    const originalFinish = finishGame;
    finishGame = ()=>{finishCount++; completion = originalFinish();};
    startGame();
    spawnPlan = [];
    score = 600;
  `);
  return app;
}

test('новый раунд начинается с трёх сердец без защиты', async ()=>{
  const app = await game();
  assert.equal(app.run('lives'),3);
  assert.equal(app.element('lives').getAttribute('aria-label'),'Жизни: 3 из 3');
  for(let i=0;i<3;i++){
    assert.equal(app.element('heart'+i).classList.contains('is-empty'),false);
    assert.equal(app.element('heart'+i).classList.contains('is-pulsing'),false);
  }
});

test('красный снимает 15 очков, сердце и серию; следующее сердце пульсирует', async ()=>{
  const app = await game();
  app.run("elapsed=10; streak=12; catchObject({kind:'bad',x:0,y:0}); updateHud();");
  assert.equal(app.run('score'),585);
  assert.equal(app.run('streak'),0);
  assert.equal(app.run('badCaught'),1);
  assert.equal(app.run('lives'),2);
  assert.equal(app.run('heartShieldUntil'),12);
  assert.equal(app.element('heart2').classList.contains('is-empty'),true);
  assert.equal(app.element('heart2').classList.contains('just-lost'),true);
  assert.equal(app.element('heart1').classList.contains('is-pulsing'),true);
  assert.equal(app.element('heart0').classList.contains('is-pulsing'),false);
  assert.equal(app.element('heart2').classList.contains('is-pulsing'),false);
});

test('защита сохраняет сердце, но не очки и серию; повторные удары не продлевают её', async ()=>{
  const app = await game();
  app.run("elapsed=10; catchObject({kind:'bad',x:0,y:0}); elapsed=11.9; streak=4; catchObject({kind:'bad',x:0,y:0});");
  assert.equal(app.run('lives'),2);
  assert.equal(app.run('score'),570);
  assert.equal(app.run('streak'),0);
  assert.equal(app.run('badCaught'),2);
  assert.equal(app.run('heartShieldUntil'),12);
  app.run('elapsed=12; updateHud();');
  assert.equal(app.element('heart1').classList.contains('is-pulsing'),false);
  app.run("catchObject({kind:'bad',x:0,y:0});");
  assert.equal(app.run('lives'),1);
  assert.equal(app.run('heartShieldUntil'),14);
});

test('два красных в одном физическом шаге снимают только одно сердце', async ()=>{
  const app = await game();
  app.run(`
    objects = Array.from({length:2},()=>({kind:'bad',x:400,y:500,w:80,h:44,speed:200,rot:0,spin:0,glow:0}));
    advanceGame(.05,800,600);
  `);
  assert.equal(app.run('lives'),2);
  assert.equal(app.run('score'),570);
  assert.equal(app.run('badCaught'),2);
  assert.equal(app.run('objects.length'),0);
  assert.equal(app.run('state'),'playing');
});

test('третья потеря жизни завершает раунд и сохраняет новый рекорд', async ()=>{
  const app = await game();
  app.run("for(const time of [0,2,4]){elapsed=time; catchObject({kind:'bad',x:0,y:0});}");
  await app.run('completion');
  assert.equal(app.run('lives'),0);
  assert.equal(app.run('elapsed'),4);
  assert.equal(app.run('state'),'result');
  assert.equal(app.run('finishCount'),1);
  assert.equal(app.element('resultReason').textContent,'Жизни закончились');
  assert.equal(app.model.best,555);
  assert.equal(app.element('finalScore').textContent,555);
  assert.equal(app.element('resultBest').textContent,555);
  assert.equal(app.element('recordBanner').classList.contains('hidden'),false);
  assert.equal(app.element('heart0').classList.contains('is-pulsing'),false);
  app.run("catchObject({kind:'gold',x:0,y:0}); advanceGame(10,800,600);");
  assert.equal(app.run('score'),555);
  assert.equal(app.run('finishCount'),1);
});

test('после смертельного столкновения другие блоки того же кадра не начисляют очки', async ()=>{
  const app = await game();
  app.run(`
    lives=1;
    elapsed=59.95;
    objects = ['gold','bad'].map(kind=>({kind,x:400,y:500,w:80,h:44,speed:200,rot:0,spin:0,glow:0}));
    advanceGame(.1,800,600);
  `);
  await app.run('completion');
  assert.equal(app.run('finishCount'),1);
  assert.equal(app.run('score'),585);
  assert.equal(app.run('goodCaught'),0);
  assert.equal(app.model.best,585);
  assert.equal(app.element('finalScore').textContent,585);
  assert.equal(app.element('resultReason').textContent,'Жизни закончились');
});

test('меню, сброс и повторный запуск восстанавливают сердца и убирают анимации', async ()=>{
  const app = await game();
  app.run("catchObject({kind:'bad',x:0,y:0}); backToMenu();");
  assert.equal(app.run('lives'),3);
  assert.equal(app.run('heartShieldUntil'),0);
  app.run("startGame(); catchObject({kind:'bad',x:0,y:0}); fullReset(); startGame();");
  assert.equal(app.run('lives'),3);
  for(let i=0;i<3;i++){
    const classes = app.element('heart'+i).classList;
    assert.equal(classes.contains('is-empty'),false);
    assert.equal(classes.contains('just-lost'),false);
    assert.equal(classes.contains('is-pulsing'),false);
  }
});
