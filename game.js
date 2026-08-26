(() => {
'use strict';

/* ========== 定数 ========== */
const RANK_LABEL = { 1:'A', 11:'J', 12:'Q', 13:'K' };
const SUITS = { red:['♥','♦'], black:['♠','♣'] };

const DIFF = {
  easy:   { label:'やさしい',   min:2600, max:4000, miss:0.60, smart:false },
  normal: { label:'ふつう',     min:1400, max:2200, miss:0.35, smart:false },
  hard:   { label:'むずかしい', min:700,  max:1100, miss:0.15, smart:true  },
};

const STUCK_WAIT = 5000;   // 出せる札がなくなってから場に出すまでの溜め
const APP_VERSION = 'v1.1 (2026-08-26)';   // 画面に出す版。中身を変えたら上げる

const $ = sel => document.querySelector(sel);
const el = {
  cpuHand:$('#cpuHand'), myHand:$('#myHand'),
  pile0:$('#pile0'), pile1:$('#pile1'),
  cpuStock:$('#cpuStock'), myStock:$('#myStock'),
  myDeck:$('#myDeck'), cpuDeck:$('#cpuDeck'),
  centerMsg:$('#centerMsg'), hudTime:$('#hudTime'), hudDiff:$('#hudDiff'),
  resultTitle:$('#resultTitle'), resultText:$('#resultText'), resultRecord:$('#resultRecord'),
  pauseOverlay:$('#pauseOverlay'), rulesOverlay:$('#rulesOverlay'), resetOverlay:$('#resetOverlay'),
  version:$('#version'),
};

/* ========== 保存（設定・記録） ========== */
const STORE_KEY = 'speed-card-game/v1';
const store = loadStore();

function loadStore(){
  const base = { opts:{ diff:'normal', color:'red', hint:false, sound:true, draw:false }, recs:{} };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && raw.opts) return { opts:{ ...base.opts, ...raw.opts }, recs: raw.recs || {} };
  } catch (e) { /* 壊れていたら初期値で始める */ }
  return base;
}
function saveStore(){ try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {} }
// 山札ありは別ゲームなので記録も分けて持つ
const recKey = d => (drawMode ? d + '+draw' : d);
function recOf(key){
  return store.recs[key] || (store.recs[key] = { best:null, bestLeft:null, wins:0, streak:0, bestStreak:0 });
}

/* ========== 状態 ========== */
let diffKey = 'normal';
let hintOn  = false;
let drawMode = false;
let myColor = 'red';
let soundOn = true;
let S = null;
let cpuTimer = null, stuckTimer = null, tickTimer = null, countTimer = null;

const label = r => RANK_LABEL[r] || String(r);
const shuffle = a => { for (let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]; } return a; };
const rand = (a,b) => a + Math.random()*(b-a);

/* ========== 音とふるえ ========== */
let audio = null;
function ensureAudio(){
  if (audio || !soundOn) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) audio = new AC();
}
function beep(freq, dur, type = 'square', vol = 0.05, delay = 0){
  if (!soundOn) return;
  ensureAudio();
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume();
  const t = audio.currentTime + delay;
  const osc = audio.createOscillator(), gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain); gain.connect(audio.destination);
  osc.start(t); osc.stop(t + dur + 0.02);
}
function buzz(pattern){ if (soundOn && navigator.vibrate) navigator.vibrate(pattern); }

const SFX = {
  play(){ beep(880, 0.09);                     buzz(12); },
  cpu(){  beep(430, 0.07, 'sine', 0.035); },
  ng(){   beep(150, 0.16, 'sawtooth', 0.045);  buzz(45); },
  flip(){ beep(520, 0.10, 'triangle', 0.05); beep(780, 0.10, 'triangle', 0.04, 0.07); },
  tick(){ beep(660, 0.05, 'sine', 0.045); },
  win(){  [523,659,784,1047].forEach((f,i) => beep(f, 0.16, 'triangle', 0.06, i*0.12)); buzz([40,60,40]); },
  lose(){ [392,330,262].forEach((f,i) => beep(f, 0.24, 'sine', 0.05, i*0.17));          buzz(80); },
};

