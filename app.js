const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const playShell = document.getElementById('playShell');
const cameraEl = document.getElementById('camera');
const cameraPreview = document.getElementById('cameraPreview');
const handMarker = document.getElementById('handMarker');
const cameraReadyOverlay = document.getElementById('cameraReadyOverlay');
const cameraReadyStatus = document.getElementById('cameraReadyStatus');
const menuOverlay = document.getElementById('menuOverlay');
const resultOverlay = document.getElementById('resultOverlay');
const scoreEl = document.getElementById('score');
const timerEl = document.getElementById('timer');
const bestEl = document.getElementById('best');
const indicatorEl = document.getElementById('indicator');
const fpsEl = document.getElementById('fps');
const hintEl = document.getElementById('hint');
const livesEl = document.getElementById('lives');
const trainingEnabledEl = document.getElementById('trainingEnabled');
const tutorialLayer = document.getElementById('tutorialLayer');
const tutorialCard = document.getElementById('tutorialCard');
const tutorialShade = document.getElementById('tutorialShade');
const tutorialText = document.getElementById('tutorialText');
const tutorialNext = document.getElementById('tutorialNext');
const tutorialCountdown = document.getElementById('tutorialCountdown');
const heartEls = Array.from({length:3},(_,i)=>document.getElementById('heart'+i));

const resultBestEl = document.getElementById('resultBest');
const resultGoodEl = document.getElementById('resultGood');
const resultBadEl = document.getElementById('resultBad');
const resultComboEl = document.getElementById('resultCombo');
const finalScoreEl = document.getElementById('finalScore');

const MAX_LIVES = 3;
const HEART_SHIELD_SECONDS = 2;
const GAME_SECONDS = 60;
const TIME_BONUS_SECONDS = 5;
const MAX_BONUS_SECONDS = 20;
// В каждом 15-секундном этапе — один дополнительный блок времени.
const ROUND_PHASES = [
  {good:11, bad:5, gold:1, wide:1, time:1},
  {good:13, bad:5, gold:2, wide:1, time:1},
  {good:15, bad:5, gold:2, wide:1, time:1},
  {good:17, bad:7, gold:1, wide:2, time:1}
];
const EXTRA_PHASE = {good:4, bad:2, gold:1, wide:0, time:0};
let dpr = Math.min(window.devicePixelRatio || 1, 2);
let currentMode = 'idle'; // idle camera mouse
let state = 'menu'; // menu camera-ready training countdown playing result
let handLandmarker = null;
let handInitPromise = null;
let videoStream = null;
let lastDetect = 0;
let lastVideoTime = -1;
let lastCameraFrame = 0;
let cameraStartId = 0;
let cameraStarting = false;
let handTrack = {x:null, candidate:null, samples:0};
let frameTimes = [];
let lastFrame = performance.now();
let audioCtx = null;
let soundReady = false;

let player = {x:0.5, targetX:0.5, y:0.86, width:118, height:22, pulse:0};
let objects = [];
let particles = [];
let floaterTexts = [];
let spawnPlan = [];
let spawnIndex = 0;
let bonusSeconds = 0;
let elapsed = 0;
let lives = MAX_LIVES;
let heartShieldUntil = 0;
let lastLostHeart = -1;
let streak = 0;
let bestCombo = 0;
let goodCaught = 0;
let badCaught = 0;
let score = 0;
let bestScore = 0;
let recordsReady = false;
let gameOverFlag = false;
let boostUntil = 0;
let recordCelebration = false;
let lastTier = 0;
let tutorial = null;
const TUTORIAL_BLOCKS = ['good','gold','wide','time','bad'];
const TUTORIAL_MESSAGES = {
  good:'Этот блок даёт вам 10 очков. В обучении бонусов за серию нет. Поймайте блок платформой.',
  gold:'Этот блок даёт вам 50 очков. Поймайте его платформой.',
  wide:'Этот блок расширяет вашу платформу на 10 секунд. Поймайте его платформой.',
  time:'Этот блок увеличивает общее время игры на 5 секунд. Поймайте его платформой.',
  bad:'Этот блок уменьшает здоровье на 1 и количество очков на 15. Поймайте его, чтобы увидеть эффект.',
  hearts:'После ловли красного блока здоровье уменьшается на 1 и включается защита сердца на 2 секунды. Во время защиты красные всё равно снимают очки и сбрасывают серию. При потере всех сердец игра заканчивается.',
  hud:'Счёт — ваши собранные очки.\nВремя — оставшееся время игры.\nРекорд — лучший результат на этом компьютере. Побейте его, чтобы получить приз.'
};

const CODE_TOKENS = ['</>', '{}', 'var', 'AI', 'JS', 'if'];
const ERROR_TOKENS = ['ERROR', '404', '!!!', 'BUG'];

bestEl.textContent = pad4(bestScore);

// Запросы идут последовательно: запоздалое чтение не отменит результат записи.
let recordQueue = Promise.resolve();
let recordLoading = null;
let recordSaving = false;
let recordError = false;

function queueRecord(task){
  const operation = recordQueue.then(task);
  recordQueue = operation.catch(()=>{});
  return operation;
}

