const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const playShell = document.getElementById('playShell');
const cameraEl = document.getElementById('camera');
const menuOverlay = document.getElementById('menuOverlay');
const resultOverlay = document.getElementById('resultOverlay');
const scoreEl = document.getElementById('score');
const timerEl = document.getElementById('timer');
const bestEl = document.getElementById('best');
const indicatorEl = document.getElementById('indicator');
const fpsEl = document.getElementById('fps');
const hintEl = document.getElementById('hint');

const resultBestEl = document.getElementById('resultBest');
const resultGoodEl = document.getElementById('resultGood');
const resultBadEl = document.getElementById('resultBad');
const resultComboEl = document.getElementById('resultCombo');
const finalScoreEl = document.getElementById('finalScore');

const GAME_SECONDS = 60;
const STORAGE_KEY = 'digit_lovi_kod_best_v2';
let dpr = Math.min(window.devicePixelRatio || 1, 2);
let currentMode = 'idle'; // idle camera mouse
let state = 'menu'; // menu playing result
let handLandmarker = null;
let videoStream = null;
let lastDetect = 0;
let frameTimes = [];
let lastFrame = performance.now();
let audioCtx = null;
let soundReady = false;

let player = {x:0.5, targetX:0.5, y:0.86, width:118, height:22, pulse:0};
let objects = [];
let particles = [];
let floaterTexts = [];
let spawnTimer = 0;
let elapsed = 0;
let streak = 0;
let bestCombo = 0;
let goodCaught = 0;
let badCaught = 0;
let score = 0;
let bestScore = Number(localStorage.getItem(STORAGE_KEY) || 0);
let gameOverFlag = false;
let boostUntil = 0;
let previousBest = bestScore;
let recordCelebration = false;
let lastTier = 0;

const CODE_TOKENS = ['</>', '{}', 'var', 'AI', 'JS', 'if'];
const ERROR_TOKENS = ['ERROR', '404', '!!!', 'BUG'];

bestEl.textContent = pad4(bestScore);

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
  if(!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна: запускайте через localhost и современный браузер.');
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
  ensureAudio();
  try{
    setIndicator('Загрузка распознавания руки...');
    hintEl.textContent = 'Подождите: включаем камеру и модель распознавания.';
    await initHandTracking();
    if(!videoStream){
      videoStream = await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:false});
      cameraEl.srcObject = videoStream;
      await cameraEl.play();
    }
    cameraEl.style.display = 'block';
    currentMode = 'camera';
    startGame();
  }catch(err){
    console.error(err);
    setIndicator('Ошибка камеры');
    hintEl.textContent = String(err.message || err);
    alert('Не удалось включить камеру.\n\n' + (err.message || err) + '\n\nЕсли игра уже была установлена раньше, проверьте наличие папки assets.');
  }
}

function startMouseMode(){
  ensureAudio();
  currentMode = 'mouse';
  cameraEl.style.display = 'none';
  startGame();
}

function startGame(){
  objects = [];
  particles = [];
  floaterTexts = [];
  elapsed = 0;
  spawnTimer = 0;
  streak = 0;
  bestCombo = 0;
  goodCaught = 0;
  badCaught = 0;
  score = 0;
  gameOverFlag = false;
  boostUntil = 0;
  previousBest = bestScore;
  recordCelebration = false;
  lastTier = 0;
  player.x = player.targetX = 0.5;
  player.hitFlash = player.badFlash = 0;
  updateHud();
  state = 'playing';
  menuOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  setIndicator(currentMode === 'camera' ? 'Покажи ладонь камере' : 'Управление мышью');
  hintEl.textContent = currentMode === 'camera' ? 'Для лучшего результата держите ладонь перед камерой.' : 'Двигайте мышью влево и вправо.';
  soundStart();
}

function finishGame(){
  state = 'result';
  gameOverFlag = true;
  soundEnd();
  recordCelebration = score > previousBest && score > 0;
  if(recordCelebration){
    bestScore = score;
    localStorage.setItem(STORAGE_KEY, String(bestScore));
    soundRecord();
  }
  updateHud();
  finalScoreEl.textContent = score;
  resultBestEl.textContent = bestScore;
  resultGoodEl.textContent = goodCaught;
  resultBadEl.textContent = badCaught;
  resultComboEl.textContent = bestCombo;
  document.getElementById('recordBanner').classList.toggle('hidden', !recordCelebration);
  resultOverlay.classList.remove('hidden');
  setIndicator('Раунд завершён');
  hintEl.textContent = 'Можно сыграть ещё раз или вернуться в меню.';
}

function backToMenu(){
  state = 'menu';
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
  if(videoStream){
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
    cameraEl.srcObject = null;
  }
  handLandmarker = null;
  setIndicator('Сброс выполнен');
  hintEl.textContent = 'Если нужно, заново запустите игру.';
}

function updateHud(){
  scoreEl.textContent = pad4(score);
  bestEl.textContent = pad4(bestScore);
  const timeLeft = Math.max(0, GAME_SECONDS - elapsed);
  const mm = String(Math.floor(timeLeft / 60)).padStart(2,'0');
  const ss = String(Math.floor(timeLeft % 60)).padStart(2,'0');
  timerEl.textContent = `${mm}:${ss}`;
}