/* ========== カードとルール ========== */
function buildDeck(color){
  const cards = [];
  for (const suit of SUITS[color]) for (let r=1;r<=13;r++) cards.push({ rank:r, suit, color });
  return shuffle(cards);
}

/* 台札の一番上と1つ違いなら出せる（A と K もつながる） */
function canPlace(card, pile){
  if (!card || !pile.length) return false;
  const d = Math.abs(card.rank - pile[pile.length-1].rank);
  return d === 1 || d === 12;
}

function movesOf(side){
  const hand = S.p[side].hand, out = [];
  for (let i=0;i<4;i++){
    if (!hand[i]) continue;
    for (let p=0;p<2;p++) if (canPlace(hand[i], S.center[p])) out.push({ i, p });
  }
  return out;
}

const remaining = side => S.p[side].stock.length + S.p[side].hand.filter(Boolean).length;

/* ========== ゲーム進行 ========== */
function startGame(){
  clearTimers();
  el.pauseOverlay.classList.remove('show');
  const mine = buildDeck(myColor), theirs = buildDeck(myColor === 'red' ? 'black' : 'red');
  S = {
    p: {
      me:  { hand:[mine.pop(),   mine.pop(),   mine.pop(),   mine.pop()],   stock:mine   },
      cpu: { hand:[theirs.pop(), theirs.pop(), theirs.pop(), theirs.pop()], stock:theirs },
    },
    center: [[], []],          // center[0]=あなた側が出す台札 / center[1]=あいて側
    selected: null,
    running: true,
    paused: false,
    pauseAt: 0,
    startAt: performance.now(),
    frozenAt: 0,               // 「せーの！」の間は時間を止める
    lastTop: [null, null],
    recycles: 0,
  };
  el.hudDiff.textContent = DIFF[diffKey].label;
  el.hudTime.textContent = '0.0秒';
  el.centerMsg.textContent = 'せーの！';
  render();

  // 掛け声のあと、両者が1枚ずつ場に出してスタート
  setTimeout(() => { if (S && S.running && !S.paused) beginPlay(); }, 900);
}

function beginPlay(){
  S.startAt = performance.now();   // はじめの「せーの！」も時間に入れない
  el.centerMsg.textContent = '';
  flipCenter();
  if (S && S.running) startLoops();
}

function startLoops(){
  scheduleCpu(rand(DIFF[diffKey].min, DIFF[diffKey].max));
  tickTimer  = setInterval(updateTime, 97);
  stuckTimer = setInterval(checkStuck, 220);
}

function flipCenter(){
  let flipped = 0;
  ['me','cpu'].forEach((side, idx) => {
    const p = S.p[side];
    if (p.stock.length){ S.center[idx].push(p.stock.pop()); flipped++; }
  });
  if (!flipped && !recycle()) return;   // 山札が尽きていたら台札を回収して再配分
  autoRefill('me'); autoRefill('cpu');
  SFX.flip();
  render();
}

/* 両者の山札が尽きて動けないとき: 台札に埋まった札を持ち主へ戻す */
function recycle(){
  const buried = [...S.center[0].slice(0,-1), ...S.center[1].slice(0,-1)];
  // 誰も1枚も出せないまま回収が続くなら、それ以上は進まないので枚数で決着
  if (!buried.length || ++S.recycles > 3){ judgeByCount(); return false; }
  S.center[0] = S.center[0].slice(-1);
  S.center[1] = S.center[1].slice(-1);
  for (const c of buried) S.p[c.color === myColor ? 'me' : 'cpu'].stock.push(c);
  shuffle(S.p.me.stock); shuffle(S.p.cpu.stock);
  autoRefill('me'); autoRefill('cpu');
  flash('ふだを まぜなおし！');
  ['me','cpu'].forEach((side, idx) => {
    if (S.p[side].stock.length) S.center[idx].push(S.p[side].stock.pop());
  });
  return true;
}

