// Регрессии клиентской работы с рекордом. Только встроенные модули Node.js.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {fixture, source} = require('./helpers/game.cjs');


test('загрузка только читает файл и не переносит браузерный рекорд', async ()=>{
  const app = fixture(100);
  await app.run('loadRecord()');
  assert.deepEqual(app.calls.map(call=>call.method), ['GET']);
  assert.equal(app.element('best').textContent, '0100');
  assert.equal(app.element('resultBest').textContent, 100);
  assert.doesNotMatch(source, /localStorage|digit_lovi_kod_best_v2/);
});

test('правка файла вверх и вниз обновляет оба поля без перезагрузки', async ()=>{
  const app = fixture(950);
  await app.run('loadRecord()');
  app.run("state = 'result'");
  for(const value of [120, 1200, 0]){
    app.model.best = value;
    await app.intervals[0]();
    assert.equal(app.element('best').textContent, String(value).padStart(4, '0'));
    assert.equal(app.element('resultBest').textContent, value);
  }
  assert.ok(app.calls.every(call=>call.method === 'GET'));
});

test('возврат во вкладку сразу перечитывает файл', async ()=>{
  const app = fixture();
  await app.run('loadRecord()');
  app.model.best = 230;
  await app.events.focus();
  assert.equal(app.element('best').textContent, '0230');
  app.model.best = 10;
  await app.events.visibilitychange();
  assert.equal(app.element('resultBest').textContent, 10);
});

test('после ручного снижения старые 950 не записываются обратно', async ()=>{
  const app = fixture(950);
  await app.run('loadRecord()');
  app.model.best = 100;
  await app.run("state = 'playing'; score = 250; finishGame()");
  assert.equal(app.model.best, 250);
  assert.equal(app.element('resultBest').textContent, 250);
  assert.equal(app.element('recordBanner').classList.contains('hidden'), false);
  assert.deepEqual(app.calls.filter(call=>call.method === 'POST').map(call=>JSON.parse(call.body)), [{score:250}]);
});

test('рекорд другого браузера учитывается на экране результатов', async ()=>{
  const app = fixture(100);
  await app.run('loadRecord()');
  app.model.best = 900;
  await app.run("state = 'playing'; score = 250; finishGame()");
  assert.equal(app.model.best, 900);
  assert.equal(app.element('best').textContent, '0900');
  assert.equal(app.element('resultBest').textContent, 900);
  assert.equal(app.element('recordBanner').classList.contains('hidden'), true);
});

test('неудачная запись не показывает несохранённый рекорд', async ()=>{
  const app = fixture(100);
  await app.run('loadRecord()');
  app.model.failPost = true;
  await app.run("state = 'playing'; score = 250; finishGame()");
  assert.equal(app.model.best, 100);
  assert.equal(app.element('best').textContent, '0100');
  assert.equal(app.element('resultBest').textContent, 100);
  assert.equal(app.element('recordBanner').classList.contains('hidden'), true);
  assert.match(app.element('indicator').textContent, /Рекорд не сохранён/);
  assert.equal(app.run('recordSaving'), false);
});

test('запоздалый GET не затирает результат POST; повторный старт ждёт записи', async ()=>{
  const app = fixture(100);
  await app.run('loadRecord()');
  let release;
  app.model.beforeGet = ()=>new Promise(resolve=>{release = resolve;});
  const read = app.run('loadRecord()');
  await new Promise(resolve=>setImmediate(resolve));
  const save = app.run('saveRecord(400)');
  app.run("recordSaving = true; state = 'result'; startGame()");
  assert.equal(app.run('state'), 'result');
  assert.ok(app.calls.every(call=>call.method === 'GET'));
  release();
  await Promise.all([read, save]);
  assert.equal(app.element('resultBest').textContent, 400);
  assert.equal(app.element('best').textContent, '0400');
});

test('ошибочный ответ не превращается в нулевой рекорд; чтение восстанавливается', async ()=>{
  const app = fixture(100);
  await app.run('loadRecord()');
  app.model.invalid = true;
  assert.equal(await app.run('loadRecord()'), null);
  assert.equal(app.element('best').textContent, '0100');
  assert.equal(app.run('recordsReady'), false);
  app.model.invalid = false;
  app.model.best = 120;
  await app.run('loadRecord()');
  assert.equal(app.run('recordsReady'), true);
  assert.equal(app.element('resultBest').textContent, 120);
});

test('полный раунд с продлением сохраняет результат и позволяет начать новый', async ()=>{
  const app = fixture(100);
  await app.run('loadRecord()');
  app.run(`
    let completion;
    const originalFinish = finishGame;
    finishGame = ()=>{completion = originalFinish();};
    startGame();
    spawnPlan = [];
    score = 500;
    bonusSeconds = 20;
    advanceGame(100,800,600);
  `);
  await app.run('completion');
  assert.equal(app.run('elapsed'),80);
  assert.equal(app.run('state'),'result');
  assert.equal(app.model.best,500);
  assert.equal(app.element('finalScore').textContent,500);
  assert.equal(app.element('resultBest').textContent,500);
  assert.equal(app.element('resultOverlay').classList.contains('hidden'),false);
  assert.equal(app.run('recordSaving'),false);
  app.run('startGame()');
  assert.equal(app.run('state'),'playing');
  assert.equal(app.element('timer').textContent,'01:00');
  assert.equal(app.element('resultOverlay').classList.contains('hidden'),true);
});