async function requestRecord(options = {}){
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 5000);
  try {
    const response = await fetch('/api/record', {
      ...options, cache:'no-store', signal:controller.signal
    });
    if(!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if(!Number.isSafeInteger(data.bestScore) || data.bestScore < 0 || data.bestScore > 1_000_000_000){
      throw new Error('Некорректный рекорд в ответе сервера');
    }
    bestScore = data.bestScore;
    if(state === 'result' && recordCelebration && bestScore !== score){
      recordCelebration = false;
      document.getElementById('recordBanner').classList.add('hidden');
    }
    recordsReady = true;
    if(recordError){
      recordError = false;
      setIndicator(state === 'result' ? 'Раунд завершён' : 'Рекорд загружен');
      hintEl.textContent = state === 'result' ? 'Можно сыграть ещё раз или вернуться в меню.' :
        state === 'playing' ? (currentMode === 'camera' ? 'Для лучшего результата держите ладонь перед камерой.' : 'Двигайте мышью влево и вправо.') :
        'Нажмите “Играть с камерой” или “Играть мышью”.';
    }
    updateHud();
    return bestScore;
  } finally {
    clearTimeout(timeout);
  }
}

function loadRecord(){
  if(recordLoading) return recordLoading;
  recordLoading = queueRecord(async ()=>{
    try {
      return await requestRecord();
    } catch (err) {
      recordsReady = false;
      recordError = true;
      console.error('Ошибка файла рекорда:',err);
      hintEl.textContent = 'Не удалось прочитать файл рекорда. Проверьте сервер и data/records.json.';
      setIndicator('Ошибка файла рекорда');
      return null;
    }
  }).finally(()=>{ recordLoading = null; });
  return recordLoading;
}

function saveRecord(value){
  return queueRecord(async ()=>{
    try {
      return await requestRecord({
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({score:value})
      });
    } catch (err) {
      recordError = true;
      console.error('Не удалось сохранить рекорд:',err);
      hintEl.textContent = 'Ошибка записи рекорда в data/records.json. Проверьте права доступа к папке.';
      setIndicator('Рекорд не сохранён');
      return null;
    }
  });
}

function refreshRecord(){
  if(!document.hidden && !recordSaving) return loadRecord();
}
loadRecord();
setInterval(refreshRecord, 2000);
window.addEventListener('focus', refreshRecord);
document.addEventListener('visibilitychange', refreshRecord);

function pad4(n){ return String(Math.max(0, Math.round(n))).padStart(4,'0'); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function lerp(a,b,t){ return a + (b-a)*t; }
function rand(a,b){ return a + Math.random()*(b-a); }

function resize(){
  const r = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
new ResizeObserver(resize).observe(canvas);
resize();

function setIndicator(text){ indicatorEl.textContent = '● ' + text; }

function ensureAudio(){
  if(soundReady) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  soundReady = true;
}

function beep({freq=440, type='sine', duration=0.08, gain=0.03, freq2=null}={}){
  if(!soundReady || !audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(freq, now);
  if(freq2) osc.frequency.exponentialRampToValueAtTime(freq2, now + duration);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(now); osc.stop(now + duration + 0.02);
}

function soundCatch(){ beep({freq:660,type:'triangle',duration:0.06,gain:0.03,freq2:880}); }
function soundBad(){ beep({freq:240,type:'sawtooth',duration:0.11,gain:0.025,freq2:150}); }
function soundCombo(){ beep({freq:510,type:'triangle',duration:0.06,gain:0.024,freq2:820}); setTimeout(()=>beep({freq:820,type:'triangle',duration:0.08,gain:0.02,freq2:1040}),50); }
function soundStart(){ beep({freq:420,type:'sine',duration:0.08,gain:0.028,freq2:620}); setTimeout(()=>beep({freq:660,type:'sine',duration:0.08,gain:0.028,freq2:880}),80); }
function soundEnd(){ beep({freq:540,type:'triangle',duration:0.12,gain:0.022,freq2:300}); }
function soundRecord(){ beep({freq:700,type:'square',duration:0.08,gain:0.02,freq2:920}); setTimeout(()=>beep({freq:920,type:'square',duration:0.08,gain:0.02,freq2:1220}),80); }

async function initHandTracking(){
  if(handLandmarker) return;
  if(handInitPromise) return handInitPromise;
  if(!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна: запускайте через localhost и современный браузер.');
  handInitPromise = createHandLandmarker();
  try{ await handInitPromise; }
  finally{ handInitPromise = null; }
}

async function createHandLandmarker(){
  const media = await import('./assets/vision_bundle.mjs');
  const {FilesetResolver, HandLandmarker} = media.default || media;
  const vision = await FilesetResolver.forVisionTasks('./assets/wasm');
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions:{ modelAssetPath:'./assets/hand_landmarker.task', delegate:'CPU' },
    runningMode:'VIDEO',
    numHands:1,
    minHandDetectionConfidence:.45,
    minTrackingConfidence:.45,
    minHandPresenceConfidence:.45
  });
}

async function startCameraMode(){
  if(cameraStarting || ['camera-ready','training','countdown','playing'].includes(state) || !canStartGame()) return;
  const startId = ++cameraStartId;
  cameraStarting = true;
  try{
    ensureAudio();
    setIndicator('Загрузка распознавания руки...');
    hintEl.textContent = 'Подождите: включаем камеру и модель распознавания.';
    await initHandTracking();
    if(startId !== cameraStartId) return;
    if(!videoStream){
      const stream = await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:false});
      if(startId !== cameraStartId){ stream.getTracks().forEach(t=>t.stop()); return; }
      videoStream = stream;
      cameraEl.srcObject = videoStream;
      await cameraEl.play();
    }
    if(startId !== cameraStartId) return;
    cameraEl.style.display = 'block';
    cameraPreview.classList.remove('hidden');
    currentMode = 'camera';
    closeTutorial();
    resetRoundState();
    resetHandTracking();
    lastVideoTime = -1;
    lastDetect = -Infinity;
    lastCameraFrame = performance.now();
    state = 'camera-ready';
    menuOverlay.classList.add('hidden');
    resultOverlay.classList.add('hidden');
    cameraReadyOverlay.classList.remove('hidden');
    setCameraStatus('Покажите ладонь камере');
    hintEl.textContent = 'Держите одну ладонь целиком в кадре. Игра начнётся после уверенного распознавания.';
  }catch(err){
    if(startId !== cameraStartId) return;
    console.error(err);
    setIndicator('Ошибка камеры');
    hintEl.textContent = String(err.message || err);
    alert('Не удалось включить камеру.\n\n' + (err.message || err) + '\n\nЕсли игра уже была установлена раньше, проверьте наличие папки assets.');
  }finally{
    if(startId === cameraStartId) cameraStarting = false;
  }
}

