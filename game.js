(() => {
'use strict';

/* ========== 定数 ========== */
const RANK_LABEL = { 1:'A', 11:'J', 12:'Q', 13:'K' };
const SUITS = { red:['♥','♦'], black:['♠','♣'] };

const DIFF = {
  easy:   { label:'やさしい',   min:1000, max:1700, miss:0.40, smart:false },
  normal: { label:'ふつう',     min:520,  max:900,  miss:0.15, smart:false },
  hard:   { label:'むずかしい', min:230,  max:400,  miss:0.02, smart:true  },
};

const STUCK_WAIT = 5000;   // 出せる札がなくなってから場に出すまでの溜め

const $ = sel => document.querySelector(sel);
const el = {
  titleScreen:$('#titleScreen'), gameScreen:$('#gameScreen'),
  cpuHand:$('#cpuHand'), myHand:$('#myHand'),
  pile0:$('#pile0'), pile1:$('#pile1'),
  cpuStock:$('#cpuStock'), myStock:$('#myStock'),
  centerMsg:$('#centerMsg'), hudTime:$('#hudTime'), hudDiff:$('#hudDiff'),
  resultOverlay:$('#resultOverlay'), resultTitle:$('#resultTitle'), resultText:$('#resultText'),
  rulesOverlay:$('#rulesOverlay'),
};

/* ========== 状態 ========== */
let diffKey = 'normal';
let hintOn = false;
let S = null;
let cpuTimer = null, stuckTimer = null, tickTimer = null, countTimer = null;

const label = r => RANK_LABEL[r] || String(r);
const shuffle = a => { for (let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]; } return a; };

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
  const mine = buildDeck('red'), theirs = buildDeck('black');
  S = {
    p: {
      me:  { hand:[mine.pop(),   mine.pop(),   mine.pop(),   mine.pop()],   stock:mine   },
      cpu: { hand:[theirs.pop(), theirs.pop(), theirs.pop(), theirs.pop()], stock:theirs },
    },
    center: [[], []],          // center[0]=あなた側が出す台札 / center[1]=CPU側
    selected: null,
    running: true,
    startAt: performance.now(),
    lastTop: [null, null],
    recycles: 0,
  };
  el.hudDiff.textContent = DIFF[diffKey].label;
  el.hudTime.textContent = '0.0秒';
  el.centerMsg.textContent = 'せーの！';
  render();

  // 掛け声のあと、両者が1枚ずつ場に出してスタート
  setTimeout(() => {
    if (!S || !S.running) return;
    el.centerMsg.textContent = '';
    flipCenter();
    if (!S.running) return;
    scheduleCpu(DIFF[diffKey].min);
    tickTimer = setInterval(updateTime, 97);
    stuckTimer = setInterval(checkStuck, 220);
  }, 900);
}

function flipCenter(){
  let flipped = 0;
  ['me','cpu'].forEach((side, idx) => {
    const p = S.p[side];
    if (p.stock.length){ S.center[idx].push(p.stock.pop()); flipped++; }
  });
  if (!flipped && !recycle()) return;   // 山札が尽きていたら台札を回収して再配分
  refill('me'); refill('cpu');
  render();
}