function judgeByCount(){
  const me = remaining('me'), cpu = remaining('cpu');
  finish(me < cpu ? 'me' : cpu < me ? 'cpu' : 'draw');
}

function refill(side){
  const p = S.p[side];
  for (let i=0;i<4;i++) if (!p.hand[i] && p.stock.length) p.hand[i] = p.stock.pop();
}

// 「やまふだ あり」では自動で補充しない（自分でタップして引く）
function autoRefill(side){ if (!drawMode) refill(side); }

const canDraw = side => S.p[side].stock.length > 0 && S.p[side].hand.includes(null);

function drawOne(side){
  const p = S.p[side];
  if (!canDraw(side)) return false;
  for (let i=0;i<4;i++) if (!p.hand[i]){ p.hand[i] = p.stock.pop(); break; }
  return true;
}

// その人がまだ何かできるか（出せる or 引ける）
function canAct(side){ return movesOf(side).length > 0 || (drawMode && canDraw(side)); }

function play(side, i, p){
  const card = S.p[side].hand[i];
  if (!card || !canPlace(card, S.center[p])) return false;
  S.p[side].hand[i] = null;
  S.center[p].push(card);
  autoRefill(side);
  S.recycles = 0;
  if (side === 'me'){ S.selected = null; SFX.play(); } else { SFX.cpu(); }
  render();
  if (remaining(side) === 0) finish(side);
  return true;
}

function finish(winner){
  if (!S || !S.running) return;
  S.running = false;
  const sec = +((performance.now() - S.startAt) / 1000).toFixed(1);
  clearTimers();
  el.centerMsg.textContent = '';

  // 記録を更新
  const rec = recOf(recKey(diffKey));
  const left = remaining('cpu');       // 勝ったときに相手が持っていた まい数（多いほど大差）
  let newBest = false, newLeft = false;
  if (winner === 'me'){
    rec.wins++; rec.streak++;
    if (rec.streak > rec.bestStreak) rec.bestStreak = rec.streak;
    if (rec.best === null || sec < rec.best){ rec.best = sec; newBest = true; }
    if (rec.bestLeft == null || left > rec.bestLeft){ rec.bestLeft = left; newLeft = true; }
  } else {
    rec.streak = 0;
  }
  saveStore();
  updateRecords();

  const win = winner === 'me';
  el.resultTitle.textContent = winner === 'draw' ? '引き分け' : win ? '勝ち！' : '負け…';
  el.resultTitle.style.color = winner === 'draw' ? '#cfd8dc' : win ? '#f2c14e' : '#ef9a9a';
  el.resultText.innerHTML = winner === 'draw'
    ? `決着 つかず。<br>${sec}秒`
    : `${DIFF[diffKey].label}　${sec}秒<br>` +
      (win ? `相手の のこり ${left}まい` : `あなたの のこり ${remaining('me')}まい`);

  const lines = [];
  if (newBest) lines.push('🎉 いままでで 一番 速い！');
  else if (rec.best !== null) lines.push(`ベスト ${rec.best}秒`);
  if (newLeft) lines.push('🎉 いままでで 一番 大きな 差！');
  else if (rec.bestLeft != null) lines.push(`ベスト 相手 ${rec.bestLeft}まい`);
  if (rec.streak >= 2) lines.push(`${rec.streak}回 つづけて 勝ち`);
  el.resultRecord.innerHTML = lines.join('<br>');

  (win ? SFX.win : SFX.lose)();
  // 最後の1枚を見せてから結果画面へ（その間にやめられていたら出さない）
  setTimeout(() => { if ($('#gameScreen').classList.contains('active')) show('result'); }, 700);
}

