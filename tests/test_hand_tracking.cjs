const assert = require('node:assert/strict');
const {test} = require('node:test');
const {fixture} = require('./helpers/game.cjs');

function tracking(){
  const app = fixture();
  app.run(`currentMode='camera'; state='playing';
    cameraEl.readyState=2; cameraEl.currentTime=0;
    cameraEl.videoWidth=640; cameraEl.videoHeight=480;
    cameraEl.clientWidth=126; cameraEl.clientHeight=82;
    handLandmarker={detectForVideo:()=>({landmarks:[Array.from({length:21},()=>({x:.5,y:.5}))]})};`);
  return app;
}

test('одиночное измерение не двигает платформу; три стабильных дают управление',()=>{
  const app = tracking();
  app.run('player.x=.5; player.targetX=.9; acceptHand({x:.8,y:.5});');
  assert.equal(app.run('player.targetX'),.5);
  assert.equal(app.element('handMarker').classList.contains('is-pending'),true);
  app.run('acceptHand({x:.8,y:.5});');
  assert.equal(app.run('handTrack.x'),null);
  app.run('acceptHand({x:.8,y:.5});');
  assert.ok(Math.abs(app.run('player.targetX')-.2)<1e-9);
  assert.equal(app.element('handMarker').classList.contains('is-pending'),false);
});

test('потеря руки отменяет старую цель; возврат требует нового подтверждения',()=>{
  const app = tracking();
  app.run('for(let i=0;i<3;i++) acceptHand({x:.8,y:.5}); player.x=.4; acceptHand(null);');
  assert.equal(app.run('player.targetX'),.4);
  assert.equal(app.element('handMarker').classList.contains('hidden'),true);
  app.run('acceptHand({x:.8,y:.5});');
  assert.equal(app.run('player.targetX'),.4);
  assert.equal(app.run('handTrack.x'),null);
});

test('скачок к краю подтверждается повторно, единичный выброс отбрасывается',()=>{
  const app = tracking();
  app.run('for(let i=0;i<3;i++) acceptHand({x:.5,y:.5}); acceptHand({x:.95,y:.5});');
  assert.equal(app.run('player.targetX'),.5);
  app.run('acceptHand({x:.51,y:.5});');
  assert.equal(app.run('player.targetX'),.49);
  app.run('acceptHand({x:.95,y:.5}); acceptHand({x:.94,y:.5});');
  assert.ok(Math.abs(app.run('player.targetX')-.06)<1e-9);
});

test('неполные и нечисловые точки не попадают в управление',()=>{
  const app = tracking();
  for(const input of ['undefined','[]','[{x:NaN,y:.5}]','Array.from({length:21},()=>({x:2,y:.5}))']){
    assert.equal(app.run(`palmCenter(${input})`),null);
  }
  assert.equal(app.run('palmCenter(Array.from({length:21},()=>({x:.4,y:.6}))).x'),.4);
});

test('повтор кадра не обрабатывается; остановка камеры замораживает платформу',()=>{
  const app = tracking();
  app.run('let detections=0; handLandmarker.detectForVideo=()=>{detections++; return {landmarks:[]}}; detectHand(70); detectHand(140);');
  assert.equal(app.run('detections'),1);
  app.run('player.x=.4; player.targetX=.9; detectHand(700);');
  assert.equal(app.run('player.targetX'),.4);
  assert.match(app.element('indicator').textContent,/Нет новых кадров/);
  app.run('cameraEl.currentTime=1; detectHand(770);');
  assert.equal(app.run('detections'),2);
});

test('ошибка распознавания видна игроку, а меню не запускает распознавание',()=>{
  const app = tracking();
  app.run('handLandmarker.detectForVideo=()=>{throw new Error("test")}; player.x=.3; player.targetX=.9; detectHand(70);');
  assert.equal(app.run('player.targetX'),.3);
  assert.match(app.element('indicator').textContent,/Ошибка распознавания/);
  app.run('state="menu"; cameraEl.currentTime=1; detectHand(140);');
  assert.equal(app.run('lastVideoTime'),0);
});

test('отключённое обучение тоже ждёт ладонь; подготовка не тратит время и не пишет рекорд',async()=>{
  const app = tracking();
  await app.run('loadRecord()');
  app.run('state="camera-ready"; trainingEnabledEl.checked=false; resetHandTracking();');
  app.run('detectHand(70); cameraEl.currentTime=1; detectHand(140);');
  assert.equal(app.run('state'),'camera-ready');
  assert.equal(app.run('elapsed'),0);
  app.run('cameraEl.currentTime=2; detectHand(210);');
  assert.equal(app.run('state'),'playing');
  assert.ok(app.calls.every(call=>call.method==='GET'));
});

test('из подготовки можно уйти в меню или начать мышью',async()=>{
  const app = tracking();
  await app.run('loadRecord()');
  app.run('state="camera-ready"; backToMenu();');
  assert.equal(app.run('state'),'menu');
  assert.equal(app.element('cameraReadyOverlay').classList.contains('hidden'),true);
  app.run('state="camera-ready"; ensureAudio=()=>{}; startMouseMode();');
  assert.equal(app.run('state'),'training');
  assert.equal(app.run('currentMode'),'mouse');
  assert.equal(app.element('cameraPreview').classList.contains('hidden'),true);
});

test('подготовка остаётся видимой, если рекорд ещё не загружен',async()=>{
  const app = tracking();
  app.run('state="camera-ready"; cameraReadyOverlay.classList.remove("hidden");');
  for(let i=1;i<=3;i++) app.run(`cameraEl.currentTime=${i}; detectHand(${i*70});`);
  assert.equal(app.run('state'),'camera-ready');
  assert.equal(app.element('cameraReadyOverlay').classList.contains('hidden'),false);
  await app.run('loadRecord()');
  app.run('cameraEl.currentTime=4; detectHand(280);');
  assert.equal(app.run('state'),'training');
});