function startMouseMode(){
  if(['training','countdown','playing'].includes(state) || !canStartGame()) return;
  ++cameraStartId;
  cameraStarting = false;
  cameraReadyOverlay.classList.add('hidden');
  resetHandTracking();
  ensureAudio();
  currentMode = 'mouse';
  cameraEl.style.display = 'none';
  cameraPreview.classList.add('hidden');
  beginSession();
}

function beginSession(){
  if(state === 'training' || state === 'countdown' || state === 'playing') return;
  if(!canStartGame()) return;
  if(trainingEnabledEl.checked) startTutorial(); else startGame();
}

function closeTutorial(){
  tutorial = null;
  tutorialLayer.classList.add('hidden');
  tutorialCard.classList.remove('hidden');
  tutorialCountdown.classList.add('hidden');
  document.getElementById('scoreLabel').textContent = 'Счёт';
}

function startTutorial(){
  if(!canStartGame()) return;
  resetRoundState();
  state = 'training';
  tutorial = {step:'move', moveSeconds:0, caught:false, feedback:0, countdown:3};
  menuOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  tutorialLayer.classList.remove('hidden');
  tutorialCard.classList.remove('hidden');
  tutorialCountdown.classList.add('hidden');
  document.getElementById('scoreLabel').textContent = 'Учебный счёт';
  showTutorialStep('move');
  setIndicator('Обучение');
  hintEl.textContent = 'Учебные очки не влияют на рекорд. Обучение можно пропустить.';
  updateHud();
}

function showTutorialStep(step){
  if(!tutorial || state !== 'training') return;
  tutorial.step = step;
  tutorial.caught = false;
  tutorial.feedback = 0;
  objects = [];
  tutorialNext.classList.toggle('hidden',step !== 'hearts' && step !== 'hud');
  tutorialShade.classList.toggle('hidden',step === 'move');
  tutorialText.textContent = step === 'move' ?
    `Почувствуйте движение платформы ${currentMode === 'camera' ? 'ладонью' : 'мышью'}. Через 5 секунд появится первый блок.` : TUTORIAL_MESSAGES[step];
  const steps = ['move',...TUTORIAL_BLOCKS,'hearts','hud'];
  document.getElementById('tutorialProgress').textContent = `Обучение · ${steps.indexOf(step)+1} из ${steps.length}`;
  if(TUTORIAL_BLOCKS.includes(step)) spawnTutorialBlock();
  positionTutorial();
}

function spawnTutorialBlock(){
  if(!tutorial || !TUTORIAL_BLOCKS.includes(tutorial.step)) return;
  spawnObject({kind:tutorial.step,tier:0});
  const obj = objects[objects.length-1];
  obj.x = canvas.clientWidth*.5;
  obj.speed = (player.y*canvas.clientHeight+50)/5;
  obj.rot = obj.spin = 0;
}

function tutorialCaught(){
  if(!tutorial) return;
  if(tutorial.step === 'bad'){
    showTutorialStep('hearts');
    return;
  }
  tutorial.caught = true;
  tutorial.feedback = 1.2;
  tutorialText.textContent = 'Поймано! ' + TUTORIAL_MESSAGES[tutorial.step].replace(' Поймайте блок платформой.','').replace(' Поймайте его платформой.','');
}

function nextTutorial(){
  if(state !== 'training' || !tutorial) return;
  if(tutorial.step === 'hearts') showTutorialStep('hud');
  else if(tutorial.step === 'hud') startCountdown();
}

function startCountdown(){
  if(state !== 'training' || !tutorial) return;
  state = 'countdown';
  objects = [];
  particles = [];
  floaterTexts = [];
  tutorial.countdown = 3;
  lastFrame = performance.now();
  tutorialCard.classList.add('hidden');
  tutorialShade.classList.remove('hidden');
  tutorialCountdown.classList.remove('hidden');
  tutorialCountdown.textContent = '3';
  setIndicator('Приготовьтесь');
  hintEl.textContent = 'Сейчас начнётся зачётный раунд. Учебные очки и бонусы будут сброшены.';
  updateHearts();
  positionTutorial();
}