function clearTimers(){
  clearTimeout(cpuTimer); clearInterval(stuckTimer); clearInterval(tickTimer); clearInterval(countTimer);
  cpuTimer = stuckTimer = tickTimer = countTimer = null;
}

/* ========== ひとやすみ（中断・再開） ========== */
function freeze(){ if (S && !S.frozenAt) S.frozenAt = performance.now(); }
function unfreeze(){
  if (!S || !S.frozenAt) return;
  S.startAt += performance.now() - S.frozenAt;   // 止めていた分は時間に入れない
  S.frozenAt = 0;
}

function pause(){
  if (!S || !S.running || S.paused) return;
  unfreeze();                  // 止めていた分をここで清算しておく
  S.paused = true;
  S.pauseAt = performance.now();
  clearTimers();
  el.centerMsg.textContent = '';
  el.pauseOverlay.classList.add('show');
}

function resume(){
  if (!S || !S.paused) return;
  S.paused = false;
  S.startAt += performance.now() - S.pauseAt;   // 止まっていた分は時間に入れない
  el.pauseOverlay.classList.remove('show');
  if (!S.center[0].length && !S.center[1].length) beginPlay();   // まだ1枚も出ていない
  else startLoops();
}

function quit(){
  clearTimers();
  el.pauseOverlay.classList.remove('show');
  S = null;
  show('title');
}

/* ========== あいて（CPU） ========== */
function scheduleCpu(ms){
  clearTimeout(cpuTimer);
  cpuTimer = setTimeout(cpuTurn, ms);
}

function cpuTurn(){
  if (!S || !S.running || S.paused) return;
  const d = DIFF[diffKey];
  const moves = movesOf('cpu');
  if (!moves.length){
    // 出せないときは、あいても1タップぶん時間をかけて山札から引く
    if (drawMode && canDraw('cpu')){ drawOne('cpu'); SFX.cpu(); render(); scheduleCpu(rand(d.min, d.max)); return; }
    scheduleCpu(200); return;
  }
  if (Math.random() < d.miss){ scheduleCpu(rand(d.min, d.max)); return; }  // 見落とし
  const [i, p] = pick(moves, d.smart);
  play('cpu', i, p);
  if (S && S.running) scheduleCpu(rand(d.min, d.max));
}

function pick(moves, smart){
  if (!smart){ const m = moves[(Math.random()*moves.length)|0]; return [m.i, m.p]; }
  // 出したあと自分の手が続きやすい手を選ぶ
  let best = moves[0], bestScore = -1;
  for (const m of moves){
    const card = S.p.cpu.hand[m.i];
    const other = S.center[1-m.p];
    let score = 0;
    for (let k=0;k<4;k++){
      const h = S.p.cpu.hand[k];
      if (!h || k === m.i) continue;
      const d1 = Math.abs(h.rank - card.rank);
      if (d1 === 1 || d1 === 12) score += 2;   // 出した札の上に重ねられる
      if (canPlace(h, other)) score += 1;
    }
    if (score > bestScore){ bestScore = score; best = m; }
  }
  return [best.i, best.p];
}

/* ========== 手詰まり判定 ========== */
function checkStuck(){
  if (!S || !S.running || S.paused) return;
  if (canAct('me') || canAct('cpu')) return;
  clearInterval(stuckTimer); stuckTimer = null;
  clearTimeout(cpuTimer);
  freeze();

  let left = Math.round(STUCK_WAIT / 1000);
  const paint = () => {
    el.centerMsg.innerHTML = `せーの！<span class="count">${left}</span>`;
    SFX.tick();
  };
  paint();
  countTimer = setInterval(() => {
    if (!S || !S.running || S.paused){ clearInterval(countTimer); countTimer = null; return; }
    if (--left > 0){ paint(); return; }
    clearInterval(countTimer); countTimer = null;
    unfreeze();
    el.centerMsg.textContent = '';
    flipCenter();
    if (!S || !S.running) return;
    scheduleCpu(rand(DIFF[diffKey].min, DIFF[diffKey].max));
    stuckTimer = setInterval(checkStuck, 220);
  }, 1000);
}

