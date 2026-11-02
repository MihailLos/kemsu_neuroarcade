// Регрессии клиентской работы с рекордом. Только встроенные модули Node.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function fixture(initial = 100){
  const elements = new Map();
  const intervals = [];
  const events = {};
  const calls = [];
  const model = {best: initial, failPost: false, invalid: false, beforeGet: null};
  function element(id){
    if(!elements.has(id)){
      const classes = new Set(['hidden']);
      elements.set(id, {
        textContent: '', style: {},
        classList: {
          add: name=>classes.add(name), remove: name=>classes.delete(name),
          contains: name=>classes.has(name),
          toggle(name, hidden){ if(hidden) classes.add(name); else classes.delete(name); }
        },
        getContext: ()=>({setTransform(){}}),
        getBoundingClientRect: ()=>({width: 800, height: 600}),
        addEventListener(){}
      });
    }
    return elements.get(id);
  }
  const context = vm.createContext({
    document: {getElementById: element, hidden: false,
      addEventListener: (name, callback)=>{events[name] = callback;}},
    window: {devicePixelRatio: 1, addEventListener: (name, callback)=>{events[name] = callback;}},
    // Любое обращение к старому браузерному рекорду ломает тест.
    localStorage: {getItem(){throw new Error('localStorage не должен читаться');}},
    ResizeObserver: class {observe(){}}, performance: {now: ()=>0},
    requestAnimationFrame(){}, setInterval: fn=>intervals.push(fn),
    setTimeout, clearTimeout, AbortController,
    console: {error(){}, warn(){}}, alert(){},
    fetch: async (url, options)=>{
      calls.push({url, method: options.method || 'GET', body: options.body});
      if(options.method === 'POST'){
        if(model.failPost) return {ok:false, status:500};
        model.best = Math.max(model.best, JSON.parse(options.body).score);
      }
      const value = model.best;
      if(options.method !== 'POST' && model.beforeGet) await model.beforeGet();
      return {ok:true, json: async ()=>({bestScore: model.invalid ? '950' : value})};
    }
  });
  vm.runInContext(source, context);
  vm.runInContext('soundEnd = ()=>{}; soundRecord = ()=>{}; soundStart = ()=>{};', context);
  return {model, calls, intervals, events, element, run: code=>vm.runInContext(code, context)};
}

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