function advanceTutorial(seconds,w,h){
  if(document.hidden) return;
  while(seconds > 1e-9 && tutorial && (state === 'training' || state === 'countdown')){
    const dt = Math.min(.05,seconds);
    seconds -= dt;
    if(state === 'countdown'){
      tutorial.countdown = Math.max(0,tutorial.countdown-dt);
      if(tutorial.countdown <= 1e-9){
        if(recordsReady && !recordSaving) startGame();
        else {
          tutorialCountdown.textContent = '…';
          hintEl.textContent = 'Ждём локальный сервер и файл рекорда. Проверьте, что сервер запущен.';
        }
        return;
      }
      const number = String(Math.ceil(tutorial.countdown-1e-9));
      if(tutorialCountdown.textContent !== number) tutorialCountdown.textContent = number;
      continue;
    }
    elapsed += dt;
    if(tutorial.step === 'move'){
      tutorial.moveSeconds += dt;
      if(tutorial.moveSeconds >= 5-1e-9) showTutorialStep('good');
    } else if(TUTORIAL_BLOCKS.includes(tutorial.step)){
      if(tutorial.caught){
        tutorial.feedback -= dt;
        if(tutorial.feedback <= 1e-9){
          const index = TUTORIAL_BLOCKS.indexOf(tutorial.step);
          showTutorialStep(TUTORIAL_BLOCKS[index+1]);
        }
      } else {
        updateObjects(dt,w,h);
        // Пропущенный блок повторяется; учебный шаг нельзя потерять.
        if(tutorial && !tutorial.caught && TUTORIAL_BLOCKS.includes(tutorial.step) && objects.length === 0){
          spawnTutorialBlock();
        }
      }
    }
  }
  updateHud();
}

function tutorialTarget(){
  if(!tutorial || state === 'countdown' || tutorial.step === 'move') return null;
  if(objects.length){
    const obj = objects[0];
    return {x:obj.x-obj.w/2-12,y:obj.y-obj.h/2-12,width:obj.w+24,height:obj.h+24};
  }
  const id = tutorial.step === 'hearts' ? 'lives' : tutorial.step === 'hud' ? 'hud' :
    tutorial.step === 'time' ? 'timer' : 'score';
  const rect = document.getElementById(id).getBoundingClientRect();
  const shell = playShell.getBoundingClientRect();
  return {x:rect.left-shell.left-8,y:rect.top-shell.top-8,width:rect.width+16,height:rect.height+16};
}

function positionTutorial(){
  if(!tutorial) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const target = tutorialTarget();
  const hole = document.getElementById('tutorialHole');
  for(const [name,value] of Object.entries({x:target?.x || 0,y:target?.y || 0,width:target?.width || 0,height:target?.height || 0})){
    hole.setAttribute(name,String(value));
  }
  if(state === 'countdown') return;
  const card = tutorialCard.getBoundingClientRect();
  let x = (w-card.width)/2;
  let y = Math.min(190,h*.3);
  if(target){
    if(target.x+target.width+card.width+28 < w){
      x = target.x+target.width+16;
      y = target.y;
    } else if(target.x-card.width-16 > 8){
      x = target.x-card.width-16;
      y = target.y;
    } else {
      y = target.y-card.height-16;
      if(y < 8) y = target.y+target.height+16;
    }
  }
  tutorialCard.style.left = clamp(x,8,Math.max(8,w-card.width-8))+'px';
  tutorialCard.style.top = clamp(y,8,Math.max(8,h-card.height-8))+'px';
}

function canStartGame(){
  if(recordSaving){
    alert('Дождитесь сохранения результата.');
    return false;
  }
  if(!recordsReady){
    alert('Файл рекорда ещё не загружен. Проверьте работу локального сервера.');
    return false;
  }
  return true;
}

function resetRoundState(){
  objects = [];
  particles = [];
  floaterTexts = [];
  elapsed = 0;
  bonusSeconds = 0;
  spawnPlan = [];
  spawnIndex = 0;
  lastFrame = performance.now();
  streak = 0;
  bestCombo = 0;
  goodCaught = 0;
  badCaught = 0;
  score = 0;
  resetLives();
  gameOverFlag = false;
  boostUntil = 0;
  recordCelebration = false;
  lastTier = 0;
  player.x = player.targetX = 0.5;
  player.hitFlash = player.badFlash = 0;
}

function startGame(){
  if(!canStartGame()) return;
  closeTutorial();
  resetRoundState();
  spawnPlan = createSpawnPlan();
  state = 'playing';
  updateHud();
  menuOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  setIndicator(currentMode === 'camera' ? 'Покажи ладонь камере' : 'Управление мышью');
  hintEl.textContent = currentMode === 'camera' ? 'Для лучшего результата держите ладонь перед камерой.' : 'Двигайте мышью влево и вправо.';
  soundStart();
}

async function finishGame(){
  if(state !== 'playing' || gameOverFlag) return;
  state = 'result';
  gameOverFlag = true;
  soundEnd();
  recordSaving = true;
  recordCelebration = false;
  updateHud();
  document.getElementById('resultReason').textContent = lives === 0 ? 'Жизни закончились' : 'Время вышло';
  finalScoreEl.textContent = score;
  resultBestEl.textContent = bestScore;
  resultGoodEl.textContent = goodCaught;
  resultBadEl.textContent = badCaught;
  resultComboEl.textContent = bestCombo;
  document.getElementById('recordBanner').classList.toggle('hidden', !recordCelebration);
  resultOverlay.classList.remove('hidden');
  setIndicator('Раунд завершён');
  hintEl.textContent = 'Можно сыграть ещё раз или вернуться в меню.';

  try {
    // Сравниваем с файлом, а отправляем только счёт этого раунда, не старый максимум.
    const before = await loadRecord();
    if(before === null) return;
    const saved = await saveRecord(score);
    if(saved === null) return;
    recordCelebration = score > before && saved === score;
    if(state === 'result'){
      document.getElementById('recordBanner').classList.toggle('hidden', !recordCelebration);
      if(recordCelebration) soundRecord();
    }
  } finally {
    recordSaving = false;
  }

}

function backToMenu(){
  ++cameraStartId;
  cameraStarting = false;
  cameraReadyOverlay.classList.add('hidden');
  resetHandTracking();
  closeTutorial();
  state = 'menu';
  resetLives();
  menuOverlay.classList.remove('hidden');
  resultOverlay.classList.add('hidden');
  if(currentMode === 'camera' && cameraEl.srcObject) cameraEl.style.display = 'block';
  setIndicator('Готово к запуску');
  hintEl.textContent = 'Нажмите “Играть с камерой” или “Играть мышью”.';
}