function flash(msg){
  el.centerMsg.textContent = msg;
  setTimeout(() => { if (el.centerMsg.textContent === msg) el.centerMsg.textContent = ''; }, 900);
}

/* ========== 描画 ========== */
function cardHTML(card, cls){
  if (!card) return '<div class="card empty"></div>';
  const t = label(card.rank);
  return `<div class="card ${card.color} ${cls || ''}">
    <div class="corner">${t}<br>${card.suit}</div>
    <div class="rank">${t}</div><div class="suit">${card.suit}</div></div>`;
}

function render(){
  if (!S) return;

  el.cpuHand.innerHTML = S.p.cpu.hand.map(c => cardHTML(c)).join('');
  el.myHand.innerHTML = S.p.me.hand.map((c, i) => {
    let cls = '';
    if (S.selected === i) cls += ' selected';
    if (hintOn && c && (canPlace(c, S.center[0]) || canPlace(c, S.center[1]))) cls += ' hint';
    return `<div class="slot" data-hand="${i}">${cardHTML(c, cls)}</div>`;
  }).join('');

  [el.pile0, el.pile1].forEach((node, p) => {
    const pile = S.center[p], top = pile[pile.length-1] || null;
    const changed = top !== S.lastTop[p];
    S.lastTop[p] = top;
    const sel = S.selected !== null ? S.p.me.hand[S.selected] : null;
    node.classList.toggle('target', !!(sel && canPlace(sel, pile)));
    node.innerHTML = cardHTML(top, changed ? 'pop' : '') +
      (pile.length > 1 ? `<span class="pile-count">${pile.length}</span>` : '');
  });

  [['me', el.myDeck], ['cpu', el.cpuDeck]].forEach(([side, node]) => {
    const n = S.p[side].stock.length;
    node.innerHTML = `<div class="card back ${n ? '' : 'gone'}"></div>` +
      (n ? `<span class="deck-count">${n}</span>` : '');
  });

  el.myStock.textContent  = `のこり ${remaining('me')}まい`;
  el.cpuStock.textContent = `のこり ${remaining('cpu')}まい`;
}

function updateTime(){
  if (!S || !S.running || S.paused || S.frozenAt) return;
  el.hudTime.textContent = ((performance.now() - S.startAt) / 1000).toFixed(1) + '秒';
}

// つよさボタンの右に、そのつよさの記録を出す（山札ありのときは そのモードの記録）
function updateRecords(){
  for (const d of Object.keys(DIFF)){
    const node = document.querySelector(`[data-rec="${d}"]`);
    if (!node) continue;
    const rec = store.recs[recKey(d)];
    node.innerHTML = rec && rec.best !== null
      ? `ベスト<br>${rec.best}秒` + (rec.bestLeft != null ? `<br>相手 ${rec.bestLeft}まい` : '')
      : '<span class="none">きろく<br>なし</span>';
  }
}

function shakeSlot(i){
  const c = el.myHand.querySelector(`[data-hand="${i}"] .card`);
  if (!c) return;
  c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
  SFX.ng();
}

/* ========== 操作 ========== */
const playable = () => S && S.running && !S.paused;

el.myHand.addEventListener('click', e => {
  if (!playable()) return;
  const slot = e.target.closest('[data-hand]');
  if (!slot) return;
  const i = +slot.dataset.hand;
  if (!S.p.me.hand[i]) return;

  // 左右どちらに出すかは必ずプレイヤーが選ぶ（選択 → 台札をタップ）
  S.selected = (S.selected === i) ? null : i;
  render();
});

