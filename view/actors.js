// =====================================================================
// ゲットリッチ復活 v2 — キャラクターの演技（盤上のコマ＋パネルの立ち絵）
//
// 「パラパラ漫画の絵（コマ画像）」と「人形の動かし方（コードで動かす体の動き）」を組み合わせて、
// 少ないコマ数でも生き生き見せる。毎フレーム（1秒に60回）全員の姿勢を計算して描く。
//
//   GR.actors.init({ board, cpos, speed })
//   GR.actors.sync(D)                     台帳の表示用コピーを渡す（位置・破産・休みなどを反映）
//   await GR.actors.hop(pi)               1マス分ジャンプして D の位置へ進む
//   await GR.actors.land(pi)              ゴールのマスに大きく着地
//   GR.actors.react(pi, kind, strength)   'happy' | 'sad' | 'smirk' | 'cheer'、strength: 'big' | 'small'
//   GR.actors.spotlight(pi)               手番の人を大きく・手前に
//   GR.actors.anticipate(pi, on)          サイコロ待ちのそわそわ
//   GR.actors.pray(pi, on)                パネルの立ち絵が「スキル来い…」と祈る
//   await GR.actors.warpOut(pi) / warpIn(pi)  ワープで消える／現れる
//   GR.actors.afterimage(pi)              残像（追い越し略奪）
//   GR.actors.camera(pi, scale)           盤面をそのコマへ少し寄せる
//   GR.actors.finale(winner)              優勝演出（勝者は跳ね続け、他はドミノ倒しでorz）
// =====================================================================
(function (root) {
  const GR = (root.GR = root.GR || {});
  const K = () => GR.CONFIG;
  const A = () => GR.CONFIG.ACTOR;
  let board = null, cposFn = null, speed = () => 1, D = null;
  const actors = [];
  const reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const now = () => performance.now();
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const U = { x: Math.SQRT1_2, y: -Math.SQRT1_2 }; // 画面の右方向（盤面座標）
  const V = { x: Math.SQRT1_2, y: Math.SQRT1_2 };  // 画面の下方向（盤面座標）

  function init(opts) {
    board = opts.board; cposFn = opts.cpos; if (opts.speed) speed = opts.speed;
    requestAnimationFrame(loop);
  }
  const dur = (ms) => ms / speed();

  // ---------- 1人分の部品を作る ----------
  function make(pi, char) {
    const el = document.createElement('div');
    el.className = 'token actor';
    el.id = 'token' + pi;
    el.innerHTML = '<div class="actor-shadow"></div><div class="actor-body"><div class="actor-spr"></div></div><div class="actor-ov"></div>';
    board.appendChild(el);
    return {
      pi, char, el,
      body: el.querySelector('.actor-body'), spr: el.querySelector('.actor-spr'),
      shadow: el.querySelector('.actor-shadow'), ov: el.querySelector('.actor-ov'),
      ava: null, avaSpr: null,
      cell: null, x: 0, y: 0, tx: 0, ty: 0,
      facing: 1, spot: 1, spotTarget: 1, dim: 1, dimTarget: 1,
      phase: Math.random() * Math.PI * 2, breath: rnd(2600, 3400),
      nextBlink: now() + rnd(800, 3000), blinkUntil: 0,
      nextFidget: now() + rnd(4000, 9000), fidget: null,
      hopAnim: null, react: null, pending: null, warp: null,
      anticipate: false, pray: false, final: null, ovKind: '',
      loopOffset: Math.random() * 4000, curKey: '', avaKey: '',
    };
  }
  function ensure() {
    if (!D) return;
    D.players.forEach((p, pi) => {
      let a = actors[pi];
      if (a && a.char !== p.char) { a.el.remove(); if (a.ava) a.ava.innerHTML = ''; a = null; }
      if (!a || !a.el.isConnected) {
        if (a) a.el.remove();
        a = actors[pi] = make(pi, p.char);
        a.cell = p.pos;
        const t = target(pi, p.pos);
        a.x = a.tx = t.x; a.y = a.ty = t.y;
      }
    });
  }
  // パネルの立ち絵の置き場所を渡してもらう
  function attachAva(pi, container) {
    const a = actors[pi];
    if (!a || a.ava === container) return;
    a.ava = container;
    container.innerHTML = '<div class="ava-spr"></div>';
    a.avaSpr = container.firstChild;
    a.avaKey = '';
  }

  // ---------- 同じマスにいる人は扇形に並べる ----------
  function cellCenter(id) {
    const c = cposFn(id);
    return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
  }
  function target(pi, cell) {
    const here = actors.filter((a) => a && a.cell === cell).map((a) => a.pi);
    if (!here.includes(pi)) here.push(pi);
    here.sort((a, b) => a - b);
    const n = here.length, k = here.indexOf(pi);
    const spreads = { 1: [0], 2: [-11, 11], 3: [-15, 0, 15], 4: [-17, -6, 6, 17] };
    const sx = (spreads[n] || spreads[4])[k] || 0;
    const sy = n >= 3 ? (k % 2 ? 4 : -3) : 0;
    const c = cellCenter(cell);
    return { x: c.x + U.x * sx + V.x * sy, y: c.y + U.y * sx + V.y * sy };
  }
  function retarget() {
    actors.forEach((a) => { if (a && !a.hopAnim) { const t = target(a.pi, a.cell); a.tx = t.x; a.ty = t.y; } });
  }

  // ---------- 台帳との同期 ----------
  function sync(view) {
    D = view;
    if (!board) return;
    ensure();
    actors.forEach((a, pi) => {
      if (!a) return;
      const p = D.players[pi];
      if (!a.hopAnim && !a.warp && a.cell !== p.pos) {
        // ジャンプ以外で位置が変わった（強制送還など）→ その場で置き直す
        a.cell = p.pos;
        const t = target(pi, p.pos); a.x = a.tx = t.x; a.y = a.ty = t.y;
      }
    });
    retarget();
  }

  // ---------- 移動：1マス＝1ジャンプ ----------
  // 足元をマスの中心より少し下に置き、体の真ん中がマスの上に来るようにする（立ち絵が縦長なので）
  const FOOT = () => Math.round(A().tokenH * (A().footShift != null ? A().footShift : 0.3));
  function hop(pi, onTouch) {
    const a = actors[pi]; if (!a || !D) return Promise.resolve();
    const to = D.players[pi].pos;
    const from = { x: a.x, y: a.y };
    const fromCell = a.cell;
    a.cell = to;
    // 跳んでいる間はマスのど真ん中に着地（並び替えは着地後）
    const t = cellCenter(to);
    retarget();
    // 進む向き（画面上の左右）で向きを変える
    const sxDir = (t.x - from.x) * U.x + (t.y - from.y) * U.y;
    if (Math.abs(sxDir) > 2) a.facing = sxDir >= 0 ? 1 : -1;
    a.react = null; a.fidget = null;
    return new Promise((res) => {
      a.hopAnim = { start: now(), ms: dur(A().hopMs), from, to: t, h: A().hopHeight, done: res, fromCell, kind: 'hop', onTouch };
    });
  }
  function land(pi) {
    const a = actors[pi]; if (!a) return Promise.resolve();
    a.landFx = { start: now(), ms: dur(380) };
    dust(a, 8, 1.4);
    return new Promise((r) => setTimeout(r, dur(180)));
  }
  // その場で置く（ワープ中など）
  function place(pi) {
    const a = actors[pi]; if (!a || !D) return;
    a.cell = D.players[pi].pos;
    const t = target(pi, a.cell); a.x = a.tx = t.x; a.y = a.ty = t.y;
    retarget();
  }

  // ---------- 反応 ----------
  // kind: happy / sad / smirk（他人の不幸でニヤッ）/ cheer（ターン開始の「よしっ」）
  function react(pi, kind, strength = 'big') {
    const a = actors[pi]; if (!a || !D || D.players[pi].bankrupt || a.final) return;
    const r = { kind, strength, start: now() + (a.hopAnim ? 0 : 0) };
    const table = {
      happy: strength === 'big' ? 1900 : 900,
      sad: strength === 'big' ? 2300 : 1000,
      smirk: 800, cheer: 650,
    };
    r.ms = dur(table[kind] || 1000);
    if (a.hopAnim || a.warp) { a.pending = r; return; } // 着地してから演技する
    a.react = r; a.fidget = null;
    if (kind === 'happy' && strength === 'big') sparkle(a);
    if (kind === 'sad' && strength === 'big') setOv(a, 'gloom', r.ms);
    avaBounce(a, kind === 'sad' ? 'sad' : 'happy');
  }
  function spotlight(pi) {
    actors.forEach((a) => { if (!a) return; a.spotTarget = a.pi === pi ? A().spotScale : 0.94; a.dimTarget = a.pi === pi ? 1 : 0.82; });
  }
  function anticipate(pi, on) { const a = actors[pi]; if (a) a.anticipate = on; }
  function pray(pi, on) { const a = actors[pi]; if (a) a.pray = on; }

  // ---------- ワープ ----------
  function warpOut(pi) {
    const a = actors[pi]; if (!a) return Promise.resolve();
    a.warp = { kind: 'out', start: now(), ms: dur(520) };
    starBurst(a);
    return new Promise((r) => setTimeout(r, dur(520)));
  }
  // 飛行機で移動：コマがふわっと消え、飛行機が弧を描いて行き先へ飛ぶ
  function flyTo(pi, toCell) {
    const a = actors[pi]; if (!a || !GR.fx) return Promise.resolve();
    const from = screenPt(a);
    const cellEl = document.querySelector(`#board-rotated .cell[data-cell-id="${toCell}"]`);
    const to = cellEl ? (() => { const r = cellEl.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })() : from;
    a.warp = { kind: 'out', start: now(), ms: dur(260) };
    return new Promise((res) => {
      setTimeout(() => {
        GR.fx.plane(from, to, D.players[pi].color, dur(1200)).then(res);
      }, dur(200));
    });
  }
  function warpIn(pi) {
    const a = actors[pi]; if (!a) return Promise.resolve();
    place(pi);
    a.warp = { kind: 'in', start: now(), ms: dur(480) };
    starBurst(a);
    return new Promise((r) => setTimeout(() => { if (a.warp && a.warp.kind === 'in') a.warp = null; flushPending(a); r(); }, dur(480)));
  }
  function flushPending(a) { if (a.pending) { const p = a.pending; a.pending = null; react(a.pi, p.kind, p.strength); } }

  // ---------- 小さな演出部品 ----------
  function screenPt(a) { const r = a.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function dust(a, n = 5, size = 1) {
    if (!GR.fx || reduced) return;
    const p = screenPt(a);
    GR.fx.burst(p.x, p.y + 2, ['rgba(220,210,255,.8)', 'rgba(255,255,255,.6)'], n, 22 * size);
  }
  function sparkle(a) { if (!GR.fx) return; const p = screenPt(a); GR.fx.burst(p.x, p.y - 30, ['#ffe14d', '#fff', '#ff9ad5'], 14, 55); }
  function starBurst(a) { if (!GR.fx) return; const p = screenPt(a); GR.fx.burst(p.x, p.y - 20, ['#fff27a', '#8fe3ff', '#ffffff'], 20, 70); }
  function setOv(a, kind, ms) {
    a.ovKind = kind; a.ov.className = 'actor-ov ' + kind;
    if (ms && ms !== Infinity) setTimeout(() => { if (a.ovKind === kind) { a.ovKind = ''; a.ov.className = 'actor-ov'; } }, ms);
  }
  function afterimage(pi) {
    const a = actors[pi]; if (!a) return;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const g = a.el.cloneNode(true);
        g.removeAttribute('id'); g.classList.add('actor-ghost');
        board.appendChild(g);
        g.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: dur(380), easing: 'ease-out', fill: 'forwards' });
        setTimeout(() => g.remove(), dur(400));
      }, dur(i * 70));
    }
  }
  function avaBounce(a, kind) {
    if (!a.ava) return;
    a.ava.animate(kind === 'sad'
      ? [{ transform: 'translateY(0)' }, { transform: 'translateY(4px) scale(.96)' }, { transform: 'translateY(0)' }]
      : [{ transform: 'translateY(0)' }, { transform: 'translateY(-10px) scale(1.08)' }, { transform: 'translateY(0)' }], { duration: dur(500), easing: 'cubic-bezier(.3,1.6,.5,1)' });
  }
  function camera(pi, scale = 1.05, ms = 700) {
    const a = actors[pi]; const box = document.getElementById('board-container');
    if (!a || !box || reduced) return;
    const r = box.getBoundingClientRect(), p = screenPt(a);
    box.style.transformOrigin = `${p.x - r.left}px ${p.y - r.top}px`;
    box.animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})`, offset: 0.35 }, { transform: `scale(${scale})`, offset: 0.7 }, { transform: 'scale(1)' }], { duration: dur(ms), easing: 'ease-in-out' });
  }
  function finale(winner) {
    actors.forEach((a) => { if (a) { a.react = null; a.pending = null; } });
    const w = actors[winner];
    if (w) w.final = { kind: 'winner', start: now() };
    let k = 0;
    actors.forEach((a) => {
      if (!a || a.pi === winner) return;
      const delay = 400 + k++ * 320;
      setTimeout(() => { a.final = { kind: 'loser', start: now() }; setOv(a, 'gloom', Infinity); }, dur(delay));
    });
  }
  function reset() {
    actors.forEach((a) => { if (a) { a.el.remove(); if (a.ava) a.ava.innerHTML = ''; } });
    actors.length = 0;
  }

  // ---------- コマ画像の切り替え ----------
  function frameOf(a, state, idx) {
    const s = K().SPRITES[a.char][state];
    return { s, idx: Math.max(0, Math.min(s.n - 1, idx)) };
  }
  const frac = (a, state, f) => Math.round(f * (K().SPRITES[a.char][state].n - 1));
  function setSprite(node, a, state, idx, h, keyProp) {
    const { s, idx: i } = frameOf(a, state, idx);
    const w = Math.round((s.w * h) / s.h);
    if (a[keyProp] !== state) {
      a[keyProp] = state;
      node.style.backgroundImage = `url('${s.src}')`;
      node.style.width = w + 'px'; node.style.height = h + 'px';
      node.style.backgroundSize = `${w * s.n}px ${h}px`;
    }
    node.style.backgroundPosition = `${-i * w}px 0`;
  }

  // ---------- 毎フレームの計算 ----------
  function loop() {
    const t = now();
    if (D) actors.forEach((a) => { if (a && a.el.isConnected) step(a, t); });
    requestAnimationFrame(loop);
  }
  function step(a, t) {
    const p = D.players[a.pi];
    const cfg = A().chars[a.char];
    let state = 'idle', idx = 0, jumpY = 0, sx = 1, sy = 1, rot = 0, opacity = 1, shadowS = 1, flip = a.facing;

    // 位置：ジャンプ中でなければ目標へなめらかに寄る（扇形の並び替えなど）
    if (!a.hopAnim) { a.x += (a.tx - a.x) * 0.2; a.y += (a.ty - a.y) * 0.2; }
    a.spot += (a.spotTarget - a.spot) * 0.12;
    a.dim += (a.dimTarget - a.dim) * 0.12;

    const breathe = Math.sin((t / a.breath) * Math.PI * 2 + a.phase);

    if (a.hopAnim) {
      const h = a.hopAnim, pr = clamp01((t - h.start) / h.ms);
      const hf = cfg.hopFrames;
      state = 'move'; idx = hf[Math.min(hf.length - 1, Math.floor(pr * hf.length))];
      // 跳ぶ→早めに着地→着地したマスで少し踏ん張る（マスより遅れて見えないように）
      const airT = clamp01((pr - 0.05) / 0.6);
      const m = ease(clamp01((pr - 0.05) / 0.6));
      a.x = h.from.x + (h.to.x - h.from.x) * m;
      a.y = h.from.y + (h.to.y - h.from.y) * m;
      jumpY = reduced ? 0 : -h.h * Math.sin(Math.PI * airT) * (airT > 0 && airT < 1 ? 1 : 0);
      if (pr >= 0.65 && !h.touched) { h.touched = true; if (h.onTouch) h.onTouch(); }
      if (pr < 0.05) { sy = 1 - 0.1 * (pr / 0.05); sx = 1 + 0.06 * (pr / 0.05); }
      else if (pr > 0.65) { const q = (pr - 0.65) / 0.35; sy = 0.86 + 0.14 * q; sx = 1.08 - 0.08 * q; }
      else { sy = 1.06; sx = 0.96; }
      shadowS = 1 - 0.45 * Math.sin(Math.PI * airT);
      if (pr >= 1) {
        a.hopAnim = null; a.x = h.to.x; a.y = h.to.y;
        const ft = target(a.pi, a.cell); a.tx = ft.x; a.ty = ft.y;
        dust(a, 4, 0.8);
        h.done();
        flushPending(a);
      }
    } else if (a.final) {
      const el = (t - a.final.start) / 1000;
      if (a.final.kind === 'winner') {
        state = 'happy'; idx = frac(a, 'happy', 1);
        const ph = (el * 1.6) % 1;
        jumpY = -26 * Math.sin(Math.PI * ph); sy = ph < 0.08 || ph > 0.92 ? 0.9 : 1.05;
        shadowS = 1 - 0.4 * Math.sin(Math.PI * ph);
        if (ph < 0.03 && !a._sp) { a._sp = 1; sparkle(a); } else if (ph > 0.5) a._sp = 0;
      } else {
        state = 'sad'; idx = Math.round(clamp01(el / 0.7) * (K().SPRITES[a.char].sad.n - 1));
      }
    } else if (p.bankrupt) {
      state = 'sad'; idx = frac(a, 'sad', 1); opacity = 0.55;
    } else if (a.react && t < a.react.start + a.react.ms) {
      const r = a.react, pr = clamp01((t - r.start) / r.ms);
      if (r.kind === 'happy') {
        state = 'happy';
        const play = cfg.mode === 'strip' ? 0.7 : 0.35;     // コマを送る区間→残りは決めポーズで止め
        idx = frac(a, 'happy', Math.min(1, pr / play));
        if (r.strength === 'big') {
          if (pr < 0.08) { sy = 1 - 0.15 * (pr / 0.08); sx = 1.06; }                       // ため
          else if (pr < 0.4) { const q = (pr - 0.08) / 0.32; jumpY = -30 * Math.sin(Math.PI * q); sy = 1.08; sx = 0.95; shadowS = 1 - 0.5 * Math.sin(Math.PI * q); }
          else { sy = 1 + 0.02 * Math.sin(t / 90); rot = Math.sin(t / 160) * 3; }           // 決めポーズでゆらゆら
        } else {
          const q = clamp01(pr / 0.5); jumpY = -10 * Math.sin(Math.PI * q);
        }
      } else if (r.kind === 'sad') {
        state = 'sad';
        if (r.strength === 'big') { idx = frac(a, 'sad', Math.min(1, pr / 0.35)); if (pr > 0.35) sx = 1 + 0.01 * Math.sin(t / 70); }
        else { idx = frac(a, 'sad', 0.34); sy = 0.97; }
      } else if (r.kind === 'smirk') {
        state = 'happy'; idx = frac(a, 'happy', 0.34);
        jumpY = -7 * Math.abs(Math.sin(pr * Math.PI * 2)); rot = Math.sin(pr * Math.PI * 4) * 4;
      } else if (r.kind === 'cheer') {
        state = 'happy'; idx = 0;
        jumpY = -14 * Math.sin(Math.PI * pr); sy = pr < 0.15 ? 0.9 : 1.05;
        shadowS = 1 - 0.4 * Math.sin(Math.PI * pr);
      }
    } else if (p.skip > 0) {
      // 1回休み中：座り込んで「zzz」
      state = 'sad'; idx = frac(a, 'sad', 1); sy = 1 + 0.015 * breathe;
      if (a.ovKind !== 'zzz') setOv(a, 'zzz');
    } else {
      if (a.react) { a.react = null; }
      if (a.ovKind === 'zzz') setOv(a, '');
      // 待機：止め絵＋呼吸＋ランダムなまばたき・仕草
      state = 'idle';
      if (cfg.mode === 'strip') {
        const s = K().SPRITES[a.char].idle;
        idx = Math.floor(((t + a.loopOffset) / (s.ms / s.n))) % s.n;
      } else {
        idx = cfg.idleBase;
        if (t > a.nextBlink) { a.blinkUntil = t + 130; a.nextBlink = t + rnd(1800, 5200); if (Math.random() < 0.25) a.nextBlink = t + 260; }
        if (t < a.blinkUntil) idx = cfg.blink;
      }
      const speedUp = a.anticipate ? 4 : 1;
      sy = 1 + 0.025 * Math.sin((t / a.breath) * Math.PI * 2 * speedUp + a.phase);
      sx = 1 - 0.01 * Math.sin((t / a.breath) * Math.PI * 2 * speedUp + a.phase);
      if (a.anticipate) { rot = Math.sin(t / 45) * 1.5; }
      // たまに小さな仕草（その場ジャンプ／きょろきょろ）
      if (!a.fidget && t > a.nextFidget && !a.anticipate) {
        a.fidget = { kind: Math.random() < 0.55 ? 'look' : 'bounce', start: t, ms: 900 };
        a.nextFidget = t + rnd(5000, 11000);
      }
      if (a.fidget) {
        const f = a.fidget, q = (t - f.start) / f.ms;
        if (q >= 1) a.fidget = null;
        else if (f.kind === 'look') { flip = q > 0.15 && q < 0.75 ? -a.facing : a.facing; }
        else { jumpY = -8 * Math.sin(Math.PI * clamp01(q / 0.5)); }
      }
    }

    // ワープ（くるっと回って消える／ポンと現れる）
    if (a.warp) {
      const w = a.warp, q = clamp01((t - w.start) / w.ms);
      if (w.kind === 'out') { rot += 720 * ease(q); sx *= 1 - q; sy *= 1 - q; jumpY -= 30 * q; opacity *= 1 - q * 0.3; if (q >= 1) opacity = 0; }
      else { const s2 = q < 0.6 ? (q / 0.6) * 1.25 : 1.25 - 0.25 * ((q - 0.6) / 0.4); sx *= s2; sy *= s2; rot += 360 * (1 - ease(q)); }
      if (w.kind === 'out' && q >= 1) { /* 消えたまま：warpIn まで待つ */ }
    }
    // 着地の潰れ
    if (a.landFx) {
      const q = (t - a.landFx.start) / a.landFx.ms;
      if (q >= 1) a.landFx = null;
      else { const k = Math.sin(Math.PI * q); sy *= 1 - 0.18 * k; sx *= 1 + 0.12 * k; }
    }

    setSprite(a.spr, a, state, idx, A().tokenH, 'curKey');
    const spot = a.spot;
    a.el.style.left = a.x.toFixed(1) + 'px';
    a.el.style.top = a.y.toFixed(1) + 'px';
    a.el.style.zIndex = String(20 + Math.round((a.x + a.y) / 8) + (a.spotTarget > 1 ? 60 : 0));
    a.el.style.transform = `rotate(-45deg) translateZ(60px) translateY(${FOOT()}px) scale(${spot.toFixed(3)})`;
    a.shadow.classList.toggle('moving', !!a.hopAnim); a.shadow.style.setProperty('--pc', p.color);
    a.el.style.opacity = opacity;
    a.el.style.filter = p.bankrupt ? 'grayscale(1) brightness(.7)' : `brightness(${a.dim.toFixed(3)})`;
    a.body.style.transform = `translate(-50%, ${jumpY.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${(sx * flip).toFixed(3)}, ${sy.toFixed(3)})`;
    a.shadow.style.transform = `translate(-50%,-50%) scale(${shadowS.toFixed(3)})`;
    a.shadow.style.opacity = (0.25 + 0.35 * shadowS) * (opacity > 0.1 ? 1 : 0);
    if (a.ava) {
      const pr2 = a.pray && state === 'idle';
      if (a.avaSpr) { if (pr2) setSprite(a.avaSpr, a, 'happy', 0, A().avaH, 'avaKey'); else setSprite(a.avaSpr, a, state, idx, A().avaH, 'avaKey'); }
      a.ava.style.setProperty('--tremble', pr2 ? '1' : '0');
      a.ava.classList.toggle('praying', pr2);
      a.ava.style.filter = p.bankrupt ? 'grayscale(1) brightness(.6)' : '';
    }
  }

  GR.actors = { init, sync, hop, land, place, react, spotlight, anticipate, pray, warpOut, warpIn, flyTo, afterimage, camera, finale, attachAva, reset, screenPt: (pi) => actors[pi] && screenPt(actors[pi]) };
})(typeof globalThis !== 'undefined' ? globalThis : this);