function fullReset(){
  backToMenu();
  currentMode = 'idle';
  cameraEl.style.display = 'none';
  cameraPreview.classList.add('hidden');
  if(videoStream){
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
    cameraEl.srcObject = null;
  }
  handLandmarker?.close();
  handLandmarker = null;
  setIndicator('Сброс выполнен');
  hintEl.textContent = 'Если нужно, заново запустите игру.';
}

function resetLives(){
  lives = MAX_LIVES;
  heartShieldUntil = 0;
  lastLostHeart = -1;
  updateHearts();
}

function updateHearts(){
  const shielded = (state === 'playing' || state === 'training') && lives > 0 && elapsed < heartShieldUntil-1e-9;
  heartEls.forEach((heart,i)=>{
    heart.classList.toggle('is-empty',i >= lives);
    heart.classList.toggle('just-lost',i === lastLostHeart);
    heart.classList.toggle('is-pulsing',shielded && i === lives-1);
  });
  const label = `Жизни: ${lives} из ${MAX_LIVES}${shielded ? '. Защита сердца' : ''}`;
  if(livesEl.getAttribute('aria-label') !== label) livesEl.setAttribute('aria-label',label);
}

function updateHud(){
  updateHearts();
  scoreEl.textContent = pad4(score);
  bestEl.textContent = pad4(bestScore);
  resultBestEl.textContent = bestScore;
  const timeLeft = Math.ceil(Math.max(0, GAME_SECONDS + bonusSeconds - (state === 'training' || state === 'countdown' ? 0 : elapsed) - 1e-9));
  const mm = String(Math.floor(timeLeft / 60)).padStart(2,'0');
  const ss = String(Math.floor(timeLeft % 60)).padStart(2,'0');
  timerEl.textContent = `${mm}:${ss}`;
}

function shuffled(items){
  const result = [...items];
  for(let i=result.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [result[i],result[j]] = [result[j],result[i]];
  }
  return result;
}

function trailingBad(kinds, initial = 0){
  let run = initial;
  for(const kind of kinds){
    run = kind === 'bad' ? run+1 : 0;
    if(run > 2) return -1;
  }
  return run;
}

function createPhaseKinds(counts, previousBad, maxTimeIndex = Infinity){
  const ordinary = [...Array(counts.good).fill('good'), ...Array(counts.bad).fill('bad')];
  const specials = shuffled([
    ...Array(counts.gold).fill('gold'), ...Array(counts.wide).fill('wide'),
    ...Array(counts.time).fill('time')
  ]);
  const count = ordinary.length + specials.length;
  const slots = Array(count).fill(null);
  // Разносим бонусы по отдельным участкам этапа, а не собираем в одной точке.
  specials.forEach((kind,i)=>{
    const from = Math.floor(i*count/specials.length);
    const end = Math.floor((i+1)*count/specials.length);
    const to = kind === 'time' ? Math.min(end,maxTimeIndex+1) : end;
    slots[from + Math.floor(Math.random()*(to-from))] = kind;
  });
  for(let attempt=0;attempt<100;attempt++){
    const bag = shuffled(ordinary);
    const kinds = slots.map(kind=>kind || bag.pop());
    if(trailingBad(kinds,previousBad) !== -1) return kinds;
  }
  // Ограничиваем число попыток даже при неудачном генераторе случайных чисел.
  let remainingBad = counts.bad;
  let run = previousBad;
  return slots.map(special=>{
    const kind = special || (remainingBad > 0 && run < 2 ? 'bad' : 'good');
    if(!special && kind === 'bad') remainingBad--;
    run = kind === 'bad' ? run+1 : 0;
    return kind;
  });
}

function createSpawnPlan(){
  const plan = [];
  let previousBad = 0;
  const phases = [...ROUND_PHASES, ...Array(4).fill(EXTRA_PHASE)];
  phases.forEach((counts,phase)=>{
    const tier = Math.min(phase,3);
    const flightSeconds = 3 / (1 + tier*.17);
    const start = phase < 4 ? Math.max(3,phase*15) : GAME_SECONDS+(phase-4)*5;
    const end = phase < 4 ? (phase+1)*15 : start+5;
    const count = Object.values(counts).reduce((sum,n)=>sum+n,0);
    const interval = (end-start)/count;
    // Все блоки времени доступны до начала появления блоков продления.
    const maxTimeIndex = Math.floor((GAME_SECONDS-2.5-start)/interval);
    const kinds = createPhaseKinds(counts,previousBad,maxTimeIndex);
    previousBad = trailingBad(kinds,previousBad);
    kinds.forEach((kind,i)=>{
      const catchAt = start+interval*i;
      plan.push({kind, at:catchAt-flightSeconds, catchAt, tier, phase,
                 bonusRequired:Math.max(0,(phase-3)*TIME_BONUS_SECONDS)});
    });
  });
  return plan;
}

function spawnObject(entry){
  const kind = entry.kind;
  const w = kind === 'wide' || kind === 'time' ? 82 : kind === 'gold' ? 72 : rand(64,88);
  const h = 44;
  const x = rand(w/2 + 9, Math.max(w/2 + 9, canvas.clientWidth-w/2-9));
  // Время подлёта зависит от этапа, а не от высоты окна и случайной скорости.
  const flightSeconds = 3 / (1 + entry.tier*.17);
  const speed = (player.y*canvas.clientHeight + 50) / flightSeconds;
  const tokens = kind === 'bad' ? ERROR_TOKENS : CODE_TOKENS;
  objects.push({x,y:-50,w,h,speed,kind,
    text:kind==='time'?'+5 СЕК':kind==='gold'?'★ +50':kind==='wide'?'↔  ШИРЕ':tokens[Math.floor(Math.random()*tokens.length)],
    rot:rand(-.12,.12),spin:rand(-.25,.25),glow:rand(0,Math.PI*2)});
}