el.myDeck.addEventListener('click', () => {
  if (!playable() || !drawMode) return;
  if (!drawOne('me')){                      // 引けないときは知らせるだけ
    const c = el.myDeck.querySelector('.card');
    if (c){ c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
    SFX.ng();
    return;
  }
  SFX.play();
  render();
});

[el.pile0, el.pile1].forEach(node => node.addEventListener('click', () => {
  if (!playable()) return;
  const p = +node.dataset.pile;
  if (S.selected !== null){
    const i = S.selected;
    if (!play('me', i, p)) shakeSlot(i);
    return;
  }
  for (let i=0;i<4;i++) if (canPlace(S.p.me.hand[i], S.center[p])){ play('me', i, p); return; }
}));

/* ========== タイトル画面の選択 ========== */
function markSel(key, value){
  document.querySelectorAll(`[data-${key}]`).forEach(b => {
    const on = b.dataset[key] === value;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-checked', String(on));
  });
}

document.querySelectorAll('.diff-btn').forEach(btn => btn.addEventListener('click', () => {
  diffKey = store.opts.diff = btn.dataset.diff;
  markSel('diff', diffKey);
  saveStore();
}));

document.querySelectorAll('.seg-btn').forEach(btn => btn.addEventListener('click', () => {
  if (btn.dataset.color){ myColor = store.opts.color = btn.dataset.color; markSel('color', myColor); }
  if (btn.dataset.draw){
    drawMode = store.opts.draw = btn.dataset.draw === 'on';
    markSel('draw', btn.dataset.draw);
    document.body.classList.toggle('draw', drawMode);
    updateRecords();
  }
  if (btn.dataset.hint){ hintOn = store.opts.hint = btn.dataset.hint === 'on'; markSel('hint', btn.dataset.hint); }
  if (btn.dataset.sound){
    soundOn = store.opts.sound = btn.dataset.sound === 'on';
    markSel('sound', btn.dataset.sound);
    if (soundOn){ ensureAudio(); SFX.play(); }
  }
  saveStore();
}));

/* ========== 画面遷移 ========== */
function show(screen){
  for (const name of ['title','game','result'])
    document.getElementById(name + 'Screen').classList.toggle('active', name === screen);
}

$('#startBtn').addEventListener('click', () => { ensureAudio(); show('game'); startGame(); });
$('#retryBtn').addEventListener('click', () => { show('game'); startGame(); });
$('#toTitleBtn').addEventListener('click', () => { clearTimers(); S = null; show('title'); });
$('#backBtn').addEventListener('click', pause);
$('#resumeBtn').addEventListener('click', resume);
$('#quitBtn').addEventListener('click', quit);
$('#resetBtn').addEventListener('click', () => el.resetOverlay.classList.add('show'));
$('#resetNoBtn').addEventListener('click', () => el.resetOverlay.classList.remove('show'));
$('#resetYesBtn').addEventListener('click', () => {
  store.recs = {};
  saveStore();
  updateRecords();
  el.resetOverlay.classList.remove('show');
});

$('#rulesBtn').addEventListener('click', () => el.rulesOverlay.classList.add('show'));
$('#helpBtn').addEventListener('click', () => { pause(); el.rulesOverlay.classList.add('show'); });
$('#closeRulesBtn').addEventListener('click', () => el.rulesOverlay.classList.remove('show'));

// 画面を離れたら自動でひとやすみ（不利にならないように）
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

/* ========== 起動 ========== */
diffKey = store.opts.diff;
myColor = store.opts.color;
hintOn  = store.opts.hint;
soundOn = store.opts.sound;
drawMode = store.opts.draw;
document.body.classList.toggle('draw', drawMode);
markSel('diff', diffKey);
markSel('draw', drawMode ? 'on' : 'off');
markSel('color', myColor);
markSel('hint', hintOn ? 'on' : 'off');
markSel('sound', soundOn ? 'on' : 'off');
updateRecords();
el.version.textContent = APP_VERSION;

if ('serviceWorker' in navigator)
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
