// =====================================================================
// ゲットリッチ復活 v2 — 画面
// ・ルールの計算はしない。台帳(S)を表示し、エンジンが返す演出(effects)を順番に再生するだけ。
// ・人間の操作は「行動」にしてエンジンへ渡す。CPUの番は GR.ai に行動を決めてもらう。
// ・将来のスマホ同期では act() の中で行動を相手端末にも送るだけでよい。
// =====================================================================
(function () {
  const K = GR.CONFIG, E = GR.engine, R = GR.rules, AI = GR.ai, T = K.TIMING, FX = GR.fx, AU = GR.audio, ACT = GR.actors;
  const warping = new Set();   // ワープ中の人（移動を一瞬で済ませる）
  const $ = (id) => document.getElementById(id);
  const SPEEDS = [1, 2, 4];
  let speedIdx = 0;
  try { speedIdx = Math.max(0, SPEEDS.indexOf(Number(localStorage.getItem('gr_speed')) || 1)); } catch (e) { /* 無視 */ }
  const speed = () => SPEEDS[speedIdx];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms / speed()));
  const LATE_TURN = Math.ceil(K.BALANCE.maxTurns * 0.8); // 終盤戦の開始ターン
  const BS = 480, CR = 60;

  let S = null;          // 正式な台帳
  let D = null;          // 表示中の盤面（演出の途中経過）
  let playing = false;   // 演出再生中
  let debugOn = false, forcedDie = null, debugEvent = null;
  let prevAssets = null, prevRanks = null;
  let prevReach = null, prevMono = null, lateShown = false;
  // ===== 友達対戦 =====
  const NET = GR.net;
  let online = false;            // 友達対戦中
  const remoteQ = [];            // 親：演出中に届いた子の操作
  const clientQ = [];            // 子：親から届いた結果（順番に再生）
  let clientBusy = false;
  // 「自分」かどうか（ひとりで遊ぶ時は人間＝自分。友達対戦では自分の席だけ）
  const isMe = (i) => (online ? i === NET.seat : !!(S && S.players[i] && S.players[i].isHuman));
  const meIdx = () => (S ? S.players.findIndex((_, i) => isMe(i)) : -1);

  // ================= 行動の送信 =================
  async function act(action, remote) {
    // 子：操作は親に送るだけ（結果は親から届く）
    if (online && NET.mode === 'client') { if (playing || clientBusy) return; hideAllPrompts(); NET.sendAct(action); return; }
    if (playing) { if (remote) remoteQ.push(action); return; } // 親：演出中に届いた子の操作は後で処理
    const r = E.dispatch(S, action);
    if (r.error) { console.warn('行動エラー:', r.error, action); return; }
    hideAllPrompts(); // 選択画面は送信した瞬間に閉じる（二度押し防止）
    S = r.state;
    if (online && NET.mode === 'host') NET.broadcast({ t: 'step', state: S, effects: r.effects }); // 結果を全員に配る
    playing = true;
    try { await playEffects(r.effects); }
    finally { playing = false; }
    for (const pi of [...warping]) { warping.delete(pi); ACT.warpIn(pi); }
    D = view(S);
    renderAll();
    next();
    if (remoteQ.length && !playing) act(remoteQ.shift(), true);
  }
  // 子：親から届いた結果を順番に再生する
  async function pumpClient() {
    if (clientBusy) return;
    clientBusy = true;
    try {
      while (clientQ.length) {
        const m = clientQ.shift();
        hideAllPrompts();
        S = m.state;
        playing = true;
        try { await playEffects(m.effects); } finally { playing = false; }
        for (const pi of [...warping]) { warping.delete(pi); ACT.warpIn(pi); }
        D = view(S); renderAll();
      }
    } finally { clientBusy = false; }
    next();
  }
  function view(s) { return { players: s.players, cells: s.cells, current: s.current, turn: s.turn }; }
  // 友達の番を待っている時のひとこと
  function showWaiting(pi) {
    const p = S.players[pi], th = $('tap-hint');
    if (th) th.textContent = `${p.name}の番です…`;
  }

  // 次に誰が何をするかを見て、CPUなら考えさせ、人間なら入力を待つ
  function next() {
    hideAllPrompts();
    if (S.winner) { showWin(); return; }
    const who = E.whoActs(S);
    if (!who) return;
    const p = S.players[who.player];
    if (!p.isHuman) {
      if (online && NET.mode === 'client') { showWaiting(who.player); return; } // CPUは親が動かす
      setTimeout(() => { const a = AI.decide(S); if (a) act(a); }, who.kind === 'roll' ? T.cpuThink : T.cpuChoice);
      return;
    }
    if (!isMe(who.player)) { showWaiting(who.player); return; } // 友達の番：待つ
    if (who.kind === 'roll') { setRoll(true); return; }
    const pd = S.pending;
    if (pd.kind === 'buy') openBuy(pd);
    else if (pd.kind === 'sell') openSell(pd);
    else if (pd.kind === 'cell') startCellSelect(pd.options, pd.title, (id) => act({ type: 'choose', player: pd.player, value: id }));
    else if (pd.kind === 'player') openTargetSelect(pd);
    else if (pd.kind === 'pickCard') openPickCard(pd);
    else if (pd.kind === 'roof') openRoof(pd);
    else if (pd.kind === 'gamer') openGamer(pd);
    else if (pd.kind === 'pickEvent') openPickEvent(pd);
  }

  // ================= 移動中のマス表示 =================
  // 今いるマスを持ち主の色で光らせ、残り歩数を大きく出す（どのマスで跳ねているか分かるように）
  let stepLeft = 0;
  function markStep(pi, landed) {
    const p = D.players[pi], c = cellDiv(p.pos); if (!c) return;
    document.querySelectorAll('#board-rotated .cell.step-on').forEach((x) => { if (x !== c) x.classList.remove('step-on', 'land-on'); });
    c.style.setProperty('--pc', p.color);
    if (landed) {
      delete c.dataset.step; c.classList.remove('step-on'); retrigger(c, 'land-on');
      setTimeout(() => c.classList.remove('land-on'), 1400);
      stepLeft = 0; return;
    }
    if (stepLeft > 0) stepLeft--;
    retrigger(c, 'step-on');
    clearTimeout(c._stepT);
    c._stepT = setTimeout(() => { c.classList.remove('step-on'); delete c.dataset.step; }, 1500);
  }

  // ================= 演出の再生 =================
  // 勝利が決まった購入（リーチのマスを買った等）は、買収・建設・リーチ・独占の演出を飛ばして、すぐ勝利画面へ
  //   win の直前の「購入（build）」と、その前の支払い・マス更新までを「静かに処理する区間」にする
  function quietStart(list) {
    const w = list.findIndex((e) => e.t === 'win');
    if (w < 0) return Infinity;
    let b = -1;
    for (let i = w - 1; i >= 0; i--) { if (list[i].t === 'build') { b = i; break; } if (['dice', 'pos', 'land', 'turn'].includes(list[i].t)) break; }
    if (b < 0) return w;
    let i = b;
    while (i > 0 && ['money', 'cell', 'log', 'charge', 'sync'].includes(list[i - 1].t)) i--;
    return i;
  }
  async function playEffects(list) {
    const qs = quietStart(list);
    for (let qi = 0; qi < list.length; qi++) {
      const e = list[qi];
      if (e.s) D = e.s;
      if (qi >= qs && e.t !== 'win' && e.t !== 'log') { // 勝利直前：演出なしで盤面だけ更新
        if (['cell', 'build', 'sync', 'money', 'charge'].includes(e.t)) { renderBoard(); renderPanels(); announceBoardChanges(true); }
        continue;
      }
      switch (e.t) {
        case 'log': addLog(e.msg); break;
        case 'dice': stepLeft = e.total; await showDice(e); break;
        case 'pos':
          if (warping.has(e.p)) { ACT.sync(D); ACT.place(e.p); renderBoard(); await sleep(30); }
          else { const h = ACT.hop(e.p, () => { AU.se('step'); markStep(e.p); }); await h; }
          break;
        case 'land':
          if (warping.has(e.p)) { warping.delete(e.p); AU.se('whoosh'); await ACT.warpIn(e.p); }
          markStep(e.p, true);
          await ACT.land(e.p);
          if (e.p === D.current) ACT.camera(e.p, 1.04, 650);
          break;
        case 'warp':
          if (!warping.has(e.p)) { warping.add(e.p); AU.se('plane'); await ACT.flyTo(e.p, e.to); }
          break;
        case 'money': renderPanels(); showMoneyFloat(e.p, e.delta); break;
        case 'charge': renderPanels(); chargeFx(e); break;
        case 'gacha': await showGacha(e); break;
        case 'stat': // 科目マス・研究棟（文字は engine の banner で出る）
          AU.se(e.fail ? 'bad' : 'event');
          if (e.p != null) ACT.react(e.p, e.fail ? 'sad' : 'happy', 'big');
          break;
        case 'chance':
          AU.se(e.tone === 'bad' ? 'bad' : 'event');
          if (e.p != null) ACT.react(e.p, e.tone === 'bad' ? 'sad' : 'happy', 'big');
          await FX.chanceCard({ icon: e.icon, title: e.name, desc: e.desc, tone: e.tone });
          break;
        case 'cell': renderBoard(); renderPanels(); await announceBoardChanges(); break;
        case 'transfer': await showTransfer(e); break;
        case 'build': await showBuild(e); break;
        case 'lap': await showLap(e); break;
        case 'rest':
          AU.se('bad'); ACT.sync(D); ACT.react(e.p, 'sad', 'big');
          await FX.banner({ text: '1回休み…', sub: `${D.players[e.p].name}（${e.why}）`, tone: 'bad', face: face(e.p, 'sad'), dur: 1100 });
          break;
        case 'restAll': // まとめて1回休みの演出（現在は未使用）
          AU.se('bad'); ACT.sync(D); e.ps.forEach((i) => ACT.react(i, 'sad', 'big'));
          await FX.banner({ text: '全員1回休み！', sub: e.ps.map((i) => D.players[i].name).join('・'), tone: 'bad', face: face(e.by, 'happy'), dur: 1400, big: true });
          break;
        case 'bankrupt':
          AU.se('bad'); FX.shake($('root'), 12, 600);
          ACT.sync(D);
          await FX.banner({ text: '破産…', sub: `${D.players[e.p].name}：総資産すべて支払い（ゲームオーバー）`, tone: 'bad', face: face(e.p, 'sad'), dur: 1700, big: true });
          break;
        case 'banner':
          AU.se(e.tone === 'bad' ? 'bad' : e.tone === 'good' ? 'cash' : 'coin');
          if (e.p != null) ACT.react(e.p, e.tone === 'bad' ? 'sad' : 'happy', 'big');
          await FX.banner({ text: e.text, sub: e.sub, tone: e.tone, face: e.p != null ? face(e.p, e.tone === 'bad' ? 'sad' : 'happy') : null, dur: 1300 });
          break;
        case 'shake': await destroyFx(e.id); break;
        case 'splash': await showSplash(e); break;
        case 'flash': await glowFlash(); break;
        case 'turn': await showTurn(e); break;
        case 'sync': renderAll(); await announceBoardChanges(); break;
        case 'win':
          renderAll(); ACT.finale(e.p); break;
        case 'error': console.error('エンジン警告:', e.msg); break;
      }
    }
  }
  const face = (pi, state) => spriteHtml(D.players[pi].char, state, 110, 'fx-face-spr');
  const panelPt = (pi) => FX.center($('pp' + pi));
  const tokenPt = (pi) => FX.center($('token' + pi));
  const boardPt = () => FX.center($('ctrl-panel'));

  async function showTurn(e) {
    renderPanels(); renderBoard(); $('dsum').textContent = '—';
    if (!lateShown && D.turn >= LATE_TURN) {
      lateShown = true;
      document.body.classList.add('late');
      AU.bgm('late'); AU.se('reach');
      await FX.banner({ text: '終盤戦 突入！', sub: 'スキルゲージを溜めて逆転を狙え！', tone: 'late', dur: 2000, big: true });
    }
    const p = D.players[e.p];
    AU.se('turn');
    ACT.spotlight(e.p);
    ACT.react(e.p, 'cheer');
    FX.turnBanner({ name: p.name, face: spriteHtml(p.char, e.again ? 'happy' : 'idle', 84, 'fx-face-spr'), color: p.color, isHuman: isMe(e.p), again: e.again, sub: e.gamer ? `🎮ゲーマーの意地 あと${e.gamer}回` : (p.fx && p.fx.gamerLeft > 0 && !e.again ? `🎮ゲーマーの意地 ${p.fx.gamerLeft}回連続` : '') });
    // 自分のターン：演出の途中でもサイコロを振れるように、終わるのを待たない（振ったら演出は消える）
    // CPUも演出の終わりを待たない：演出開始から約1秒（cpuThink）でサイコロを投げる
    await sleep(150);
  }
  async function showTransfer(e) {
    const skillish = ['追い越し略奪', '具現化', '突然の旅立ち'].includes(e.why);
    const from = panelPt(e.from), to = e.to >= 0 ? panelPt(e.to) : boardPt();
    const n = Math.min(14, 4 + Math.floor(e.amount / 120));
    const strong = e.amount >= 200 ? 'big' : 'small';
    if (e.why === '追い越し略奪') { ACT.afterimage(e.to); ACT.react(e.from, 'sad', 'small'); }
    else ACT.react(e.from, 'sad', skillish ? 'small' : strong);
    if (e.to >= 0) ACT.react(e.to, 'happy', strong);
    // 他人の不幸は蜜の味：高額の支払いを見た周りの人がニヤッとする
    if (!skillish && e.amount >= 400) {
      D.players.forEach((op, oi) => { if (oi !== e.from && oi !== e.to && !op.bankrupt) setTimeout(() => ACT.react(oi, 'smirk'), (120 + oi * 90) / speed()); });
    }
    if (skillish) { AU.se('coin'); await FX.coins(from, to, n); return; }
    const big = e.amount >= 400;
    if (big) {
      AU.se('bigPay');
      if (e.amount >= 800) FX.shake($('root'), 10, 500);
      const banner = FX.banner({ text: `${e.why} ${e.amount.toLocaleString()}M！`, sub: e.to >= 0 ? `${D.players[e.from].name} → ${D.players[e.to].name}` : D.players[e.from].name, tone: 'rent', face: face(e.from, 'sad'), dur: 1300 });
      await FX.coins(from, to, n);
      await banner;
    } else {
      AU.se('pay');
      FX.pop(tokenPt(e.from).x, tokenPt(e.from).y - 20, `-${e.amount}M`, 'bad', 0.9);
      await FX.coins(from, to, n);
    }
    if (e.to >= 0) AU.se('coin');
  }
  async function showBuild(e) {
    const div = cellDiv(e.id), pt = FX.center(div), p = D.players[e.p], d = R.def(e.id);
    ACT.react(e.p, 'happy', e.mode === 'acquire' || e.level >= 3 ? 'big' : 'small');
    if (e.mode === 'acquire') ACT.react(e.from, 'sad', 'big');
    if (e.mode === 'acquire' || e.level >= 3) ACT.camera(e.p, 1.08, 900);
    if (div) FX.bounceEl(div.querySelector('.vertical-asset'), 1.6, 600);
    FX.burst(pt.x, pt.y, [p.color, '#fff', '#ffd23f'], e.level >= 3 ? 30 : 16, e.level >= 3 ? 140 : 80);
    if (e.mode === 'skill') {
      AU.se('build'); FX.flash('#fff6c0', 200);
      FX.pop(pt.x, pt.y - 10, '奪取！', 'gold', 1); // さこう「具現化」でマスを奪った
      await sleep(550);
    } else if (e.mode === 'acquire') {
      AU.se('acquire'); FX.flash('#ff3d3d', 300);
      const coinsP = FX.coins(panelPt(e.p), panelPt(e.from), 10);
      await FX.banner({ text: '買収！', sub: `${p.name}が${D.players[e.from].name}から「${d.name}」を奪った！`, tone: 'rent', face: face(e.p, 'happy'), dur: 1400 });
      await coinsP;
    } else if (e.level >= 3) {
      AU.se('landmark'); FX.confetti(70, 2200); FX.flash('#fff6c0', 400);
      await FX.banner({ text: 'ランドマーク建設！！', sub: `${p.name}「${d.name}」 通行料が大幅アップ`, tone: 'gold', face: face(e.p, 'happy'), dur: 1700, big: true });
    } else {
      AU.se('build');
      FX.pop(pt.x, pt.y - 10, e.mode === 'tourist' ? '観光地ゲット！' : `${K.LEVEL_NAMES[e.level]}建設！`, 'gold', 0.9);
      await sleep(450);
    }
  }
  async function showLap(e) {
    AU.se('lap'); ACT.react(e.p, 'happy', 'small');
    const pt = tokenPt(e.p);
    FX.pop(pt.x, pt.y - 30, `+${e.amount}M 周回ボーナス！`, 'gold', 1);
    FX.burst(pt.x, pt.y, ['#ffd23f', '#fff'], 14, 70);
    await FX.coins(boardPt(), panelPt(e.p), 6);
  }
  async function destroyFx(id) {
    const pt = FX.center(cellDiv(id));
    if (D.cells[id].owner >= 0) ACT.react(D.cells[id].owner, 'sad', 'big');
    AU.se('boom');
    FX.shake($('root'), 14, 700);
    FX.burst(pt.x, pt.y, ['#ff7a18', '#ffd23f', '#777', '#fff'], 28, 130);
    await shakeCell(id);
  }
  // リーチ・独占が新しく成立したら知らせる
  async function announceBoardChanges(quiet) {
    const reach = D.players.map((p, i) => new Set(p.bankrupt ? [] : R.reaches(D, i)));
    const mono = D.players.map((p, i) => new Set(p.bankrupt ? [] : R.monopolyColors(D, i)));
    const oldR = prevReach, oldM = prevMono;
    prevReach = reach; prevMono = mono;
    if (!oldR || quiet) return;
    for (let i = 0; i < D.players.length; i++) {
      for (const c of mono[i]) if (!oldM[i].has(c)) {
        AU.se('cash'); ACT.react(i, 'happy', 'big');
        await FX.banner({ text: `${K.COLOR_NAME[c]}エリア独占！`, sub: `${D.players[i].name}　この色の通行料がすべて2倍に`, tone: 'good', face: face(i, 'happy'), dur: 1300 });
      }
      for (const r of reach[i]) if (!oldR[i].has(r)) {
        AU.se('reach'); FX.flash('#ffd23f', 250); ACT.react(i, 'happy', 'big'); ACT.camera(i, 1.08, 900);
        await FX.banner({ text: 'リーチ！', sub: `${D.players[i].name}：${r.replace('リーチ🔥 ', '')}まであと一歩！`, tone: 'gold', face: face(i, 'happy'), dur: 1500, big: true });
      }
    }
  }

  // ================= 盤面 =================
  // マスの位置：角4つ（K.CORNERS）と、その間に1辺 N マス。マス数を変えても自動で並ぶ
  // マスの幅の比率：科目マス（本）は少し大きく
  const CELL_WT = (id) => (R.def(id).type === 'study' ? 1.4 : 1);
  // 辺の中での位置：slotIds は並び順（i=0 から）。科目マスの分だけ他のマスが少し細くなる
  function slotSpan(slotIds, id) {
    const L = BS - CR * 2, W = slotIds.reduce((a, x) => a + CELL_WT(x), 0), u = L / W;
    let off = 0;
    for (const x of slotIds) { if (x === id) return { off: off * u, len: CELL_WT(x) * u }; off += CELL_WT(x); }
    return { off: 0, len: L / slotIds.length };
  }
  function cpos(id) {
    const [c0, c1, c2, c3] = K.CORNERS, n = c1 - c0 - 1;
    const rng = (a) => Array.from({ length: n }, (_, i) => a + i);
    if (id === c0) return { x: BS - CR, y: BS - CR, w: CR, h: CR, side: 'corner' };
    if (id === c1) return { x: 0, y: BS - CR, w: CR, h: CR, side: 'corner' };
    if (id === c2) return { x: 0, y: 0, w: CR, h: CR, side: 'corner' };
    if (id === c3) return { x: BS - CR, y: 0, w: CR, h: CR, side: 'corner' };
    if (id < c1) { const s = slotSpan(rng(c0 + 1).reverse(), id); return { x: CR + s.off, y: BS - CR, w: s.len, h: CR, side: 'bottom' }; }
    if (id < c2) { const s = slotSpan(rng(c1 + 1), id); return { x: 0, y: BS - CR - s.off - s.len, w: CR, h: s.len, side: 'left' }; }
    if (id < c3) { const s = slotSpan(rng(c2 + 1), id); return { x: CR + s.off, y: 0, w: s.len, h: CR, side: 'top' }; }
    const s = slotSpan(rng(c3 + 1), id); return { x: BS - CR, y: CR + s.off, w: CR, h: s.len, side: 'right' };
  }
  function shade(hex, amt) {
    let c = hex.replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const n = parseInt(c, 16);
    const ch = [(n >> 16) + amt, ((n >> 8) & 0xff) + amt, (n & 0xff) + amt].map((v) => Math.max(0, Math.min(255, v)));
    return '#' + ch.map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  const TYPE_CLASS = { start: 'start-cell', island: 'island-cell', quake: 'quake-cell', travel: 'travel-cell', lab: 'lab-cell', chance: 'chance-cell', study: 'chance-cell study-cell', tax: 'tax-cell', tourist: 'tourist-cell' };

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  // ================= キャラのアニメ（待機・移動・喜ぶ・悲しむ） =================
  // 横長のコマ画像を、CSSで1コマずつ送って再生する
  const TOKEN_H = 64;
  function spriteStyle(char, state, h) {
    const a = K.SPRITES[char][state], w = Math.round((a.w * h) / a.h);
    const steps = a.loop ? a.n : a.n - 1;
    return `--w:${w}px;--h:${h}px;--n:${a.n};--steps:${steps};--dur:${a.ms}ms;--anim:${a.loop ? 'spr-loop' : 'spr-once'};--iter:${a.loop ? 'infinite' : '1'};background-image:url('${a.src}')`;
  }
  function spriteHtml(char, state, h, cls = '') { return `<div class="spr ${cls}" style="${spriteStyle(char, state, h)}"></div>`; }
  // 画像を先に読み込んでおく（状態を切り替えた瞬間に消えないように）
  function preloadSprites() {
    Object.values(K.SPRITES).forEach((c) => Object.values(c).forEach((a) => { const i = new Image(); i.src = a.src; }));
  }

  let labRisen = false; // 研究棟が立ち上がる演出は最初の1回だけ
  function renderBoard() {
    const bd = $('board-rotated');
    [...bd.children].forEach((c) => { if (c.id !== 'ctrl-panel' && !c.classList.contains('token') && !c.classList.contains('board-deco')) c.remove(); });
    if (!$('board-sheet')) { const sh = el('div', 'board-deco', GR.blueprint.sheet()); sh.id = 'board-sheet'; bd.prepend(sh); }
    // 手番の人のリーチマス（そこを取れば勝ち）を光らせる
    const cp = D.players[D.current], reachSet = new Set(cp && !cp.bankrupt && !D.winner ? R.reachCells(D, D.current) : []);
    const decoQueue = [];
    K.BOARD.forEach((d) => {
      const id = d.id, c = D.cells[id], p = cpos(id);
      const div = el('div', 'cell ' + (TYPE_CLASS[d.type] || 'prop-cell'));
      div.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;position:absolute;`;
      div.dataset.cellId = id;
      if (d.type === 'prop') div.classList.add('prop');
      const corner = K.CORNERS.includes(id);
      if (corner) div.classList.add('corner-cell');
      const mono = R.isMonopoly(D, id);
      if (d.type === 'prop') {
        const bar = el('div', 'cbar'), hex = K.COLOR_HEX[d.color], w = mono ? 9 : 6;
        bar.style.background = hex; bar.style.color = hex;
        const pos = { bottom: `top:0;left:0;right:0;height:${w}px;width:100%`, top: `bottom:0;left:0;right:0;height:${w}px;width:100%`, left: `right:0;top:0;bottom:0;width:${w}px;height:100%`, right: `left:0;top:0;bottom:0;width:${w}px;height:100%` }[p.side];
        bar.style.cssText += ';' + pos;
        div.appendChild(bar);
        if (mono) { div.classList.add('mono'); div.style.setProperty('--mono', hex); }
      }
      const hasBld = c.owner >= 0 && (d.type === 'tourist' || (d.type === 'prop' && c.level > 0));
      const icon = hasBld || d.type === 'study' ? null : GR.blueprint.icon(d.name) || GR.blueprint.icon(d.type);
      if (d.type === 'study') { div.classList.add('book', 'book-' + p.side); div.appendChild(el('div', 'book-spine')); div.appendChild(el('div', 'book-pages')); div.appendChild(el('div', 'book-ribbon')); }
      const parts = [];
      if (icon) parts.push(el('div', 'cell-icon', icon));
      const nm = el('div', 'cname'); nm.textContent = d.name; parts.push(nm);
      if (d.sub || d.tax) { const sb = el('div', 'csub'); sb.textContent = d.sub || `-${d.tax}M`; parts.push(sb); }
      if (d.type === 'prop' && !hasBld) { const sp = el('div', 'cspec'); sp.textContent = GR.blueprint.spec(d); parts.push(sp); }
      if (d.type === 'start') parts.unshift(el('div', 'cstamp', '着工'));
      const wrapCls = corner ? 'corner-content' : (p.side === 'left' || p.side === 'right') ? 'cell-content-rot' : null;
      if (wrapCls) { const w = el('div', wrapCls); parts.forEach((x) => w.appendChild(x)); div.appendChild(w); }
      else parts.forEach((x) => div.appendChild(x));
      if (hasBld) div.appendChild(assetIcon(d, c));
      // 通行料の倍率バッジ：独占×2・大炎上/げきりん・ワールドカップ・黄砂をまとめて「通行料×4」のように1つで大きく表示（盤面の内側に向けて置く）
      if (c.wc) div.classList.add('wc');
      if (c.sand) div.classList.add('sand');
      if (c.owner >= 0) {
        let f = (mono ? 2 : 1) * (c.mul > 1 ? c.mul : 1) * (c.wc ? 2 : 1); if (c.sand) f /= 2;
        if (f !== 1) {
          const why = (mono ? '👑' : '') + (c.mul > 1 ? '🔥' : '') + (c.wc ? '🏆' : '') + (c.sand ? '🌪' : '');
          // マスの外（盤面の内側）に別の要素として浮かせる：四隅の絵や隣のマスに隠れないように
          const b = el('div', 'rentx-deco' + (f >= 4 ? ' big' : f < 1 ? ' down' : ''), `<span class="rx-why">${why}</span><span class="rx-f">×${f < 1 ? '½' : f}</span>`);
          const g = 11, at = { bottom: [p.x + p.w / 2, p.y - g], top: [p.x + p.w / 2, p.y + p.h + g], left: [p.x + p.w + g, p.y + p.h / 2], right: [p.x - g, p.y + p.h / 2] }[p.side] || [p.x + p.w / 2, p.y + p.h / 2];
          b.style.left = at[0] + 'px'; b.style.top = at[1] + 'px';
          decoQueue.push(b);
        }
      }
      // 四隅の特別なマス：大きく表示して、それぞれの絵を立てる
      if (corner) div.classList.add('cnr-' + ['b', 'l', 't', 'r'][K.CORNERS.indexOf(id)]);
      // 研究棟・設計課題・敷地調査は、用意した絵（マス名入り）を立てて表示
      const cimg = K.CORNER_IMG && K.CORNER_IMG[d.type];
      if (cimg) {
        div.classList.add('deco');
        // 大きくしたマス（内側の角を基準に1.3倍）の見た目の中心に置く
        const side = ['b', 'l', 't', 'r'][K.CORNERS.indexOf(id)], k = 1.3;
        const ox = side === 'b' || side === 'r' ? p.x : p.x + p.w, oy = side === 'b' || side === 'l' ? p.y : p.y + p.h;
        const cx = ox + k * (p.x + p.w / 2 - ox), cy = oy + k * (p.y + p.h / 2 - oy);
        const deco = el('div', 'corner-deco lab-bld masu-' + d.type + (labRisen ? '' : ' rise'), `<div class="masu-img" role="img" aria-label="${d.name}" style="background-image:url('${cimg}')"></div>`);
        // 盤面の中心側（内側の角）へ少し寄せる。絵の中心をそこに合わせる
        const t = d.type === 'start' ? 0 : 0.15, ax = cx + t * (ox - cx), ay = cy + t * (oy - cy);
        deco.style.left = ax + 'px'; deco.style.top = ay + 'px';
        decoQueue.push(deco);
      }
      if (d.type === 'travel') labRisen = true;
      if (reachSet.has(id)) { div.classList.add('reach-cell'); div.style.setProperty('--rc', cp.color); div.appendChild(el('div', 'reach-tag', '🔥リーチ')); }
      div.style.cursor = 'pointer';
      div.onclick = () => showCellInfo(id); // どのマスもタップで詳しい情報（何マス先か・値段・通行料など）
      bd.appendChild(div);
    });
    decoQueue.forEach((x) => bd.appendChild(x)); // 四隅の絵はマスより後（手前）に置く
    ACT.sync(D);
    $('tn').textContent = Math.min(D.turn, K.BALANCE.maxTurns);
  }
  function assetIcon(d, c) {
    const vw = el('div', 'vertical-asset'), col = D.players[c.owner].color;
    // 建物は白模型、持ち主の色は敷地板で示す
    const w = el('div', 'cbld-wrap', d.type === 'prop' ? GR.blueprint.building(c.level, col) : GR.blueprint.flag(col));
    vw.appendChild(w);
    return vw;
  }

  // ================= プレイヤーパネル =================
  function renderPanels() {
    const cur = D.players.map((_, i) => R.totalAssets(D, i));
    if (prevAssets) cur.forEach((v, i) => assetFloat(i, v - prevAssets[i]));
    prevAssets = cur;
    const rk = R.ranks(D);
    const rankUp = prevRanks ? D.players.map((p, i) => !p.bankrupt && prevRanks.indexOf(i) > rk.indexOf(i)) : [];
    prevRanks = rk;
    ACT.sync(D);
    const late = D.turn >= LATE_TURN;
    D.players.forEach((p, i) => {
      const box = $('pp' + i); if (!box) return;
      // 立ち絵（左）と数字（右）。立ち絵は消さずに使い回す
      let main = box.querySelector(':scope > .pp-main');
      if (!main) { box.innerHTML = ''; main = el('div', 'pp-main'); box.append(main); }
      if (rankUp[i]) ACT.react(i, 'happy', 'small');
      // 終盤の最下位は「スキル来い…」と祈る
      const praying = late && !p.bankrupt && rk.length >= 2 && rk.indexOf(i) === rk.length - 1;
      const owned = R.ownedIds(D, i);
      const props = owned.filter((id) => R.def(id).type === 'prop');
      const tours = owned.filter((id) => R.def(id).type === 'tourist');
      const active = i === D.current && !p.bankrupt;
      const reaches = p.bankrupt ? [] : R.reaches(D, i);
      const effects = [];
      if (p.fx.gamerNext) effects.push('🎮次ターン3連'); if (p.fx.gamerOn || p.fx.gamerLeft > 0) effects.push(`🎮残り${p.fx.gamerLeft}回`); if (p.fx.genjitsuka) effects.push('💰具現化'); if (p.fx.typhoon) effects.push('🌀台風'); if (p.fx.steady) effects.push('🎯狙い通り'); if (p.fx.insured) effects.push('🧯保険'); if (p.fx.overtake) effects.push('💰追い越し略奪'); if (p.fx.megaBuy) effects.push('🏰なんでも買収');
      if (p.fx.angel) effects.push('😇天使'); if (p.fx.fixedRoll) effects.push(`🎲次は${p.fx.fixedRoll}`); if (p.fx.waitFor != null) effects.push('🛏待機中'); if (p.fx.coupon) effects.push('🎟半額'); if (p.fx.noBankrupt) effects.push('☀️夏'); if (p.skip) effects.push('🏝休み');
      // スキルゲージ（お金を払うと溜まる。満タンでターンの最初に使える）と手札（スタート通過でガチャ）
      const chg = Math.max(0, Math.min(100, p.charge || 0)), hand = p.hand || [];
      const full = chg >= 100 && !p.bankrupt;
      // パネルはシンプルに：所持金・総資産・スキルゲージ（棒だけ）・手札。細かい情報はパネルをタップした詳細画面で
      const chance = `<div class="pp-gauge${full ? ' full' : ''}" title="スキルゲージ ${Math.floor(chg)}%"><div class="pp-gauge-bar"><i style="width:${chg}%"></i></div></div>`
        // 手札：自分のカードだけ中身が見える（タップで説明）。他の人は裏向き
        + `<div class="pp-hand">${[0, 1, 2].map((k) => hand[k] == null ? '<span class="pp-card empty"></span>'
          : isMe(i) ? `<span class="pp-card mine" data-card="${hand[k]}" title="${K.EVENTS[hand[k]].name}">${K.EVENTS[hand[k]].icon}</span>`
          : '<span class="pp-card back" title="何のカードかは分からない">?</span>').join('')}</div>`;
      box.className = 'pp pp-photo' + (reaches.length ? ' reach' : '') + (isMe(i) ? ' is-you' : '') + (active ? ' active' : '') + (p.bankrupt ? ' bankrupt' : '');
      box.style.borderColor = active ? p.color : p.color + '66';
      // キャラクター画像を枠いっぱいに透かして敷く
      box.style.setProperty('--pc', p.color);
      box.style.setProperty('--photo', `url('${K.CHARACTERS[p.char].img}')`);
      box.style.background = '';
      main.innerHTML = `<div class="pp-top"><div class="pp-dot" style="background:${p.color}"></div><div class="pp-name">${p.name}${p.bankrupt ? ' 💀' : ''}</div><div class="pp-rank${rankUp[i] ? ' up' : ''}" style="background:${p.color}">${p.bankrupt ? '-' : rk.indexOf(i) + 1}位</div></div>
        <div class="pp-row"><span>所持金</span><span class="pp-val" style="color:${p.money < 0 ? '#E24B4A' : '#eee'}">${p.money.toLocaleString()}M</span></div>
        <div class="pp-row"><span>総資産</span><span class="pp-val">${cur[i].toLocaleString()}M</span></div>
        ${chance}`;
      // リーチ中はキャラクター画の枠の下に「リーチ🔥」（パネルの外側、枠の真下）
      { const wrap = box.parentElement; let rb = wrap && wrap.querySelector('.pp-reach-out'); if (wrap && !rb) { rb = el('div', 'pp-reach-out', 'リーチ🔥'); wrap.appendChild(rb); } if (rb) rb.classList.toggle('on', !!reaches.length); }
    });
  }
  function renderAll() { renderBoard(); renderPanels(); }

  // ================= 小さな演出 =================
  function addLog(msg) { const bx = $('log-wrap'); const d = el('div', 'll'); d.textContent = msg; bx.prepend(d); while (bx.children.length > 300) bx.lastChild.remove(); bx.scrollTop = 0; } // 一番上が最新
  function floatText(pi, delta, cls, ms) {
    if (!delta) return;
    const panel = $('pp' + pi); if (!panel) return;
    const f = el('div', cls + ' ' + (delta > 0 ? 'pos' : 'neg'));
    f.textContent = (delta > 0 ? '+' : '') + delta.toLocaleString() + 'M';
    panel.appendChild(f); setTimeout(() => f.remove(), ms);
  }
  const showMoneyFloat = (pi, d) => floatText(pi, d, 'money-float', 1150);
  const assetFloat = (pi, d) => floatText(pi, d, 'assets-float', 1700);
  function retrigger(node, cls) { if (!node) return; node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
  function cellDiv(id) { return document.querySelector(`#board-rotated .cell[data-cell-id="${id}"]`); }
  async function shakeCell(id) {
    retrigger($('board-rotated'), 'quake-shake');
    retrigger(cellDiv(id), 'quake-wobble');
    await sleep(T.quakeShake);
    const c = cellDiv(id); if (c) { c.classList.remove('quake-wobble'); retrigger(c, 'quake-impact'); }
  }
  // 画像の先読み：iPhoneでは初めて出す画像の読み込み・展開が間に合わず、ポップアップが空のまま消えることがあった
  //   → キャラ選択画面の時点で、ポップアップに使う画像を全部読み込んでおく
  const imgCache = new Map();
  function preloadImg(src) {
    if (!src || imgCache.has(src)) return imgCache.get(src);
    const im = new Image(); im.decoding = 'async'; im.src = src;
    const ready = (im.decode ? im.decode() : new Promise((r) => { im.onload = r; im.onerror = r; })).catch(() => {});
    imgCache.set(src, { im, ready });
    return imgCache.get(src);
  }
  function preloadAll() {
    K.EVENTS.forEach((e) => preloadImg(e.img));
    Object.values(K.CHARACTERS).forEach((c) => { preloadImg(c.skillImg); preloadImg(c.img); });
    Object.values(K.IMAGES || {}).forEach(preloadImg);
    Object.values(K.CORNER_IMG || {}).forEach(preloadImg);
  }
  // スキル・イベント画像のポップアップ
  //   以前はCSSアニメを「止めて→付け直す」方法で毎回やり直していたが、iPhone（Safari）では
  //   続けて出した時にアニメがやり直されず、最後の「透明」の状態のまま＝画像が見えないことがあった。
  //   → 毎回JavaScriptでアニメを新しく作る方式（ガチャ演出と同じ）に変更。終わったら必ず消す
  let splashAnims = [];
  let splashSeq = 0;
  async function showSplash(e) {
    const mySeq = ++splashSeq;
    const ov = $('skill-splash'), img = $('skill-splash-img'), rays = $('skill-splash-rays');
    splashAnims.forEach((a) => a.cancel()); splashAnims = [];
    preloadImg(e.img);
    img.src = e.img;
    const quake = e.kind === 'quake';
    let D = Math.max(2500, (quake ? T.quakeSplash : T.splash) / speed()); // 速度設定に関係なく最低2.5秒
    if (e.kind === 'event') D = Math.round(D * 0.75); // イベントカードは短め（0.75倍）
    ov.classList.add('show', 'js'); ov.classList.toggle('quake', quake);
    ov.classList.toggle('cut', e.kind === 'skill'); // スキル画像は背景が透明（切り抜き）なので、四角い光ではなく輪郭に沿って光らせる
    ov.classList.toggle('ev', e.kind === 'event'); // イベントカードは画面いっぱい
    // 画面に収まる最大の正方形の大きさを、毎回その時の画面サイズから計算して指定する（dvh 非対応の端末や画面回転でも確実に）
    if (e.kind === 'event') { const sz = Math.floor(Math.min(innerWidth, (window.visualViewport ? visualViewport.height : innerHeight))); img.style.width = sz + 'px'; img.style.height = sz + 'px'; img.style.maxWidth = 'none'; img.style.maxHeight = 'none'; }
    else { img.style.width = img.style.height = img.style.maxWidth = img.style.maxHeight = ''; }
    // スキル：キャラごとのテーマ背景（さこう＝お金とビール／さだ＝氷／すぎうら＝ゲーム／おくだ＝旅とオーロラ）
    const theme = e.kind === 'skill' ? skillTheme(e.img) : null;
    if (theme) ov.dataset.theme = theme; else delete ov.dataset.theme;
    let bgl = $('skill-splash-bg');
    if (!bgl) { bgl = el('div', ''); bgl.id = 'skill-splash-bg'; ov.prepend(bgl); }
    bgl.className = theme ? 'th-' + theme : ''; bgl.innerHTML = theme ? themeParticles(theme) : '';
    if (theme) splashAnims.push(bgl.animate([{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.86 }, { opacity: 0 }], { duration: D, fill: 'forwards' }));
    const bg = quake ? 'rgba(30,5,0,.9)' : 'rgba(10,0,30,.92)', flashC = quake ? 'rgba(255,80,0,.9)' : 'rgba(255,255,255,.85)';
    splashAnims.push(ov.animate([{ backgroundColor: 'rgba(0,0,0,0)' }, { backgroundColor: flashC, offset: 0.07 }, { backgroundColor: bg, offset: 0.18 }, { backgroundColor: bg, offset: 0.86 }, { backgroundColor: 'rgba(0,0,0,0)' }], { duration: D, fill: 'forwards' }));
    const imgK = quake
      ? [{ transform: 'scale(.3) rotate(-15deg)', opacity: 0 }, { transform: 'scale(1.15) rotate(2deg) translate(2px,-2px)', opacity: 1, offset: 0.16 }, { transform: 'scale(1.1) rotate(-1deg) translate(-3px,2px)', opacity: 1, offset: 0.22 }, { transform: 'scale(1.05) rotate(1deg) translate(2px,1px)', opacity: 1, offset: 0.27 }, { transform: 'scale(1)', opacity: 1, offset: 0.32 }, { transform: 'scale(1)', opacity: 1, offset: 0.88 }, { transform: 'scale(1.2)', opacity: 0 }]
      : [{ transform: 'scale(.3) rotate(-15deg)', opacity: 0 }, { transform: 'scale(1.12) rotate(2deg)', opacity: 1, offset: 0.15 }, { transform: 'scale(1) rotate(0deg)', opacity: 1, offset: 0.25 }, { transform: 'scale(1)', opacity: 1, offset: 0.88 }, { transform: 'scale(1.2)', opacity: 0 }];
    splashAnims.push(img.animate(imgK, { duration: D, easing: 'ease-out', fill: 'forwards' }));
    splashAnims.push(rays.animate([{ opacity: 0, transform: 'rotate(0deg) scale(1)' }, { opacity: 0.8, offset: 0.15 }, { opacity: 0.6, offset: 0.85 }, { opacity: 0, transform: 'rotate(140deg) scale(1.3)' }], { duration: D, fill: 'forwards' }));
    // 文字は画像に入っているので、ポップアップには文字を重ねない
    if (quake) { AU.se('quake'); FX.shake($('root'), 16, 1400); }
    else if (e.kind === 'skill') { AU.se('skill'); FX.flash('#ffffff', 300); }
    else AU.se('event');
    await sleepReal(D);
    if (splashSeq !== mySeq) return; // 次のポップアップが始まっていたら、片付けはそちらに任せる（途中で小さくならないように）
    splashAnims.forEach((a) => a.cancel()); splashAnims = [];
    ov.classList.remove('show', 'quake', 'js', 'cut', 'ev');
    img.style.width = img.style.height = img.style.maxWidth = img.style.maxHeight = '';
    delete ov.dataset.theme; if (bgl) { bgl.className = ''; bgl.innerHTML = ''; }
  }
  // スキル画像 → キャラのテーマ
  const THEME_OF = { 'さこう': 'money', 'さだ': 'ice', 'すぎうら': 'game', 'おくだ': 'trip' };
  function skillTheme(img) {
    const n = K.CHAR_ORDER.find((c) => K.CHARACTERS[c].skillImg === img);
    return (n && THEME_OF[n]) || null;
  }
  // テーマごとの飛び物（CSSアニメで動かす。--x 横位置 / --dl 遅れ / --du 長さ / --sz 大きさ / --dx,--dy 飛ぶ方向）
  function themeParticles(th) {
    const R = Math.random, out = [];
    const add = (cls, ch, n, extra) => { for (let i = 0; i < n; i++) { const a = R() * Math.PI * 2, dist = 35 + R() * 45; out.push(`<i class="pt ${cls}" style="--x:${(R() * 100).toFixed(1)}%;--y:${(R() * 100).toFixed(1)}%;--dl:${(R() * 1.6).toFixed(2)}s;--du:${(1.6 + R() * 1.8).toFixed(2)}s;--sz:${(0.7 + R() * 1.1).toFixed(2)};--dx:${(Math.cos(a) * dist).toFixed(1)}vmax;--dy:${(Math.sin(a) * dist).toFixed(1)}vmax;--rt:${Math.floor(R() * 720 - 360)}deg${extra ? ';' + extra(i) : ''}">${ch(i)}</i>`); } };
    if (th === 'money') { add('fall', (i) => ['🪙', '💰', '¥', '🪙', '💴'][i % 5], 22); add('rise bub', () => '', 18); }
    if (th === 'ice') { add('fall slow', (i) => ['❄', '❅', '❆'][i % 3], 24); add('burst shard', () => '', 16); }
    if (th === 'game') { add('burst px', () => '', 30, (i) => `--c:${['#ff4b4a', '#ffd23f', '#4bd1ff', '#7dff6a', '#ffffff'][i % 5]}`); add('fall slow ch', (i) => ['▶', '★', '♥', '●', '■'][i % 5], 12); }
    if (th === 'trip') { add('fly', () => '✈', 6); add('tw', () => '✦', 26); }
    return `<div class="ss-glow"></div>${out.join('')}`;
  }
  const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
  async function glowFlash() { retrigger($('glow-flash'), 'active'); await sleep(T.flash); $('glow-flash').classList.remove('active'); }

  // ================= サイコロ =================
  const PIPS = { 1: ['p-mc'], 2: ['p-tl', 'p-br'], 3: ['p-tl', 'p-mc', 'p-br'], 4: ['p-tl', 'p-tr', 'p-bl', 'p-br'], 5: ['p-tl', 'p-tr', 'p-mc', 'p-bl', 'p-br'], 6: ['p-tl', 'p-tr', 'p-ml', 'p-mr', 'p-bl', 'p-br'] };
  const ROT = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
  const dieRot = { 1: { x: 0, y: 0 }, 2: { x: 0, y: 0 } };
  let spinAnim = null;
  function buildDie(node) {
    for (let f = 1; f <= 6; f++) { const face = el('div', 'die-face f' + f); PIPS[f].forEach((p) => face.appendChild(el('div', 'pip ' + p))); node.appendChild(face); }
  }
  function setDieFace(node, v) { node.style.transition = 'none'; node.style.transform = `rotateX(${ROT[v][0]}deg) rotateY(${ROT[v][1]}deg)`; }
  function startSpin() {
    cancelAnimationFrame(spinAnim);
    [1, 2].forEach((i) => { dieRot[i].x = 0; dieRot[i].y = 0; $('die' + i).style.transition = 'none'; });
    const loop = () => {
      dieRot[1].x += 11.2; dieRot[1].y += 17.6; dieRot[2].x += 14.4; dieRot[2].y += 12.8;
      [1, 2].forEach((i) => ($('die' + i).style.transform = `rotateX(${dieRot[i].x}deg) rotateY(${dieRot[i].y}deg)`));
      spinAnim = requestAnimationFrame(loop);
    };
    spinAnim = requestAnimationFrame(loop);
  }
  // ゲージを止めたら：サイコロが跳ね上がり、回りながら落ちてきて、着地で目が決まる
  function tossDie(i, v, ms, delay) {
    const node = $('die' + i), wrap = node.parentElement, r = dieRot[i], [x, y] = ROT[v];
    const d = ms / speed(), dl = (delay || 0) / speed();
    const side = i === 1 ? -1 : 1;
    wrap.animate([
      { transform: 'translate(0,0) scale(1)', easing: 'cubic-bezier(.2,.8,.4,1)' },
      { transform: `translate(${side * 6}px,-78px) scale(1.45)`, offset: 0.42, easing: 'cubic-bezier(.6,0,.9,.5)' },
      { transform: `translate(${side * 2}px,0) scale(1.12,.86)`, offset: 0.72, easing: 'ease-out' },
      { transform: `translate(0,-14px) scale(1.04)`, offset: 0.84, easing: 'ease-in' },
      { transform: 'translate(0,0) scale(1)' },
    ], { duration: d, delay: dl, fill: 'none' });
    // 空中で回転 → 着地の瞬間に目が上を向く
    r.x += (((x - r.x) % 360) + 360) % 360 + 360 * 3;
    r.y += (((y - r.y) % 360) + 360) % 360 + 360 * 2;
    node.style.transition = `transform ${d * 0.72}ms cubic-bezier(.2,.7,.3,1) ${dl}ms`;
    requestAnimationFrame(() => (node.style.transform = `rotateX(${r.x}deg) rotateY(${r.y}deg)`));
    setTimeout(() => AU.se('diceStop'), dl + d * 0.72);
    setTimeout(() => AU.se('diceStop'), dl + d * 0.98);
    return new Promise((res) => setTimeout(res, dl + d));
  }
  // テスト用：いま正面を向いている面
  function frontFace(d) {
    const M = new DOMMatrix(getComputedStyle(d).transform);
    let best = null;
    for (let f = 1; f <= 6; f++) {
      const F = M.multiply(new DOMMatrix(getComputedStyle(d.querySelector('.f' + f)).transform));
      const z = F.transformPoint(new DOMPoint(0, 0, 0)).z;
      if (!best || z > best[1]) best = [f, z];
    }
    return best[0];
  }
  // サイコロが回っている間の演出（光の輪・震え・カラカラ音）
  let rattleTimer = null;
  function rollFx(on, quiet) {
    $('ctrl-panel').classList.toggle('rolling', on);
    clearInterval(rattleTimer); rattleTimer = null;
    if (on && !quiet) rattleTimer = setInterval(() => AU.se('rattle'), 95);
  }
  async function showDice(e) {
    document.querySelectorAll('.fx-turn').forEach((x) => x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' })); // ターン開始の演出が残っていたら消す
    const spinning = spinAnim != null;
    if (!spinning) {
      AU.se('dice'); ACT.anticipate(e.p, true); startSpin(); rollFx(true); startGauge();
      await sleep(T.diceSpin - T.diceDecel);
    }
    if (G.run) stopGauge((e.gauge || 0) * 360);
    cancelAnimationFrame(spinAnim); spinAnim = null;
    rollFx(false);
    // 着地までの間、合計の数字がルーレットのように回る
    const ds = $('dsum');
    ds.classList.add('roulette');
    const roul = setInterval(() => { ds.textContent = 2 + Math.floor(Math.random() * 11); AU.se('roulette'); }, 55);
    AU.se('whoosh');
    await Promise.all([tossDie(1, e.v1, T.diceToss, 0), tossDie(2, e.v2, T.diceToss, 70)]);
    clearInterval(roul);
    if (window.__diceCheck) window.__diceCheck.push({ v1: e.v1, v2: e.v2, total: e.total, faces: [1, 2].map((i) => frontFace($('die' + i))) });
    ACT.anticipate(e.p, false);
    // ドンッと着地：衝撃波・火花・盤面の揺れ
    const pt = FX.center(ds);
    AU.se('slam');
    retrigger($('dice-row'), 'slam');
    FX.ring(pt.x, pt.y, e.dbl ? '#ffe14d' : '#8fe3ff', 200);
    FX.burst(pt.x, pt.y, e.dbl ? ['#ffe14d', '#fff', '#ff5ac8'] : ['#8fe3ff', '#fff', '#b14cff'], 18, 90);
    FX.shake($('board-container'), 6, 300);
    ds.classList.remove('roulette');
    if (e.blur) {
      // げきりんのブレ：まずサイコロの合計 → ブレを足して進む数を見せる
      ds.textContent = e.v1 + e.v2; ds.className = ''; retrigger(ds, 'big');
      await sleep(700);
      FX.pop(pt.x, pt.y - 34, `🐻げきりんブレ ${e.blur > 0 ? '+' : ''}${e.blur}`, e.blur > 0 ? 'gold' : 'bad', 1.3);
      AU.se(e.blur > 0 ? 'coin' : 'bad');
      await sleep(900);
    }
    ds.textContent = e.total;
    ds.className = e.total >= 10 ? 'hi' : e.total <= 4 ? 'lo' : '';
    retrigger(ds, 'big');
    // 出目に応じたひとこと
    const raw = e.v1 + e.v2;
    // 中くらいの目は何も出さない（ゾロ目はこのあとバナー、大きい目・小さい目だけひとこと）
    let word = e.blur ? `${e.total}マス進む！` : null, cls = 'info', size = 1.6;
    if (e.v1 === 6 && e.v2 === 6) { word = 'MAX 12！！'; cls = 'gold'; size = 2; }
    else if (e.v1 === 1 && e.v2 === 1) { word = 'ピンゾロ！'; cls = 'gold'; size = 1.8; }
    else if (raw >= 10) { word = `${e.total}！ ビッグ！`; cls = 'gold'; size = 1.8; }
    else if (raw <= 4) { word = `${e.total}… ちょびっと`; cls = 'bad'; size = 1.4; }
    if (word) FX.pop(pt.x, pt.y - 34, word, cls, size);
    if (raw >= 10 || (e.v1 === 1 && e.v2 === 1)) { AU.se('bigRoll'); FX.flash('#fff6c0', 220); }
    if (e.dbl && e.dbl < K.BALANCE.doublesToJail) {
      AU.se('doubles'); FX.burst(pt.x, pt.y, ['#ffd23f', '#fff', '#ff5ac8'], 26, 130); FX.confetti(40, 1600); ACT.react(e.p, 'happy', 'small');
      FX.banner({ text: 'ゾロ目！！', sub: 'もう一度サイコロを振れる！', tone: 'gold', dur: 1100 }); // 演出の途中でもコマは走り出す
    }
    await sleep(Math.min(T.afterDice, 150)); // 出目が決まったらすぐ走り出す
  }

  // ================= 時計ゲージ（輪の上を光の玉が回る。盤面の中央をタップで止める） =================
  // 12時の位置から時計回りに「小さい目 → 大きい目」。一周すると小さい目に戻る
  const G = { angle: 0, run: false, anim: null, last: 0 };
  function updGauge(angle) { const h = $('dial-hand'); if (h) h.style.transform = `rotate(${angle}deg)`; }
  function animGauge(ts) {
    const dt = G.last ? Math.min(50, ts - G.last) : 16.7;
    G.last = ts;
    G.angle = (G.angle + 360 * T.gaugeSpeed * (dt / 16.67)) % 360;
    updGauge(G.angle);
    G.anim = requestAnimationFrame(animGauge);
  }
  function startGauge() {
    cancelAnimationFrame(G.anim);
    Object.assign(G, { run: true, last: 0, angle: 0 });
    $('dial').classList.add('running');
    G.anim = requestAnimationFrame(animGauge);
  }
  // 止めた位置で光らせる。ゲージ値（0〜1）を返す
  function stopGauge(angle) {
    cancelAnimationFrame(G.anim); G.anim = null; G.run = false;
    if (angle != null) G.angle = angle;
    updGauge(G.angle);
    $('dial').classList.remove('running');
    const knob = document.querySelector('#dial-hand .knob');
    if (knob) { const pt = FX.center(knob); FX.burst(pt.x, pt.y, ['#ffffff', '#ffe14d', '#ff5ac8'], 16, 55); FX.ring(pt.x, pt.y, '#ffffff', 70); }
    AU.se('gaugeStop');
    return G.angle / 360;
  }
  // 自分の番になったら、ゲージとサイコロを自動で回し始める
  // 手札トレイ：自分のターンの最初（サイコロ前）だけ、持っているイベントカードが並ぶ。タップで確認→使う
  function updCardTray(mine, who) {
    const tray = $('card-tray'); if (!tray) return;
    const p = mine && S.players[who.player];
    const usable = (c) => !K.EVENTS[c].passive; // 乱数の支配者など「持っているだけ」のカードは使えない
    const canSkill = !!(p && S.canCard && p.charge >= 100), canCard = !!(p && S.canCard && p.hand.some(usable));
    const ok = canSkill || canCard;
    tray.classList.toggle('show', ok);
    tray.innerHTML = '';
    if (!ok) return;
    tray.appendChild(el('div', 'ct-title', canSkill && canCard ? '✨ スキルかカードを1つ使える' : canSkill ? '✨ スキルが使える' : '🎴 カードを1枚使える'));
    if (canSkill) {
      const sk = K.CHARACTERS[p.char].skill;
      const b = el('button', 'ct-skill', `<span class="sb-k">✨スキル発動</span><span class="sb-t">${sk.title}</span>`);
      b.type = 'button'; b.style.setProperty('--pc', p.color); b.title = sk.desc;
      b.onclick = () => openSkillConfirm(who.player);
      tray.appendChild(b);
    }
    if (!canCard) return;
    p.hand.forEach((c, idx) => {
      if (!usable(c)) return;
      const ev = K.EVENTS[c];
      const b = el('button', 'ct-card', `<img src="${ev.img}" alt=""><span class="ct-ico">${ev.icon}</span><span class="ct-name">${ev.name}</span>`);
      b.type = 'button';
      b.onclick = () => openCardConfirm(who.player, idx);
      tray.appendChild(b);
    });
  }
  function openSkillConfirm(pi) {
    const p = S.players[pi], sk = K.CHARACTERS[p.char].skill;
    showGen(`✨ ${sk.title}`, '', [
      { label: 'やめる', fn: closeGen },
      { label: '使う！', primary: true, fn: () => { closeGen(); useTurnAction(pi, { type: 'useSkill', player: pi }); } },
    ]);
    $('gen-body').innerHTML = `<img class="card-img" src="${K.CHARACTERS[p.char].skillImg}" alt=""><span class="card-desc">${sk.desc}</span><span class="card-note">使うとゲージは0に戻ります。このターンはカードを使えません</span>`;
  }
  function openCardConfirm(pi, idx) {
    const ev = K.EVENTS[S.players[pi].hand[idx]];
    showGen(`${ev.icon} ${ev.name}`, '', [
      { label: 'やめる', fn: closeGen },
      { label: '使う！', primary: true, fn: () => { closeGen(); useTurnAction(pi, { type: 'useCard', player: pi, idx }); } },
    ]);
    $('gen-body').innerHTML = `<img class="card-img" src="${ev.img}" alt=""><span class="card-desc">${ev.desc}</span><span class="card-note">使ったあと、そのままサイコロを振れます（このターンはスキルを使えません）</span>`;
  }
  function useTurnAction(pi, action) {
    const who = S && E.whoActs(S);
    if (playing || !who || who.kind !== 'roll' || who.player !== pi || !S.canCard) return;
    // 回っているゲージとサイコロを止めてからカードへ
    cancelAnimationFrame(G.anim); G.anim = null; G.run = false; $('dial').classList.remove('running');
    cancelAnimationFrame(spinAnim); spinAnim = null; rollFx(false);
    ACT.anticipate(pi, false);
    $('tap-hint').classList.remove('show'); $('ctrl-panel').classList.remove('tappable');
    updCardTray(false);
    AU.start();
    act(action);
  }
  function chargeFx(e) {
    const box = $('pp' + e.p); if (!box) return;
    const bar = box.querySelector('.pp-gauge'); if (bar) retrigger(bar, 'bump');
  }
  // スタート通過：自分が引いた時はカードの中身を見せる。他の人の時は「1枚もらった」演出だけ
  async function showGacha(e) {
    const p = D.players[e.p];
    if (isMe(e.p)) {
      // 自分が引いた時だけ、ガチャ演出で中身を見せる
      const ev = K.EVENTS[e.card];
      AU.se('skill');
      await FX.gacha({ name: 'あなた', color: p.color, img: ev.img, title: ev.name, icon: ev.icon, desc: ev.desc });
      addLog(`🎴 あなたが引いたカード：${ev.icon}${ev.name}`);
    } else {
      AU.se('coin');
      await FX.cardGet({ name: p.name, color: p.color, to: $('pp' + e.p) });
    }
    renderPanels();
    const box = $('pp' + e.p), last = box && box.querySelectorAll('.pp-card:not(.empty)');
    if (last && last.length) retrigger(last[last.length - 1], 'got');
  }
  // 自分の手札をタップ → カードの説明（使えるのはターンの最初だけ）
  document.addEventListener('click', (ev) => {
    const c = ev.target.closest('.pp-card.mine'); if (!c) return;
    const card = K.EVENTS[Number(c.dataset.card)];
    showGen(`${card.icon} ${card.name}`, '', [{ label: '閉じる', fn: closeGen }]);
    $('gen-body').innerHTML = `<img class="card-img" src="${card.img}" alt=""><span class="card-desc">${card.desc}</span><span class="card-note">${card.passive ? '持っているだけで効きます（使うことはできません）' : '自分のターンの最初（サイコロ前）に使えます'}</span>`;
  });
  function setRoll(on) {
    const who = S && E.whoActs(S);
    const mine = !!(on && who && who.kind === 'roll' && isMe(who.player));
    updCardTray(mine, who);
    if (mine) {
      // 乱数の支配者を持っていて、すぎうらが健在ならヒントに表示
      const pl = S.players[who.player];
      const n = pl.hand.filter((c) => { const ev = K.EVENTS[c]; if (!ev.passive || !ev.spreadMul) return false; const k = S.players.findIndex((q) => q.char === ev.needs); return k >= 0 && !S.players[k].bankrupt; }).length;
      $('tap-hint').textContent = n ? `タップでストップ！（🎲ブレ${n > 1 ? '1/' + (2 ** n) : '半分'}）` : 'タップでストップ！';
    }
    $('tap-hint').classList.toggle('show', mine);
    $('ctrl-panel').classList.toggle('tappable', mine);
    if (mine && !G.run) {
      $('dsum').textContent = '?';
      ACT.anticipate(who.player, true);
      startSpin(); rollFx(true, true);
      startGauge();
    }
  }
  function onBoardTap(tapTs) {
    const who = S && E.whoActs(S);
    if (playing || clientBusy || !who || who.kind !== 'roll' || !isMe(who.player) || !G.run) return false;
    // タップした瞬間の位置で止める（最後に描いたコマからの経過分も足す）
    if (G.last && tapTs) { const dt = Math.max(0, Math.min(50, tapTs - G.last)); G.angle = (G.angle + 360 * T.gaugeSpeed * (dt / 16.67)) % 360; }
    const gauge = stopGauge();
    AU.start();
    document.querySelectorAll('.fx-turn').forEach((x) => x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' })); // ターン開始の演出を消す
    setRoll(false);
    const action = { type: 'roll', player: who.player, gauge };
    if (debugOn && forcedDie) { action.forced = forcedDie; forcedDie = null; markForced(); }
    AU.se('dice');
    act(action);
    return true;
  }

  // ================= 人間の入力（選択待ち） =================
  function hideAllPrompts() {
    ['buy-ov', 'sell-ov', 'travel-ov'].forEach((id) => $(id).classList.remove('show'));
    $('card-tray').classList.remove('show');
    $('roof-choice-ov').classList.remove('show');
    endCellSelect();
  }
  function openBuy(pd) {
    const d = R.def(pd.cell), c = S.cells[pd.cell], p = S.players[pd.player];
    $('buy-title').textContent = d.name;
    const sub = $('buy-sub');
    const subs = { tourist: ['観光地・未所有地', '#bbb'], buy: ['未所有地', '#bbb'], upgrade: ['アップグレード', '#378ADD'], acquire: [`所有: ${S.players[c.owner] ? S.players[c.owner].name : ''} — 買収（2倍）`, '#E24B4A'], mega: [`🏰なんでも買収：${S.players[c.owner] ? S.players[c.owner].name : ''}のマスを購入金額のみで建物ごと購入（代金は銀行へ）`, '#ffb020'] };
    sub.textContent = subs[pd.mode][0]; sub.style.color = subs[pd.mode][1];
    const box = $('buy-opts'); box.innerHTML = '';
    let sel = (pd.options.find((o) => o.ok) || {}).value;
    const rows = pd.mode === 'tourist' || (pd.mode === 'mega' && d.type === 'tourist')
      ? [{ lv: 1, name: '観光地', icon: GR.blueprint.flag(p.color) }]
      : [1, 2, 3].map((lv) => ({ lv, name: K.LEVEL_NAMES[lv], icon: GR.blueprint.building(lv, p.color) })); // 盤面と同じ白模型（土台は自分の色）
    const total = () => { const o = pd.options.find((x) => x.value === sel); $('buy-total').innerHTML = `合計: <b>${o ? o.cost.toLocaleString() : 0}M</b>`; $('btn-confirm').disabled = !o || !o.ok; };
    rows.forEach((r) => {
      const o = pd.options.find((x) => x.value === r.lv);
      let price;
      if (o) price = o.ok ? o.cost + 'M' : `${o.cost}M（不足）`;
      else if (pd.mode === 'mega') price = '—';
      else if (pd.mode !== 'acquire' && r.lv <= c.level) price = '取得済';
      else if (r.lv > R.maxLv(p)) price = `${r.lv}周目〜`;
      else price = '買収不可';
      const div = el('div', 'bopt', `<div class="bopt-icon">${r.icon}</div><div class="bopt-name">${r.name}</div><div class="bopt-price">${price}</div>`);
      if (!o || !o.ok) div.classList.add('locked');
      else div.onclick = () => { sel = r.lv; box.querySelectorAll('.bopt').forEach((x) => x.classList.remove('sel')); div.classList.add('sel'); total(); };
      if (o && o.value === sel) div.classList.add('sel');
      box.appendChild(div);
    });
    total();
    $('btn-confirm').textContent = pd.mode === 'acquire' ? '買収' : '購入';
    $('btn-confirm').onclick = () => act({ type: 'choose', player: pd.player, value: sel });
    $('btn-buy-cancel').onclick = () => act({ type: 'choose', player: pd.player, value: 0 });
    $('buy-ov').classList.add('show');
  }
  function openSell(pd) {
    const p = S.players[pd.player];
    $('sell-status').innerHTML = `所持金: <b style="color:${p.money < 0 ? '#ffaaaa' : '#4ada80'}">${p.money.toLocaleString()}M</b> — 売却してプラスに戻してください`;
    const list = $('sell-list'); list.innerHTML = '';
    pd.options.forEach((o) => {
      const d = R.def(o.value), c = S.cells[o.value];
      const col = d.type === 'tourist' ? '#1D9E75' : K.COLOR_HEX[d.color];
      const lv = d.type === 'tourist' ? '観光地' : K.LEVEL_NAMES[c.level];
      const item = el('div', 'si', `<div class="si-left"><div class="si-dot" style="background:${col}"></div><div><div class="si-name">${d.name}</div><div class="si-lv">${lv}</div></div></div><div class="si-price">+${o.cost.toLocaleString()}M</div>`);
      item.onclick = () => act({ type: 'choose', player: pd.player, value: o.value });
      list.appendChild(item);
    });
    $('btn-bankrupt').onclick = () => act({ type: 'choose', player: pd.player, value: 'bankrupt' });
    $('sell-ov').classList.add('show');
  }
  function openTargetSelect(pd) {
    $('travel-title').textContent = pd.title;
    const list = $('tlist'); list.innerHTML = '';
    pd.options.forEach((idx) => {
      const tp = S.players[idx];
      const item = el('div', 'ti', `<span style="display:flex;align-items:center;gap:6px"><span style="width:9px;height:9px;border-radius:50%;background:${tp.color};display:inline-block"></span>${tp.name}</span><span style="font-size:9px;color:#999">${tp.money.toLocaleString()}M</span>`);
      item.onclick = () => act({ type: 'choose', player: pd.player, value: idx });
      list.appendChild(item);
    });
    $('travel-ov').classList.add('show');
  }
  // お前のパンは俺のもの：相手の手札を表向きで見せて、1枚選ぶ
  function openPickCard(pd) {
    $('travel-title').textContent = pd.title;
    const list = $('tlist'); list.innerHTML = '';
    pd.options.forEach((i) => {
      const ev = K.EVENTS[pd.data.cards[i]];
      const item = el('div', 'ti', `<span style="display:flex;align-items:center;gap:8px"><img src="${ev.img}" style="width:38px;height:38px;border-radius:6px;object-fit:cover">${ev.icon} ${ev.name}</span>`);
      item.title = ev.desc;
      item.onclick = () => act({ type: 'choose', player: pd.player, value: i });
      list.appendChild(item);
    });
    $('travel-ov').classList.add('show');
  }
  // ゲーマーの意地：4つの効果から選ぶ（大きなボタン4つ）
  function openGamer(pd) {
    const p = S.players[pd.player], sk = (pd.data && pd.data.skillOf ? K.CHARACTERS[pd.data.skillOf] : K.CHARACTERS[p.char]).skill;
    showGen('🎮 ゲーマーの意地！', '', []);
    $('gen-body').innerHTML = `<div class="gm-sub">効果を1つ選んでください</div><div class="gm-grid">${sk.choices.map((c) => `<button class="gm-btn" data-v="${c.id}"><span class="gm-ic">${c.icon}</span><b>${c.label}</b><span class="gm-d">${c.desc}</span></button>`).join('')}</div>`;
    $('gen-body').querySelectorAll('.gm-btn').forEach((b) => (b.onclick = () => { closeGen(); act({ type: 'choose', player: pd.player, value: b.dataset.v }); }));
  }
  // 研究棟：好きなイベントカードを1枚選ぶ（カードの画像を並べる）
  function openPickEvent(pd) {
    showGen('🏛 研究棟', '', []);
    $('gen-body').innerHTML = `<div class="gm-sub">好きなイベントカードを1枚選んでください</div><div class="pe-grid">${pd.options.map((i) => { const e = K.EVENTS[i]; return `<button class="pe-card" data-v="${i}"><img src="${e.img}" alt="${e.name}"></button>`; }).join('')}</div><div class="pe-desc" id="pe-desc">カードをタップすると説明が出ます。もう一度タップで決定</div>`;
    let sel = null;
    $('gen-body').querySelectorAll('.pe-card').forEach((b) => (b.onclick = () => {
      const v = Number(b.dataset.v);
      if (sel === v) { closeGen(); act({ type: 'choose', player: pd.player, value: v }); return; }
      sel = v;
      $('gen-body').querySelectorAll('.pe-card').forEach((x) => x.classList.toggle('sel', x === b));
      const e = K.EVENTS[v]; $('pe-desc').innerHTML = `<b>${e.icon} ${e.name}</b><br>${e.desc}<br><span class="pe-tap">もう一度タップで決定</span>`;
    }));
  }
  function openRoof(pd) {
    $('roof-img').src = pd.img;
    document.querySelectorAll('.roof-btn').forEach((b) => (b.onclick = () => act({ type: 'choose', player: pd.player, value: b.dataset.roof })));
    $('roof-choice-ov').classList.add('show');
  }
  // 盤面のマスを直接クリックして選ぶ（地震・世界旅行・ワープ・旅行イベント共通）
  let cellPick = null;
  function startCellSelect(ids, title, onPick) {
    cellPick = { ids: new Set(ids), onPick };
    $('quake-banner').textContent = title;
    $('quake-banner').classList.add('show');
    markCellTargets();
  }
  function markCellTargets() {
    if (!cellPick) return;
    document.querySelectorAll('#board-rotated .cell').forEach((div) => {
      const id = Number(div.dataset.cellId);
      if (!cellPick.ids.has(id)) return;
      div.classList.add('quake-target');
      div.style.cursor = 'pointer';
      div.onclick = () => { const cb = cellPick.onPick; endCellSelect(); cb(id); };
    });
  }
  function endCellSelect() {
    if (!cellPick) return;
    cellPick = null;
    $('quake-banner').classList.remove('show');
    renderBoard();
  }

  // ================= マス情報・DEBUG =================
  // 自分のコマから何マス先か（進む方向に数える）
  function distText(id) {
    const me = S && S.players[meIdx()];
    if (!me || me.bankrupt) return '';
    const n = K.BOARD.length, d = (id - me.pos + n) % n;
    return d === 0 ? 'あなたのいるマス' : `あなたから${d}マス先`;
  }
  function showCellInfo(id) {
    if (cellPick) return;
    const d = R.def(id), c = S.cells[id];
    const owner = c.owner >= 0 ? S.players[c.owner].name : '未購入';
    if (debugOn && (d.type === 'prop' || d.type === 'tourist') && E.whoActs(S) && E.whoActs(S).kind === 'roll' && !playing) {
      const me = S.players.findIndex((p) => p.isHuman);
      const btns = [{ label: '閉じる', fn: closeGen }];
      const set = (owner, level) => () => { closeGen(); act({ type: 'debugSet', id, owner, level }); };
      if (d.type === 'prop') [1, 2, 3].forEach((lv) => btns.push({ label: `自分の${K.LEVEL_NAMES[lv]}`, primary: lv === 1, fn: set(me, lv) }));
      else btns.push({ label: '自分の所有にする', primary: true, fn: set(me, 0) });
      if (c.owner >= 0) btns.push({ label: '所有を解除', fn: set(-1, 0) });
      showGen(`🛠 DEBUG: ${d.name}`, `所有者: ${owner}\n通行料: ${R.rent(S, id)}M`, btns);
      return;
    }
    showGen(d.name, '', [{ label: '閉じる', fn: closeGen }]);
    $('gen-body').innerHTML = cellDetailHtml(id);
  }
  // マスの詳しい情報（物件・観光地・特別なマス すべて）
  function cellDetailHtml(id) {
    const d = R.def(id), c = S.cells[id], meI = Math.max(0, meIdx()), me = S.players[meI];
    const M = (n) => `${Math.round(n).toLocaleString()}M`;
    const row = (k, val, cls) => `<div class="ci-row${cls ? ' ' + cls : ''}"><span>${k}</span><b>${val}</b></div>`;
    const out = [];
    out.push(`<div class="ci-dist">📍 ${distText(id)}</div>`);
    if (d.type === 'prop' || d.type === 'tourist') {
      const own = c.owner >= 0 ? S.players[c.owner] : null;
      out.push(row('種類', d.type === 'tourist' ? '観光地' : `物件（${K.COLOR_NAME[d.color]}エリア）`));
      out.push(row('持ち主', own ? `<span style="color:${own.color}">${escH(own.name)}</span>` : '未購入'));
      if (d.type === 'prop') out.push(row('建物', K.LEVEL_NAMES[c.level]));
      // 今止まったら払う通行料（自分のマスなら0）と、その内訳
      if (own) {
        const pay = own === me ? 0 : R.rentFor(S, id, meI);
        const why = [];
        if (R.isMonopoly(S, id)) why.push('👑独占×2');
        if (c.mul > 1) why.push(`🔥×${c.mul}`);
        if (c.wc) why.push('🏆×2');
        if (c.sand) why.push('🌪½');
        const st = R.stat(own, 'struct'); if (R.statVal(own, 'struct') > 0) why.push(`構造${st}で×${(1 + R.statVal(own, 'struct')).toFixed(2)}`);
        out.push(row(own === me ? '通行料（他の人が払う）' : 'あなたが払う通行料', `${M(own === me ? R.rent(S, id) : pay)}${why.length ? `<small>${why.join(' ')}</small>` : ''}`, 'em'));
      }
      // あなたが買う場合の値段
      if (!own) {
        if (d.type === 'tourist') out.push(row('購入価格', M(d.price), 'em'));
        else {
          const top = R.maxLv(me);
          out.push(`<div class="ci-h">購入価格（あなたは${top >= 3 ? 'ランドマーク' : K.LEVEL_NAMES[top]}まで建てられる）</div>`);
          [1, 2, 3].forEach((lv) => out.push(row(K.LEVEL_NAMES[lv], lv <= top ? M(R.buyCost(S, id, lv, meI)) : `${M(R.buyCost(S, id, lv, meI))}（${lv}周目〜）`, lv > top ? 'off' : '')));
        }
      } else if (own === me) {
        if (d.type === 'prop' && c.level < 3) {
          const top = R.maxLv(me);
          out.push(`<div class="ci-h">増築の値段</div>`);
          for (let lv = c.level + 1; lv <= 3; lv++) out.push(row(K.LEVEL_NAMES[lv], lv <= top ? M(R.buyCost(S, id, lv, meI)) : `${M(R.buyCost(S, id, lv, meI))}（${lv}周目〜）`, lv > top ? 'off' : ''));
        }
      } else {
        const canAcq = d.type === 'tourist' ? false : c.level < 3;
        out.push(row('買収価格（払ったあと）', canAcq ? M(R.acquireCost(S, id, Math.max(c.level, 1), meI)) : (d.type === 'tourist' ? '観光地は買収できない' : 'ランドマークは買収できない')));
      }
      // 建物ごとの通行料の目安（倍率なし・持ち主の構造は反映）
      if (d.type === 'prop') {
        const base = (lv) => { const save = c.level; c.level = lv; const save2 = c.owner; if (c.owner < 0) c.owner = meI; const r = R.rent(S, id); c.level = save; c.owner = save2; return r; };
        out.push(`<div class="ci-h">建物ごとの通行料${c.owner < 0 ? '（あなたが持った場合）' : '（今の倍率込み）'}</div>`);
        [0, 1, 2, 3].forEach((lv) => out.push(row(lv ? K.LEVEL_NAMES[lv] : '空き地', M(base(lv)), lv === c.level && c.owner >= 0 ? 'now' : '')));
      }
      if (own) out.push(row('売却価格', M(R.sellPrice(S, id))));
    } else {
      const S2 = K.BALANCE.stats;
      const info = {
        start: `通過すると +${M(K.BALANCE.salary)} とイベントカード1枚。ぴったり止まると手札が上限まで埋まる。`,
        study: `止まると 1/4で落単（上がらない）・2/4で${d.name}+1・1/4で${d.name}+2（上限${S2.max}）。あなたの${d.name}は今 ${me ? R.stat(me, d.stat) : '-'}。`,
        lab: `止まると全ステータスが+1（確実・上限${S2.max}）。`,
        island: '止まるとその場で1回休み。',
        travel: '止まると好きなマスへ移動できる（買えるマスだけ選べる）。',
        chance: 'イベントカードの効果がランダムで1つ起きる。',
      }[d.type] || '';
      out.push(`<div class="ci-desc">${info}</div>`);
    }
    return `<div class="ci-wrap">${out.join('')}</div>`;
  }
  function showGen(title, body, btns) {
    $('gen-title').textContent = title; $('gen-body').textContent = body;
    const area = $('gen-btns'); area.innerHTML = '';
    btns.forEach((b) => { const btn = el('button', b.primary ? 'primary' : ''); btn.textContent = b.label; btn.onclick = b.fn; area.appendChild(btn); });
    $('gen-ov').classList.add('show');
  }
  function closeGen() { $('gen-ov').classList.remove('show'); }
  // プレイヤーの詳しい情報（パネルをタップ）：今かかっている効果・物件・スキルなど
  const escH = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function effectList(p) {
    const E2 = (id) => K.EVENTS.find((e) => e.id === id) || {};
    const out = [];
    if (p.skip) out.push(['🏝', '1回休み', '設計課題などで、次の番は休み']);
    if (p.fx.typhoon) out.push(['🌀', '富の台風18号', `1周する間、通り越した相手から所持金とゲージの${Math.round((E2('typhoon').stealRate || 0) * 100)}%を奪う`]);
    if (p.fx.steady) out.push(['🎯', '狙い通りの目', '1周する間、ゲージで狙った目がそのまま出る']);
    if (p.fx.overtake) out.push(['💰', '追い越し略奪', `1周する間、追い越した相手の所持金${Math.round((K.CHARACTERS['すぎうら'].skill.stealRate || 0) * 100)}%を奪う`]);
    if (p.fx.megaBuy) out.push(['🏰', 'なんでも買収', '1周する間に1回、他人のマス（ランドマーク・観光地も）で通行料なし・購入金額のみで買える']);
    if (p.fx.insured) out.push(['🧯', '火災保険', '自分の建物が壊される効果を1回だけ防ぐ']);
    if (p.fx.noBankrupt) out.push(['☀️', 'あの夏は終わらない', '1周する間、支払いがすべて免除']);
    if (p.fx.genjitsuka) out.push(['💰', '具現化スタンバイ', '所持金が尽きたら具現化が発動する']);
    if (p.fx.gamerNext) out.push(['🎮', 'ゲーマーの意地', '次の番に3回連続で動ける']);
    if (p.fx.gamerOn || p.fx.gamerLeft > 0) out.push(['🎮', 'ゲーマーの意地', `連続移動中（残り${p.fx.gamerLeft}回）`]);
    if (p.fx.waitFor != null) out.push(['🛏', 'もうすぐ着く', `${S.players[p.fx.waitFor].name}に追いつかれるまで待機中`]);
    if (p.fx.angel) out.push(['😇', '天使の加護', '次の通行料1回が無料']);
    if (p.fx.coupon) out.push(['🎟', '半額クーポン', '次の通行料1回が半額']);
    if (p.fx.fixedRoll) out.push(['🎲', '目が確定', `次のサイコロは${p.fx.fixedRoll}`]);
    // 1周する間の効果は、残りのマス数も出す
    const L = p.fx.lapLeft || {}, keyOf = { '富の台風18号': 'typhoon', '狙い通りの目': 'steady', '追い越し略奪': 'overtake', 'なんでも買収': 'megaBuy', 'あの夏は終わらない': 'noBankrupt', '具現化スタンバイ': 'genjitsuka' };
    out.forEach((e) => { const k = keyOf[e[1]]; if (k && L[k] > 0) e[2] += `（あと${L[k]}マス）`; });
    return out;
  }
  function showPlayerInfo(pi) {
    if (!S) return;
    const p = S.players[pi], ch = K.CHARACTERS[p.char], sk = ch.skill;
    const owned = R.ownedIds(S, pi), rk = R.ranks(S);
    const chg = Math.floor(Math.max(0, Math.min(100, p.charge || 0)));
    const eff = effectList(p), reach = p.bankrupt ? [] : R.reaches(S, pi);
    const props = owned.map((id) => { const d = R.def(id), c = S.cells[id]; return `<span class="pi-prop" style="--cc:${d.type === 'prop' ? K.COLOR_HEX[d.color] : '#2e9e55'}">${escH(d.name)}${d.type === 'prop' && c.level > 0 ? '・' + K.LEVEL_NAMES[c.level] : ''}</span>`; }).join('');
    const hand = isMe(pi) ? (p.hand.length ? p.hand.map((c) => `${K.EVENTS[c].icon}${escH(K.EVENTS[c].name)}`).join('、') : 'なし') : `${p.hand.length}枚（中身は見えない）`;
    showGen(`${p.name}${p.bankrupt ? '（破産）' : ''}`, '', [{ label: '閉じる', fn: closeGen }]);
    $('gen-body').innerHTML = `<div class="pi-wrap" style="--pc:${p.color}">
      <div class="pi-head"><img src="${ch.img}" alt=""><div><div class="pi-rank">${p.bankrupt ? '-' : rk.indexOf(pi) + 1}位・${p.laps}周目</div>
        <div class="pi-num">所持金 <b>${p.money.toLocaleString()}M</b></div><div class="pi-num">総資産 <b>${R.totalAssets(S, pi).toLocaleString()}M</b></div></div></div>
      <div class="pi-sec"><div class="pi-h">📚ステータス</div>${K.STAT_DEFS.map((sd) => { const v = R.stat(p, sd.key), mx = K.BALANCE.stats.max; return `<div class="pi-st"><span class="pi-st-n">${sd.icon}${sd.name}</span><span class="pi-st-bar">${Array.from({ length: mx }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</span><b>${v}</b><span class="pi-st-d">${sd.desc}</span></div>`; }).join('')}</div>
      <div class="pi-sec"><div class="pi-h">✨スキル「${escH(sk.title)}」　ゲージ ${chg}%</div><div class="pi-bar"><i style="width:${chg}%"></i></div><div class="pi-t">${escH(sk.desc)}</div></div>
      <div class="pi-sec"><div class="pi-h">かかっている効果</div>${eff.length ? eff.map(([ic, n, t]) => `<div class="pi-eff"><span>${ic}</span><div><b>${escH(n)}</b><br>${escH(t)}</div></div>`).join('') : '<div class="pi-t">なし</div>'}</div>
      ${reach.length ? `<div class="pi-sec"><div class="pi-h">🔥リーチ</div><div class="pi-t">${reach.map((r) => escH(r.replace('リーチ🔥 ', ''))).join('<br>')}</div></div>` : ''}
      <div class="pi-sec"><div class="pi-h">物件・観光地（${owned.length}）</div><div class="pi-props">${props || '<span class="pi-t">なし</span>'}</div></div>
      <div class="pi-sec"><div class="pi-h">手札</div><div class="pi-t">${hand}</div></div></div>`;
  }
  document.addEventListener('click', (ev) => {
    const box = ev.target.closest('.pp'); if (!box || ev.target.closest('.pp-card.mine')) return;
    const pi = Number(box.id.replace('pp', '')); if (Number.isInteger(pi)) showPlayerInfo(pi);
  });
  function initDebug() {
    const row = $('debug-dice-row');
    for (let n = 2; n <= 12; n++) { const b = el('button', 'ddie'); b.textContent = n; b.dataset.n = n; b.onclick = () => { forcedDie = n; markForced(); }; row.appendChild(b); }
    const clr = el('button', 'ddie clear'); clr.textContent = '解除'; clr.onclick = () => { forcedDie = null; markForced(); }; row.appendChild(clr);
    const sel = $('debug-event-select');
    sel.onchange = () => { debugEvent = sel.value === '' ? null : Number(sel.value); syncDebug(); };
    $('debug-switch').onclick = () => {
      debugOn = !debugOn;
      $('debug-switch').classList.toggle('on', debugOn);
      $('debug-label').textContent = `DEBUGモード ${debugOn ? 'ON' : 'OFF'}`;
      if (!debugOn) { forcedDie = null; markForced(); }
      syncDebug();
    };
  }
  function syncDebug() { if (S) S = E.dispatch(S, { type: 'debug', on: debugOn, event: debugEvent }).state; }
  function markForced() { document.querySelectorAll('.ddie').forEach((b) => b.classList.toggle('active', Number(b.dataset.n) === forcedDie)); }

  // ================= 勝利・開始 =================
  function showWin() {
    const w = S.winner, p = S.players[w.player];
    AU.bgm('win'); FX.confetti(180, 3800); document.body.classList.remove('late');
    let wf = $('win-face');
    if (!wf) { wf = el('div'); wf.id = 'win-face'; $('win-title').before(wf); }
    wf.innerHTML = spriteHtml(p.char, 'happy', 130);
    $('win-title').textContent = `${p.name} の勝利！`; $('win-title').style.color = p.color;
    const c = $('win-cond'); c.textContent = w.msg; c.style.background = p.color;
    $('win-detail').textContent = w.detail;
    const re = $('win-ranks'); re.innerHTML = '';
    R.ranks(S).concat(S.players.filter((x) => x.bankrupt).map((x) => x.id)).forEach((ri, idx) => {
      const rp = S.players[ri];
      re.appendChild(el('div', 'wrr', `<span style="display:flex;align-items:center;gap:4px"><span style="background:${rp.color};width:8px;height:8px;border-radius:50%;display:inline-block"></span>${rp.name}</span><span style="color:#999">${rp.bankrupt ? '破産' : idx + 1 + '位 ' + R.totalAssets(S, ri).toLocaleString() + 'M'}</span>`));
    });
    const wb = $('win-btns'); wb.innerHTML = '';
    const again = el('button', 'primary'); again.textContent = 'もう一度';
    again.onclick = () => {
      if (online && NET.mode === 'host') { NET.setPhase('lobby'); return; } // 親：全員をロビーへ（lobby の知らせで自分も戻る）
      if (online) { backToLobby(); return; }
      $('win-ov').classList.remove('show'); $('char-select-ov').classList.remove('hide');
    };
    wb.appendChild(again);
    $('win-ov').classList.add('show');
  }
  $('btn-rules-top').onclick = () => GR.rulebook.open();
  $('btn-rules').onclick = () => GR.rulebook.open();
  function initCharSelect() {
    setTimeout(preloadAll, 300); // ポップアップ画像の先読み
    // 文章の改行位置を整える（説明文・確認画面・ルールブックなど）
    ['char-select-grid', 'gen-box', 'buy-box', 'sell-box', 'travel-box', 'win-box', 'card-tray', 'log-wrap', 'quake-banner'].forEach((id) => FX.jpify($(id)));
    const grid = $('char-select-grid');
    K.CHAR_ORDER.forEach((name) => {
      const ch = K.CHARACTERS[name];
      const card = el('div', 'char-card', `<img src="${ch.img}" alt="${name}"><div class="char-label">PLAYER</div><div class="char-name">${name}</div><div class="char-stats">${K.STAT_DEFS.map((sd) => { const sv = ch.stats[sd.key], mx = K.BALANCE.stats.max; return `<div class="cs-row"><span class="cs-n">${sd.icon}${sd.name}</span><span class="cs-bar">${Array.from({ length: mx }, (_, i) => `<i class="${i < sv ? 'on' : ''}"></i>`).join('')}</span><b>${sv}</b></div>`; }).join('')}</div><div class="char-skill"><div class="skill-name">✨ ${ch.skill.title}</div><div class="skill-desc">${ch.skill.desc}</div></div>`);
      card.dataset.char = name;
      card.onclick = () => (lobbyMode ? pickInLobby(name) : startGame(name));
      grid.appendChild(card);
    });
  }
  // ================= 友達対戦：ロビー（部屋） =================
  let lobbyMode = false;
  function setTab(host) {
    $('btn-mp-solo').classList.toggle('on', !host); $('btn-mp-host').classList.toggle('on', host);
    $('mp-lobby').hidden = !host;
    $('char-select-sub').textContent = host ? '部屋ができたら、使うキャラをタップ' : 'プレイするキャラクターを選んでください';
  }
  function lobbyStatus(t) { $('mp-status').textContent = t; }
  // 通信の部品（PeerJS）の読み込みを少し待つ（予備のサーバーから読み込む場合があるため）
  function waitNet(fn, tries = 0) { if (NET.available() || tries > 25) fn(); else setTimeout(() => waitNet(fn, tries + 1), 200); }
  function enterHost() {
    if (lobbyMode) return;
    if (!NET.available()) { lobbyStatus('通信の準備中…'); $('mp-lobby').hidden = false; return waitNet(() => { if (NET.available()) enterHost(); else lobbyStatus('通信の準備ができていません。電波の良い所でページを読み込み直してください'); }); }
    if (!NET.available()) { lobbyStatus('通信の準備ができていません。電波の良い所でページを読み込み直してください'); $('mp-lobby').hidden = false; return; }
    lobbyMode = true; setTab(true);
    lobbyStatus('部屋を作っています…');
    NET.host((code) => {
      lobbyStatus(`部屋番号 ${code}　友達が入るのを待っています`);
      $('mp-invite').hidden = false; $('mp-link').value = NET.inviteUrl(code);
      $('btn-mp-start').hidden = false;
      renderLobby(NET.lobby);
    });
  }
  function enterJoin(code) {
    lobbyMode = true; setTab(true);
    $('mp-bar').hidden = true; $('mp-invite').hidden = true; $('btn-mp-start').hidden = true;
    $('char-select-sub').textContent = `部屋 ${code} に参加`;
    if (!NET.available()) { lobbyStatus('通信の準備ができていません。電波の良い所でページを読み込み直してください'); return; }
    lobbyStatus('部屋に入っています…');
    NET.join(code, () => lobbyStatus('つながりました！使うキャラをタップしてください'));
  }
  function pickInLobby(name) {
    const lb = NET.lobby; if (!lb || lb.phase !== 'lobby') return;
    const me = lb.members.find((m) => m.cid === NET.cid);
    if (lb.members.some((m) => m.cid !== NET.cid && m.name === name)) return; // 他の人が使っている
    NET.pick(NET.cid, me && me.name === name ? '' : name);
  }
  function renderLobby(lb) {
    if (!lb) return;
    const box = $('mp-members'); box.innerHTML = '';
    lb.members.forEach((m) => {
      const ch = m.name && K.CHARACTERS[m.name];
      box.appendChild(el('div', 'mp-mem' + (m.online ? '' : ' off') + (m.cid === NET.cid ? ' me' : ''),
        `${ch ? `<img src="${ch.img}" alt="">` : '<span class="mp-q">?</span>'}<span>${m.host ? '👑' : ''}${m.name ? escH(m.name) : 'キャラ未選択'}${m.cid === NET.cid ? '（あなた）' : ''}${m.online ? '' : '・接続待ち'}</span>`));
    });
    document.querySelectorAll('#char-select-grid .char-card').forEach((c) => {
      const owner = lb.members.find((m) => m.name === c.dataset.char);
      c.classList.toggle('mp-mine', !!owner && owner.cid === NET.cid);
      c.classList.toggle('mp-taken', !!owner && owner.cid !== NET.cid);
    });
    if (NET.mode === 'host') {
      const on = lb.members.filter((m) => m.online), ok = on.every((m) => m.name);
      $('btn-mp-start').disabled = !ok;
      $('btn-mp-start').textContent = ok ? `ゲーム開始（人間${on.length}人＋CPU${4 - on.length}人）` : '全員がキャラを選ぶと開始できます';
    }
  }
  function backToLobby() {
    online = false; lobbyMode = true;
    $('win-ov').classList.remove('show'); closeGen();
    $('char-select-ov').classList.remove('hide');
    setTab(true); if (NET.mode === 'client') $('mp-bar').hidden = true;
    lobbyStatus(NET.mode === 'host' ? `部屋番号 ${NET.code}　キャラを選んで、もう一度開始できます` : '親がもう一度始めるのを待っています');
    renderLobby(NET.lobby);
  }
  // 親：ゲーム開始
  function startOnline() {
    const mem = NET.lobby.members.filter((m) => m.online && m.name);
    if (!mem.length) return;
    S = makeGame(mem.map((m) => m.name));
    NET.seats = {}; mem.forEach((m) => { NET.seats[m.cid] = S.players.findIndex((p) => p.char === m.name); });
    NET.seat = NET.seats[NET.cid] != null ? NET.seats[NET.cid] : -1;
    online = true; lobbyMode = false; debugOn = false; $('debug-panel').style.display = 'none';
    remoteQ.length = 0;
    NET.setPhase('game');
    NET.broadcast({ t: 'start', state: S, seats: NET.seats });
    beginGame(true).then(next);
  }
  // 「ひとりで遊ぶ」：作った部屋を閉じて、ひとり用の選択に戻る
  $('btn-mp-solo').onclick = () => {
    if (lobbyMode) {
      NET.leave(); lobbyMode = false;
      $('mp-invite').hidden = true; $('btn-mp-start').hidden = true; $('mp-members').innerHTML = ''; lobbyStatus('');
      document.querySelectorAll('#char-select-grid .char-card').forEach((c) => c.classList.remove('mp-mine', 'mp-taken'));
    }
    setTab(false);
  };
  $('btn-mp-host').onclick = enterHost;
  $('btn-mp-start').onclick = startOnline;
  $('btn-mp-copy').onclick = () => { const i = $('mp-link'); i.select(); try { navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand('copy'); } $('btn-mp-copy').textContent = 'コピーしました'; setTimeout(() => ($('btn-mp-copy').textContent = 'コピー'), 1500); };
  $('btn-mp-share').onclick = () => { const url = $('mp-link').value; if (navigator.share) navigator.share({ title: 'ゲットリッチ', text: '一緒に遊ぼう！', url }).catch(() => {}); else $('btn-mp-copy').onclick(); };
  // 通信のできごと
  NET.on('lobby', (lb) => { if (online && lb.phase === 'lobby') backToLobby(); else if (lobbyMode) renderLobby(lb); });
  NET.on('remoteAct', (cid, action) => {
    if (!online || !S) return;
    const seat = NET.seats[cid];
    if (seat == null || !action || action.player !== seat || !['roll', 'choose', 'useCard', 'useSkill', 'predict'].includes(action.type)) return;
    act(action, true);
  });
  NET.on('memberLeft', (cid) => { // 親：途中で抜けた人の席はCPUが代わりに動かす
    if (!online || !S) return;
    const seat = NET.seats[cid]; if (seat == null || S.players[seat].bankrupt) return;
    S.players[seat].isHuman = false;
    addLog(`📴 ${S.players[seat].name}の接続が切れたので、戻るまでCPUが代わりに動かします`);
    if (!playing) next();
  });
  NET.on('memberJoined', (cid) => { // 親：途中で戻ってきた人に今の盤面を送る
    if (!online || !S) return;
    const seat = NET.seats[cid];
    if (seat != null) { S.players[seat].isHuman = true; addLog(`📶 ${S.players[seat].name}が戻ってきました`); }
    NET.sendTo(cid, { t: 'sync', state: S, seats: NET.seats });
  });
  NET.on('start', (m) => { // 子：ゲーム開始
    S = m.state; NET.seats = m.seats; NET.seat = m.seats[NET.cid] != null ? m.seats[NET.cid] : -1;
    online = true; lobbyMode = false; $('debug-panel').style.display = 'none';
    clientQ.length = 0; clientBusy = true;
    beginGame(true).then(() => { clientBusy = false; pumpClient(); });
  });
  NET.on('step', (m) => { clientQ.push(m); pumpClient(); });
  NET.on('sync', (m) => { // 子：途中から入った／戻った
    S = m.state; NET.seats = m.seats; NET.seat = m.seats[NET.cid] != null ? m.seats[NET.cid] : -1;
    online = true; lobbyMode = false; $('debug-panel').style.display = 'none';
    clientQ.length = 0; clientBusy = false;
    beginGame(false); next();
  });
  NET.on('hostLost', () => {
    showGen('接続が切れました', '部屋を作った人との接続が切れました。部屋を作った人がページを開いたままか確認して、もう一度リンクを開いてください。', [{ label: 'もう一度つなぐ', primary: true, fn: () => location.reload() }]);
  });
  NET.on('error', (err) => {
    const msg = err === 'nohost' ? 'その部屋が見つかりません。部屋を作った人がページを開いているか、リンクが正しいか確認してください。' : `通信でエラーが起きました（${err}）。ページを読み込み直してください。`;
    lobbyStatus(msg);
    if (online) showGen('通信エラー', msg, [{ label: '閉じる', fn: closeGen }]);
  });

  function startGame(charName) {
    online = false;
    // ターン順はランダム。パネルはプレイ順に 左上→右上→右下→左下（時計回り）に並べる
    //   パネルの番号：左上=pp0・右上=pp1・左下=pp2・右下=pp3 → 順番k番目の人を [0,1,3,2][k] 番に置く
    S = makeGame([charName]);
    syncDebug();
    beginGame(true).then(next);
  }
  // ゲームを作る（humanChars＝人間が操作するキャラ。残りはCPU）
  function makeGame(humanChars) {
    const turn = K.CHAR_ORDER.slice();
    for (let i = turn.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [turn[i], turn[j]] = [turn[j], turn[i]]; }
    const SLOT = [0, 1, 3, 2], chars = [], humans = [];
    turn.forEach((c, k) => { chars[SLOT[k]] = c; humans[SLOT[k]] = humanChars.includes(c); });
    return E.newGame({ chars, humans, order: SLOT });
  }
  // 画面を新しいゲーム用に整える（intro=true なら GAME START の演出も出す）
  function beginGame(intro) {
    $('char-select-ov').classList.add('hide');
    $('win-ov').classList.remove('show');
    AU.start(); AU.bgm('main');
    document.body.classList.remove('late');
    lateShown = false; prevReach = null; prevMono = null; prevRanks = null;
    ACT.reset(); warping.clear();
    D = view(S);
    prevAssets = null;
    $('log-wrap').innerHTML = '';
    $('tmax').textContent = K.BALANCE.maxTurns;
    cancelAnimationFrame(G.anim); Object.assign(G, { angle: 0, run: false }); updGauge(0); $('dial').classList.remove('running');
    setDieFace($('die1'), 1); setDieFace($('die2'), 1); $('dsum').textContent = '—';
    renderAll();
    ACT.spotlight(S.current);
    announceBoardChanges();
    const orderTxt = (S.order || [0, 1, 2, 3]).map((i) => S.players[i].name).join(' → ');
    addLog(`ゲーム開始！ 順番：${orderTxt}`);
    if (!intro) return Promise.resolve();
    return FX.banner({ text: 'GAME START!', sub: `${K.BALANCE.maxTurns}ターンで一番のお金持ちを目指せ！`, tone: 'gold', dur: 1600, big: true })
      .then(() => FX.banner({ text: '順番決定！', sub: orderTxt, tone: 'gold', dur: 1700 }));
  }

  function initBoardSize() {
    const outer = $('board-outer');
    const rot = $('board-rotated'); rot.style.width = BS + 'px'; rot.style.height = BS + 'px'; rot.style.position = 'relative';
    // スマホ：45度回したボード（対角線＝約1.42倍）が画面に収まるよう縮小
    const land = innerHeight <= 520 && innerWidth > innerHeight, phone = innerWidth <= 760 && !land;
    let avail = $('board-area').offsetWidth || innerWidth;
    if (land) avail = Math.min(avail, innerHeight - 64);
    if (phone || land) {
      outer.style.width = avail + 'px'; outer.style.paddingBottom = avail + 'px';
      rot.style.setProperty('--bscale', Math.min(1, avail / (BS * 1.56)).toFixed(3)); // 四隅を大きくした分も入るように
    } else {
      outer.style.width = ''; outer.style.paddingBottom = ($('board-area').offsetWidth || outer.offsetWidth || BS) + 'px';
      rot.style.setProperty('--bscale', '1');
    }
  }

  // ================= 起動 =================
  buildDie($('die1')); buildDie($('die2'));
  initCharSelect();
  // タイトル画面：まず必要な画像を読み込んで（ロード画面）、終わってからロゴの演出 → タップでキャラ選択へ
  //   招待リンクで開いた時もタイトルから。部屋への参加は裏で進めておく
  (function initTitle() {
    const ov = $('title-ov'); if (!ov) { preloadSprites(); return; }
    const room = NET.roomFromUrl();
    if (room) { const iv = $('tt-invite'); iv.textContent = `👥 部屋 ${room} に招待されています`; iv.hidden = false; }
    // 読み込む画像：タイトル・背景・キャラの絵・コマの動き・四隅のマス（イベントの絵は後回し）
    const urls = new Set([K.IMAGES.title, K.IMAGES.background, ...Object.values(K.CORNER_IMG || {})]);
    Object.values(K.CHARACTERS).forEach((c) => [c.img, c.pin, c.skillImg].forEach((u) => u && urls.add(u)));
    Object.values(K.SPRITES).forEach((c) => Object.values(c).forEach((a) => urls.add(a.src)));
    const list = [...urls]; let done = 0, ready = false, gone = false;
    const bar = $('tt-bar-fill'), pct = $('tt-pct');
    const tick = () => { done++; const v = Math.round((done / list.length) * 100); bar.style.width = v + '%'; pct.textContent = v + '%'; if (done >= list.length) finish(); };
    const load = (u) => new Promise((res) => {
      const im = new Image(); let ok = false; const end = () => { if (!ok) { ok = true; res(); } };
      im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(end); // 先に絵をほどいておく（ゲーム中のカクつき防止）
      im.onerror = end; im.src = u; setTimeout(end, 15000);
    });
    // 同時に読み込みすぎると遅くなるので4本ずつ
    let idx = 0; const worker = () => (idx < list.length ? load(list[idx++]).then(tick).then(worker) : null);
    for (let k = 0; k < 4; k++) worker();
    setTimeout(finish, 20000); // 電波が悪くても20秒で進める
    function finish() {
      if (ready) return; ready = true;
      $('title-logo').src = K.IMAGES.title; if ($('char-select-logo')) $('char-select-logo').src = K.IMAGES.title;
      requestAnimationFrame(() => ov.classList.add('ready'));
      // イベントの絵は、タイトルを出した後にゆっくり読み込む
      const ev = K.EVENTS.map((e) => e.img).filter(Boolean); let j = 0;
      const lazy = () => { if (j < ev.length) load(ev[j++]).then(() => setTimeout(lazy, 120)); };
      setTimeout(lazy, 1500);
    }
    const go = () => {
      if (!ready || gone) return; gone = true;
      // タップの「クリック」が下のキャラ選択に突き抜けて、いきなりゲームが始まるのを防ぐ（0.8秒はクリックを受け付けない）
      const block = (e) => { e.stopPropagation(); e.preventDefault(); };
      addEventListener('click', block, true);
      setTimeout(() => removeEventListener('click', block, true), 800);
      AU.start();
      ov.classList.add('out');
      setTimeout(() => ov.remove(), 650);
    };
    ov.addEventListener('pointerup', go);
    addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') go(); });
  })();
  { const rc = NET.roomFromUrl(); if (rc) waitNet(() => enterJoin(rc)); } // 招待リンク（?room=…）で開いたら、その部屋に入る（タイトルの裏で）
  initDebug();
  initBoardSize();
  FX.init(speed);
  ACT.init({ board: $('board-rotated'), cpos, speed });
  // 盤面の中央（コントロール部分と図面）をタップするとサイコロが止まる。スペースキーでも可
  // 指を離した瞬間（クリックを離した瞬間）に止める。押し始めもゲージが回っている間に限る
  let pressArmed = false;
  const onTapArea = (ev) => !!(ev.target.closest('#ctrl-panel') || ev.target.closest('#board-sheet'));
  window.addEventListener('pointerdown', (ev) => { pressArmed = ev.button <= 0 && G.run && onTapArea(ev); }, true);
  window.addEventListener('pointerup', (ev) => { if (!pressArmed) return; pressArmed = false; if (onTapArea(ev) && onBoardTap(ev.timeStamp)) ev.preventDefault(); }, true);
  window.addEventListener('pointercancel', () => { pressArmed = false; }, true);
  window.addEventListener('keydown', (ev) => { if (ev.code === 'Space') ev.preventDefault(); });
  window.addEventListener('keyup', (ev) => { if (ev.code === 'Space') { ev.preventDefault(); onBoardTap(ev.timeStamp); } });
  const sysBtn = () => {
    $('btn-bgm').classList.toggle('off', !AU.prefs.bgm);
    $('btn-se').classList.toggle('off', !AU.prefs.se);
    $('btn-speed').textContent = `速度 ×${speed()}`;
  };
  $('btn-bgm').onclick = () => { AU.start(); AU.toggle('bgm'); sysBtn(); };
  $('btn-se').onclick = () => { AU.start(); AU.toggle('se'); sysBtn(); };
  $('btn-speed').onclick = () => { speedIdx = (speedIdx + 1) % SPEEDS.length; try { localStorage.setItem('gr_speed', speed()); } catch (e) { /* 無視 */ } sysBtn(); };
  sysBtn();
  window.addEventListener('resize', () => { initBoardSize(); if (D) { renderBoard(); markCellTargets(); } });
  // 開発用：コンソールから台帳を確認できる
  window.GR_DEBUG = { get state() { return S; }, act: (a) => act(a), get canTap() { const w = S && E.whoActs(S); return !!(w && w.kind === 'roll' && isMe(w.player) && G.run && !playing); }, net: NET, tap: () => onBoardTap(), splash: (e) => showSplash(e) };
})();