function addParticles(x,y,color,count=14){
  for(let i=0;i<count;i++){
    particles.push({x,y,vx:rand(-140,140),vy:rand(-160,70),life:rand(.35,.9),age:0,size:rand(2,6),color});
  }
}

function addFloater(text,x,y,color){
  floaterTexts.push({text,x,y,life:0,ttl:1,color});
}

playShell.addEventListener('pointermove', (e)=>{
  if(currentMode !== 'mouse') return;
  const r = canvas.getBoundingClientRect();
  player.targetX = clamp((e.clientX - r.left) / r.width, 0, 1);
});

function resetHandTracking(){
  handTrack = {x:null, candidate:null, samples:0};
  player.targetX = player.x;
  handMarker.classList.add('hidden');
}

function setCameraStatus(text){
  if(cameraReadyStatus.textContent !== text) cameraReadyStatus.textContent = text;
  setIndicator(text);
}

function loseHand(text = 'Ладонь не видна — покажите её целиком'){
  resetHandTracking();
  setCameraStatus(text);
}

function palmCenter(landmarks){
  // Основание ладони и основания пальцев устойчивее одной точки при повороте кисти.
  const points = [0,5,9,13,17].map(i=>landmarks?.[i]);
  if(points.some(p=>!p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const x = points.reduce((sum,p)=>sum+p.x,0)/points.length;
  const y = points.reduce((sum,p)=>sum+p.y,0)/points.length;
  if(x < 0 || x > 1 || y < 0 || y > 1) return null;
  return {x,y};
}

function showHandMarker(point, pending){
  // Превью использует object-fit:cover: учитываем обрезку и зеркальное отражение.
  const w = cameraEl.clientWidth, h = cameraEl.clientHeight;
  const vw = cameraEl.videoWidth, vh = cameraEl.videoHeight;
  if(!w || !h || !vw || !vh) return;
  const scale = Math.max(w/vw,h/vh);
  const x = 1-(point.x*vw*scale-(vw*scale-w)/2)/w;
  const y = (point.y*vh*scale-(vh*scale-h)/2)/h;
  handMarker.classList.toggle('hidden',x < 0 || x > 1 || y < 0 || y > 1);
  handMarker.classList.toggle('is-pending',pending);
  handMarker.style.left = `${x*100}%`;
  handMarker.style.top = `${y*100}%`;
}

function acceptHand(point){
  if(!point){ loseHand(); return false; }
  const x = clamp(1-point.x,.05,.95);
  const acquiring = handTrack.x === null;
  const jump = !acquiring && Math.abs(x-handTrack.x) > .25;
  if(acquiring || jump){
    if(handTrack.candidate !== null && Math.abs(x-handTrack.candidate) <= .12){
      handTrack.samples++;
    }else{
      handTrack.samples = 1;
    }
    handTrack.candidate = x;
    if(handTrack.samples < (acquiring ? 3 : 2)){
      player.targetX = player.x;
      showHandMarker(point,true);
      setCameraStatus(acquiring ? 'Вижу ладонь — удержите её ненадолго' : 'Проверяю положение ладони');
      return false;
    }
  }
  handTrack = {x, candidate:null, samples:0};
  player.targetX = x;
  showHandMarker(point,false);
  setCameraStatus('Ладонь найдена');
  return true;
}

function detectHand(timestamp){
  if(currentMode !== 'camera' || !handLandmarker || !['camera-ready','training','countdown','playing'].includes(state)) return;
  if(cameraEl.readyState < 2 || cameraEl.currentTime === lastVideoTime){
    if(timestamp-lastCameraFrame > 500) loseHand('Нет новых кадров камеры — проверьте камеру');
    return;
  }
  if(timestamp - lastDetect < 66) return;
  lastDetect = timestamp;
  lastVideoTime = cameraEl.currentTime;
  lastCameraFrame = timestamp;
  try{
    const result = handLandmarker.detectForVideo(cameraEl, timestamp);
    const accepted = acceptHand(palmCenter(result.landmarks?.[0]));
    if(accepted && state === 'camera-ready'){
      if(!recordsReady || recordSaving){
        setCameraStatus('Ладонь найдена — ждём загрузки рекорда');
        return;
      }
      cameraReadyOverlay.classList.add('hidden');
      state = 'menu';
      beginSession();
      setCameraStatus('Ладонь найдена');
    }
  }catch(err){
    loseHand('Ошибка распознавания — попробуйте «Сброс» или управление мышью');
  }
}

function drawBackground(t,w,h){
  ctx.fillStyle = '#0f4cff';
  ctx.fillRect(0,0,w,h);
  ctx.fillStyle = '#efede5';
  ctx.beginPath();
  ctx.moveTo(w*0.58, 0);
  ctx.lineTo(w,0); ctx.lineTo(w,h); ctx.lineTo(w*0.42,h); ctx.closePath(); ctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.translate(w*0.77,h*0.23);
  ctx.rotate(-0.08);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.strokeRect(-90,-90,180,180);
  ctx.beginPath(); ctx.moveTo(-74,-68); ctx.bezierCurveTo(-24,-60,-46,-14,-74,58); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-48,72); ctx.lineTo(2,-70); ctx.lineTo(2,88); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(2,-70); ctx.quadraticCurveTo(52,-40,80,-66); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(36,6); ctx.lineTo(80,-10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(58,66); ctx.lineTo(80,54); ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for(let x=0;x<w;x+=34){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let y=0;y<h;y+=34){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  ctx.restore();

  const grad = ctx.createRadialGradient(w*0.2,h*0.2,10,w*0.2,h*0.2,w*0.4);
  grad.addColorStop(0,'rgba(255,255,255,.18)');
  grad.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,w,h);
}

function drawPlayer(w,h,dt){
  player.x = lerp(player.x, player.targetX, Math.min(1, dt * 10));
  player.pulse += dt * 4.5;
  player.hitFlash = Math.max(0, (player.hitFlash || 0) - dt * 3.5);
  player.badFlash = Math.max(0, (player.badFlash || 0) - dt * 3.5);
  const px = player.x * w;
  const py = player.y * h;
  const plateW = elapsed < boostUntil ? 186 : 116;
  const plateH = 22;

  ctx.save();
  ctx.translate(px, py);
  ctx.shadowColor = 'rgba(15,76,255,.35)';
  ctx.shadowBlur = 18;
  roundRect(ctx, -plateW/2, -plateH/2, plateW, plateH, 12);
  ctx.fillStyle = elapsed < boostUntil ? '#c5efce' : '#efede5';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  roundRect(ctx, -34, -10, 68, 20, 10);
  ctx.fillStyle = '#0f4cff';
  ctx.fill();
  ctx.fillStyle = player.badFlash > 0 ? '#ff4d5e' : '#c5efce';
  ctx.fillRect(-12, -3, 24, 6);
  if(player.hitFlash > 0 || player.badFlash > 0){
    ctx.globalAlpha = Math.max(player.hitFlash, player.badFlash) * .9;
    ctx.strokeStyle = player.badFlash > 0 ? '#ff4d5e' : '#c5efce';
    ctx.lineWidth = 5;
    roundRect(ctx, -plateW/2-7, -plateH/2-7, plateW+14, plateH+14, 16);
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = .22 + Math.sin(player.pulse) * .04;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(px, py + 26, plateW*.63, 16, 0, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function roundRect(context, x, y, w, h, r){
  context.beginPath();
  context.moveTo(x+r,y);
  context.arcTo(x+w,y,x+w,y+h,r);
  context.arcTo(x+w,y+h,x,y+h,r);
  context.arcTo(x,y+h,x,y,r);
  context.arcTo(x,y,x+w,y,r);
  context.closePath();
}

function drawObject(obj){
  const palette = {good:['#ffffff','#0f4cff'],bad:['#ff4d5e','#ffffff'],gold:['#ffcf48','#533600'],wide:['#c5efce','#1a5634'],time:['#bdefff','#084c70']};
  const [bg,fg] = palette[obj.kind];
  ctx.save();ctx.translate(obj.x,obj.y);ctx.rotate(obj.rot);
  ctx.shadowBlur=12;ctx.shadowColor='rgba(0,0,0,.15)';
  roundRect(ctx,-obj.w/2,-obj.h/2,obj.w,obj.h,13);
  ctx.fillStyle=bg;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle=fg;ctx.stroke();
  ctx.fillStyle=fg;ctx.font=`900 ${obj.kind==='wide'?13:obj.kind==='time'?15:obj.kind==='gold'?16:obj.kind==='good'?18:15}px Arial,sans-serif`;
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(obj.text,0,1);ctx.restore();
}

function updateObjects(dt,w,h){
  const tier = Math.min(3, Math.floor(elapsed / 15));
  if(state === 'playing' && tier > lastTier){ lastTier=tier; addFloater('УРОВЕНЬ '+(tier+1),w*.5,h*.39,'#b76a00'); soundCombo(); }
  while(state === 'playing' && spawnIndex < spawnPlan.length && spawnPlan[spawnIndex].at <= elapsed+1e-9 &&
        spawnPlan[spawnIndex].bonusRequired <= bonusSeconds){
    spawnObject(spawnPlan[spawnIndex++]);
  }

  const px = player.x * w;
  const py = player.y * h;
  const catchY = py - 2;
  const catchHalfW = elapsed < boostUntil ? 93 : 58;
  // Небольшой допуск на отрисовку, чтобы видимый контакт всегда засчитывался.
  const collisionMargin = 8;

  for(let i = objects.length - 1; i >= 0; i--){
    const obj = objects[i];
    const previousY = obj.y;
    obj.y += obj.speed * dt;
    obj.rot += obj.spin * dt;
    obj.glow += dt;

    // Проверяем реальную ширину плитки и путь движения за кадр,
    // чтобы быстрый объект не пролетал сквозь платформу между кадрами.
    const hitX = Math.abs(obj.x - px) <= catchHalfW + obj.w / 2 + collisionMargin;
    const platformTop = catchY - 11;
    const platformBottom = catchY + 11;
    const sweptTop = Math.min(previousY, obj.y) - obj.h / 2;
    const sweptBottom = Math.max(previousY, obj.y) + obj.h / 2;
    const hitY = sweptBottom >= platformTop - 4 && sweptTop <= platformBottom + 4;
    if(hitX && hitY){
      catchObject(obj);
      objects.splice(i,1);
      updateHud();
      if(state === 'training'){ tutorialCaught(); return; }
      if(state !== 'playing') return;
      continue;
    }

    if(obj.y - obj.h/2 > h + 40){
      objects.splice(i,1);
    }
  }
}

function catchObject(obj){
  if(state !== 'playing' && state !== 'training') return;
  if(obj.kind === 'bad'){
    score = Math.max(0, score - 15);
    badCaught++;
    streak = 0;
    addParticles(obj.x,obj.y,'#ff4d5e',26);
    player.badFlash = 1;
    addFloater('-15',obj.x,obj.y,'#ff4d5e');
    soundBad();
    if(elapsed >= heartShieldUntil-1e-9){
      lives--;
      lastLostHeart = lives;
      heartShieldUntil = lives > 0 ? elapsed + HEART_SHIELD_SECONDS : 0;
      updateHearts();
      if(lives === 0 && state === 'playing') finishGame();
    }
    return;
  }

  goodCaught++;
  streak++;
  bestCombo = Math.max(bestCombo,streak);
  player.hitFlash = 1;
  if(obj.kind === 'time'){
    const added = Math.min(TIME_BONUS_SECONDS,MAX_BONUS_SECONDS-bonusSeconds);
    bonusSeconds += added;
    addFloater(`+${added} СЕК`,obj.x,obj.y,'#084c70');
    addParticles(obj.x,obj.y,'#bdefff',26);
    soundCombo();
  } else if(obj.kind === 'wide'){
    boostUntil = elapsed + 10;
    addFloater('ПЛАТФОРМА ШИРЕ: 10 СЕК',obj.x,obj.y,'#b76a00');
    addParticles(obj.x,obj.y,'#ffb900',32);
    soundCombo();
  } else {
    const points = obj.kind === 'gold' ? 50 : 10;
    score += points;
    addFloater(`+${points}`,obj.x,obj.y,'#b76a00');
    addParticles(obj.x,obj.y,'#ffb900',obj.kind === 'gold' ? 36 : 30);
    if(obj.kind === 'gold') soundCombo(); else soundCatch();
  }
  // Любой полезный блок завершает пятёрку: код, золото, расширение или время.
  if(state === 'playing' && streak % 5 === 0){
    score += 20;
    addFloater(`СЕРИЯ x${streak}  +20`,obj.x,obj.y-24,'#b76a00');
    addParticles(obj.x,obj.y,'#ffb900',26);
    soundCombo();
  }
}

function advanceGame(seconds,w,h){
  // Маленькие шаги сохраняют столкновения, реальное время не растягивается при низком FPS.
  while(seconds > 1e-9 && state === 'playing'){
    const remaining = GAME_SECONDS + bonusSeconds - elapsed;
    if(remaining <= 1e-9){ finishGame(); break; }
    const dt = Math.min(.05,seconds,remaining);
    elapsed += dt;
    updateObjects(dt,w,h);
    if(state !== 'playing') break;
    seconds -= dt;
    if(elapsed >= GAME_SECONDS + bonusSeconds - 1e-9){
      elapsed = GAME_SECONDS + bonusSeconds;
      finishGame();
    }
  }
}

function updateParticles(dt){
  for(let i = particles.length - 1; i >= 0; i--){
    const p = particles[i];
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 180 * dt;
    if(p.age >= p.life) particles.splice(i,1);
  }
  for(let i = floaterTexts.length - 1; i >= 0; i--){
    const f = floaterTexts[i];
    f.life += dt;
    f.y -= 30 * dt;
    if(f.life >= f.ttl) floaterTexts.splice(i,1);
  }
}

function drawParticles(){
  for(const p of particles){
    const alpha = 1 - p.age / p.life;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
    ctx.restore();
  }
  for(const f of floaterTexts){
    const alpha = 1 - f.life / f.ttl;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = f.color;
    ctx.font = '900 18px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = '#ffffff'; ctx.strokeText(f.text, f.x, f.y); ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }
}

function render(timestamp){
  const frameSeconds = Math.max(0, (timestamp - lastFrame) / 1000);
  const dt = Math.min(.05,frameSeconds);
  lastFrame = timestamp;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  detectHand(timestamp);

  drawBackground(timestamp, w, h);

  if(state === 'playing') advanceGame(frameSeconds,w,h);
  else if(state === 'training' || state === 'countdown') advanceTutorial(Math.min(frameSeconds,.1),w,h);

  updateParticles(dt);
  drawPlayer(w, h, dt);
  for(const obj of objects) drawObject(obj);
  drawParticles();
  if(tutorial) positionTutorial();

  frameTimes.push(timestamp);
  while(frameTimes.length && timestamp - frameTimes[0] > 1000) frameTimes.shift();
  fpsEl.textContent = 'FPS ' + frameTimes.length;
  updateHud();
  requestAnimationFrame(render);
}

requestAnimationFrame(render);

tutorialNext.addEventListener('click', nextTutorial);
document.getElementById('tutorialSkip').addEventListener('click', startCountdown);
document.getElementById('startCamera').addEventListener('click', startCameraMode);
document.getElementById('startMouse').addEventListener('click', startMouseMode);
document.getElementById('cameraUseMouse').addEventListener('click', startMouseMode);
document.getElementById('cameraCancel').addEventListener('click', backToMenu);
document.getElementById('playAgain').addEventListener('click', ()=>{
  if(currentMode === 'camera') startCameraMode(); else startMouseMode();
});
document.getElementById('backToMenu').addEventListener('click', backToMenu);
document.getElementById('fullscreen').addEventListener('click', async ()=>{
  try{
    if(document.fullscreenElement) await document.exitFullscreen();
    else await playShell.requestFullscreen();
  }catch(err){ console.warn(err); }
});
document.getElementById('reset').addEventListener('click', fullReset);

window.addEventListener('keydown', (e)=>{
  if(e.code === 'Space' && state === 'menu') startMouseMode();
});
