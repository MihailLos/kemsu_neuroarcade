const assert = require('node:assert/strict');
const {test} = require('node:test');
const {fixture} = require('./helpers/game.cjs');
async function game(mode='mouse'){
  const app = fixture(100);
  await app.run('loadRecord()');
  app.run(`currentMode='${mode}'; beginSession();`);
  return app;
}
function until(app, condition){
  app.run(`
    for(let attempt=0;attempt<2000 && !(${condition});attempt++) advanceTutorial(.05,800,600);
    if(!(${condition})) throw new Error('Шаг обучения не достигнут');
  `);
}

test('включённое обучение начинается с управления мышью без блоков на пять секунд', async ()=>{
  const app = await game();
  assert.equal(app.run('state'),'training');
  assert.match(app.element('tutorialText').textContent,/мышью/);
  assert.equal(app.element('scoreLabel').textContent,'Учебный счёт');
  assert.equal(app.run('spawnPlan.length'),0);
  app.run('advanceTutorial(4.9,800,600)');
  assert.equal(app.run('objects.length'),0);
  app.run('advanceTutorial(.1,800,600)');
  assert.equal(app.run('objects.length'),1);
  assert.equal(app.run('objects[0].kind'),'good');
  assert.equal(app.element('timer').textContent,'01:00');
});

test('обе кнопки управления учитывают настройку; при отключении сразу идёт зачёт', async ()=>{
  const mouse = await game();
  mouse.run('backToMenu(); trainingEnabledEl.checked=false; ensureAudio=()=>{}; startMouseMode();');
  assert.equal(mouse.run('state'),'playing');
  assert.equal(mouse.run('spawnPlan.length'),121);
  const camera = await game();
  camera.run('backToMenu(); ensureAudio=()=>{}; initHandTracking=async()=>{}; videoStream={};');
  await camera.run('startCameraMode()');
  assert.equal(camera.run('state'),'training');
  assert.match(camera.element('tutorialText').textContent,/ладонью/);
});

test('пропущенный блок повторяется, а следующий не выдаётся без поимки', async ()=>{
  const app = await game();
  app.run('player.x=-10; advanceTutorial(20,800,600);');
  assert.equal(app.run('tutorial.step'),'good');
  assert.equal(app.run('objects.length'),1);
  assert.equal(app.run('objects[0].kind'),'good');
  assert.equal(app.run('score'),0);
  app.run('player.x=.5;');
  until(app,"tutorial.step === 'gold'");
  assert.equal(app.run('score'),10);
  assert.equal(app.run('objects.length'),1);
});

test('пять типов идут по очереди; учебные эффекты настоящие, но не сохраняются', async ()=>{
  const app = await game();
  until(app,"tutorial.step === 'gold'");
  assert.equal(app.run('score'),10);
  until(app,"tutorial.step === 'wide'");
  assert.equal(app.run('score'),60);
  until(app,"tutorial.step === 'time'");
  assert.ok(app.run('boostUntil > elapsed'));
  until(app,"tutorial.step === 'bad'");
  assert.equal(app.run('bonusSeconds'),5);
  assert.equal(app.element('timer').textContent,'01:05');
  until(app,"tutorial.step === 'hearts'");
  assert.equal(app.run('lives'),2);
  assert.equal(app.run('score'),45);
  assert.equal(app.element('heart1').classList.contains('is-pulsing'),true);
  assert.equal(app.run('badCaught'),1);
  assert.equal(app.run('objects.length'),0);
  app.run('advanceTutorial(20,800,600)');
  assert.equal(app.run('tutorial.step'),'hearts');
  assert.equal(app.element('heart1').classList.contains('is-pulsing'),false);
  await app.run('finishGame()');
  assert.equal(app.run('state'),'training');
  assert.ok(app.calls.every(call=>call.method==='GET'));
  assert.equal(app.model.best,100);
});

test('подсказки завершаются по Далее; отсчёт 3–2–1 полностью очищает учебное состояние', async ()=>{
  const app = await game();
  until(app,"tutorial.step === 'hearts'");
  app.run('nextTutorial()');
  assert.equal(app.run('tutorial.step'),'hud');
  assert.match(app.element('tutorialText').textContent,/Счёт.*\nВремя.*\nРекорд/);
  app.run('nextTutorial()');
  assert.equal(app.run('state'),'countdown');
  assert.equal(app.element('tutorialCountdown').textContent,'3');
  assert.equal(app.run('score'),45);
  app.run('advanceTutorial(1,800,600)');
  assert.equal(app.element('tutorialCountdown').textContent,'2');
  app.run('advanceTutorial(1,800,600)');
  assert.equal(app.element('tutorialCountdown').textContent,'1');
  app.run('advanceTutorial(1,800,600)');
  assert.equal(app.run('state'),'playing');
  assert.equal(app.run('tutorial'),null);
  for(const name of ['score','elapsed','bonusSeconds','heartShieldUntil','boostUntil','goodCaught','badCaught','streak']){
    assert.equal(app.run(name),0,name);
  }
  assert.equal(app.run('lives'),3);
  assert.equal(app.element('timer').textContent,'01:00');
  assert.equal(app.element('scoreLabel').textContent,'Счёт');
  assert.equal(app.run('spawnIndex'),0);
  assert.equal(app.run('spawnPlan.length'),121);
  assert.ok(app.calls.every(call=>call.method==='GET'));
});

test('пропуск доступен на каждом шаге и всегда ведёт через отсчёт', async ()=>{
  for(const step of ['move','good','gold','wide','time','bad','hearts','hud']){
    const app = await game();
    app.run(`showTutorialStep('${step}'); startCountdown();`);
    assert.equal(app.run('state'),'countdown');
    assert.equal(app.run('objects.length'),0);
    app.run('advanceTutorial(3,800,600)');
    assert.equal(app.run('state'),'playing');
    assert.equal(app.run('lives'),3);
    assert.equal(app.run('score'),0);
  }
});

test('сброс отменяет обучение и отсчёт; скрытая вкладка не проходит шаги сама', async ()=>{
  const app = await game();
  app.run('document.hidden=true; advanceTutorial(10,800,600);');
  assert.equal(app.run('tutorial.step'),'move');
  app.run('document.hidden=false; startCountdown(); fullReset(); advanceTutorial(10,800,600);');
  assert.equal(app.run('state'),'menu');
  assert.equal(app.run('tutorial'),null);
  assert.equal(app.element('tutorialLayer').classList.contains('hidden'),true);
  app.run('beginSession()');
  assert.equal(app.run('tutorial.step'),'move');
});

test('обучение не начисляет бонус за пятёрку и не заканчивается потерей учебных жизней', async ()=>{
  const app = await game();
  app.run("for(let i=0;i<5;i++) catchObject({kind:'good',x:0,y:0});");
  assert.equal(app.run('score'),50);
  app.run("for(const time of [10,12,14]){elapsed=time; catchObject({kind:'bad',x:0,y:0});}");
  assert.equal(app.run('lives'),0);
  assert.equal(app.run('state'),'training');
  assert.ok(app.calls.every(call=>call.method==='GET'));
});

test('конец отсчёта ждёт восстановления сервера и не запускает раунд с незагруженным рекордом', async ()=>{
  const app = await game();
  app.run('startCountdown(); recordsReady=false; advanceTutorial(4,800,600);');
  assert.equal(app.run('state'),'countdown');
  assert.equal(app.element('tutorialCountdown').textContent,'…');
  await app.run('loadRecord()');
  app.run('advanceTutorial(.05,800,600)');
  assert.equal(app.run('state'),'playing');
});