/* 両者の山札が尽きて動けないとき: 台札に埋まった札を持ち主へ戻す */
function recycle(){
  const buried = [...S.center[0].slice(0,-1), ...S.center[1].slice(0,-1)];
  // 誰も1枚も出せないまま回収が続くなら、それ以上は進まないので枚数で決着
  if (!buried.length || ++S.recycles > 3){ judgeByCount(); return false; }
  S.center[0] = S.center[0].slice(-1);
  S.center[1] = S.center[1].slice(-1);
  for (const c of buried) S.p[c.color === 'red' ? 'me' : 'cpu'].stock.push(c);
  shuffle(S.p.me.stock); shuffle(S.p.cpu.stock);
  refill('me'); refill('cpu');
  flash('台札をシャッフル！');
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

function play(side, i, p){
  const card = S.p[side].hand[i];
  if (!card || !canPlace(card, S.center[p])) return false;
  S.p[side].hand[i] = null;
  S.center[p].push(card);
  refill(side);
  S.recycles = 0;
  if (side === 'me') S.selected = null;
  render();
  if (remaining(side) === 0) finish(side);
  return true;
}

function finish(winner){
  if (!S || !S.running) return;
  S.running = false;
  const sec = ((performance.now() - S.startAt) / 1000).toFixed(1);
  clearTimers();
  el.centerMsg.textContent = '';
  const win = winner === 'me';
  el.resultTitle.textContent = winner === 'draw' ? 'DRAW' : win ? 'WIN!' : 'LOSE…';
  el.resultTitle.style.color = winner === 'draw' ? '#cfd8dc' : win ? '#f2c14e' : '#ef9a9a';
  el.resultText.innerHTML = winner === 'draw'
    ? `決着つかず。<br>タイム ${sec}秒`
    : `${DIFF[diffKey].label} / タイム ${sec}秒<br>` +
      (win ? `CPUの残り ${remaining('cpu')}枚` : `あなたの残り ${remaining('me')}枚`);
  setTimeout(() => el.resultOverlay.classList.add('show'), 450);
}

function clearTimers(){
  clearTimeout(cpuTimer); clearInterval(stuckTimer); clearInterval(tickTimer); clearInterval(countTimer);
  cpuTimer = stuckTimer = tickTimer = countTimer = null;
}

/* ========== CPU ========== */
function scheduleCpu(ms){
  clearTimeout(cpuTimer);
  cpuTimer = setTimeout(cpuTurn, ms);
}

function cpuTurn(){
  if (!S || !S.running) return;
  const d = DIFF[diffKey];
  const moves = movesOf('cpu');
  if (!moves.length){ scheduleCpu(180); return; }
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

const rand = (a,b) => a + Math.random()*(b-a);

/* ========== 手詰まり判定 ========== */
function checkStuck(){
  if (!S || !S.running) return;
  if (movesOf('me').length || movesOf('cpu').length) return;
  clearInterval(stuckTimer); stuckTimer = null;
  clearTimeout(cpuTimer);

  let left = Math.round(STUCK_WAIT / 1000);
  const show = () => { el.centerMsg.innerHTML = `せーの！<span class="count">${left}</span>`; };
  show();
  countTimer = setInterval(() => {
    if (!S || !S.running){ clearInterval(countTimer); countTimer = null; return; }
    if (--left > 0){ show(); return; }
    clearInterval(countTimer); countTimer = null;
    el.centerMsg.textContent = '';
    flipCenter();
    if (!S || !S.running) return;
    scheduleCpu(DIFF[diffKey].min);
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
  const hint = hintOn;

  el.cpuHand.innerHTML = S.p.cpu.hand.map(c => cardHTML(c)).join('');
  el.myHand.innerHTML = S.p.me.hand.map((c, i) => {
    let cls = '';
    if (S.selected === i) cls += ' selected';
    if (hint && c && (canPlace(c, S.center[0]) || canPlace(c, S.center[1]))) cls += ' hint';
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

  el.myStock.textContent  = `残り ${remaining('me')}枚`;
  el.cpuStock.textContent = `残り ${remaining('cpu')}枚`;
}

function updateTime(){
  if (!S || !S.running) return;
  el.hudTime.textContent = ((performance.now() - S.startAt) / 1000).toFixed(1) + '秒';
}

function shakeSlot(i){
  const c = el.myHand.querySelector(`[data-hand="${i}"] .card`);
  if (!c) return;
  c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
}

/* ========== 操作 ========== */
el.myHand.addEventListener('click', e => {
  if (!S || !S.running) return;
  const slot = e.target.closest('[data-hand]');
  if (!slot) return;
  const i = +slot.dataset.hand;
  const card = S.p.me.hand[i];
  if (!card) return;

  // 左右どちらに出すかは必ずプレイヤーが選ぶ（選択 → 台札をタップ）
  S.selected = (S.selected === i) ? null : i;
  render();
});

[el.pile0, el.pile1].forEach(node => node.addEventListener('click', () => {
  if (!S || !S.running) return;
  const p = +node.dataset.pile;
  if (S.selected !== null){
    const i = S.selected;
    if (!play('me', i, p)) shakeSlot(i);
    return;
  }
  for (let i=0;i<4;i++) if (canPlace(S.p.me.hand[i], S.center[p])){ play('me', i, p); return; }
}));

/* ========== 画面遷移 ========== */
document.querySelectorAll('.diff-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.diff-btn').forEach(b => {
    const on = b === btn;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-checked', String(on));
  });
  diffKey = btn.dataset.diff;
}));

document.querySelectorAll('.seg-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.seg-btn').forEach(b => {
    const on = b === btn;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-checked', String(on));
  });
  hintOn = btn.dataset.hint === 'on';
}));

function show(screen){
  el.titleScreen.classList.toggle('active', screen === 'title');
  el.gameScreen.classList.toggle('active', screen === 'game');
}

$('#startBtn').addEventListener('click', () => { show('game'); startGame(); });
$('#retryBtn').addEventListener('click', () => { el.resultOverlay.classList.remove('show'); startGame(); });
$('#toTitleBtn').addEventListener('click', () => {
  el.resultOverlay.classList.remove('show'); clearTimers(); S = null; show('title');
});
$('#backBtn').addEventListener('click', () => {
  clearTimers(); if (S) S.running = false; S = null; show('title');
});
$('#rulesBtn').addEventListener('click', () => el.rulesOverlay.classList.add('show'));
$('#helpBtn').addEventListener('click', () => el.rulesOverlay.classList.add('show'));
$('#closeRulesBtn').addEventListener('click', () => el.rulesOverlay.classList.remove('show'));

// バックグラウンドに回ったら中断（不利にならないように）
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S && S.running){
    clearTimers(); S.running = false; el.centerMsg.textContent = '中断しました';
  }
});
})();