function spawnObject(){
  const random = Math.random();
  const kind = random < .055 ? 'wide' : random < .125 ? 'gold' : random < .37 ? 'bad' : 'good';
  const w = kind === 'wide' ? 82 : kind === 'gold' ? 72 : rand(64,88);
  const h = 44;
  const tier = Math.floor(elapsed / 15);
  const x = rand(w/2 + 9, Math.max(w/2 + 9, canvas.clientWidth-w/2-9));
  const speed = rand(135,180) * (1 + tier * .17);
  const tokens = kind === 'bad' ? ERROR_TOKENS : CODE_TOKENS;
  objects.push({x,y:-50,w,h,speed,kind,
    text:kind==='gold'?'★ +50':kind==='wide'?'↔  ШИРЕ':tokens[Math.floor(Math.random()*tokens.length)],
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

canvas.addEventListener('pointermove', (e)=>{
  if(currentMode !== 'mouse') return;
  const r = canvas.getBoundingClientRect();
  player.targetX = clamp((e.clientX - r.left) / r.width, 0, 1);
});

async function detectHand(timestamp){
  if(currentMode !== 'camera' || !handLandmarker || !cameraEl || cameraEl.readyState < 2) return;
  if(timestamp - lastDetect < 66) return;
  lastDetect = timestamp;
  try{
    const result = handLandmarker.detectForVideo(cameraEl, timestamp);
    if(result.landmarks?.length){
      const p = result.landmarks[0][9];
      player.targetX = clamp(1 - p.x, 0.05, 0.95);
      setIndicator('Ладонь обнаружена');
    } else {
      setIndicator('Покажи ладонь камере');
    }
  }catch(err){
    console.warn(err);
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
  const palette = {good:['#ffffff','#0f4cff'],bad:['#ff4d5e','#ffffff'],gold:['#ffcf48','#533600'],wide:['#c5efce','#1a5634']};
  const [bg,fg] = palette[obj.kind];
  ctx.save();ctx.translate(obj.x,obj.y);ctx.rotate(obj.rot);
  ctx.shadowBlur=12;ctx.shadowColor='rgba(0,0,0,.15)';
  roundRect(ctx,-obj.w/2,-obj.h/2,obj.w,obj.h,13);
  ctx.fillStyle=bg;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle=fg;ctx.stroke();
  ctx.fillStyle=fg;ctx.font=`900 ${obj.kind==='wide'?13:obj.kind==='gold'?16:obj.kind==='good'?18:15}px Arial,sans-serif`;
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(obj.text,0,1);ctx.restore();
}

function updateObjects(dt,w,h){
  spawnTimer -= dt;
  const tier = Math.floor(elapsed / 15);
  if(tier > lastTier){ lastTier=tier; addFloater('УРОВЕНЬ '+(tier+1),w*.5,h*.39,'#b76a00'); soundCombo(); }
  const spawnInterval = Math.max(.39, .82 - tier * .09);
  if(state === 'playing' && spawnTimer <= 0){
    spawnObject();
    spawnTimer = spawnInterval;
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
      if(obj.kind === 'gold'){
        score += 50; goodCaught++; streak++; bestCombo=Math.max(bestCombo,streak);
        addParticles(obj.x,obj.y,'#ffb900',36);addFloater('+50',obj.x,obj.y,'#b76a00');player.hitFlash=1;soundCombo();
      } else if(obj.kind === 'wide'){
        boostUntil = elapsed + 10; goodCaught++; streak++; bestCombo=Math.max(bestCombo,streak);
        addParticles(obj.x,obj.y,'#ffb900',32);addFloater('ПЛАТФОРМА ШИРЕ: 10 СЕК',obj.x,obj.y,'#b76a00');player.hitFlash=1;soundCombo();
      } else if(obj.kind === 'good'){
        score += 10;
        goodCaught += 1;
        streak += 1;
        bestCombo = Math.max(bestCombo, streak);
        addParticles(obj.x, obj.y, '#ffb900', 30);
        player.hitFlash = 1;
        addFloater('+10', obj.x, obj.y, '#b76a00');
        soundCatch();
        if(streak > 0 && streak % 5 === 0){
          const comboBonus = 20;
          score += comboBonus;
          bestCombo = Math.max(bestCombo, streak);
          addFloater(`СЕРИЯ x${streak}  +${comboBonus}`, obj.x, obj.y - 24, '#b76a00');
          addParticles(obj.x, obj.y, '#ffb900', 26);
          soundCombo();
        }
      } else {
        score = Math.max(0, score - 15);
        badCaught += 1;
        streak = 0;
        addParticles(obj.x, obj.y, '#ff4d5e', 26);
        player.badFlash = 1;
        addFloater('-15', obj.x, obj.y, '#ff4d5e');
        soundBad();
      }
      objects.splice(i,1);
      updateHud();
      continue;
    }

    if(obj.y - obj.h/2 > h + 40){
      objects.splice(i,1);
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
  const dt = Math.min(.05, (timestamp - lastFrame) / 1000);
  lastFrame = timestamp;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  detectHand(timestamp);

  drawBackground(timestamp, w, h);

  if(state === 'playing'){
    elapsed += dt;
    if(elapsed >= GAME_SECONDS && !gameOverFlag){
      elapsed = GAME_SECONDS;
      updateHud();
      finishGame();
    }
    if(state === 'playing') updateObjects(dt, w, h);
  }

  updateParticles(dt);
  drawPlayer(w, h, dt);
  for(const obj of objects) drawObject(obj);
  drawParticles();

  frameTimes.push(timestamp);
  while(frameTimes.length && timestamp - frameTimes[0] > 1000) frameTimes.shift();
  fpsEl.textContent = 'FPS ' + frameTimes.length;
  updateHud();
  requestAnimationFrame(render);
}

requestAnimationFrame(render);

document.getElementById('startCamera').addEventListener('click', startCameraMode);
document.getElementById('startMouse').addEventListener('click', startMouseMode);
document.getElementById('playAgain').addEventListener('click', ()=>{
  resultOverlay.classList.add('hidden');
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
