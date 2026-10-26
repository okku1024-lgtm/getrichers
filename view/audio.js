// =====================================================================
// ゲットリッチ復活 v2 — BGM・効果音
// 音声ファイルは使わず、ブラウザの Web Audio で毎回その場で鳴らす（オリジナル曲）。
//   GR.audio.start()        最初のクリック時に呼ぶ（ブラウザの決まりで、操作前は音が出せない）
//   GR.audio.bgm('main' | 'late' | 'win' | null)
//   GR.audio.se('coin')     効果音
//   GR.audio.toggle('bgm' | 'se')
// =====================================================================
(function (root) {
  const GR = (root.GR = root.GR || {});
  let ctx = null, master = null, bgmBus = null, seBus = null, noiseBuf = null;
  const prefs = { bgm: true, se: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('gr_audio') || '{}')); } catch (e) { /* 保存できなくても続行 */ }
  const save = () => { try { localStorage.setItem('gr_audio', JSON.stringify(prefs)); } catch (e) { /* 無視 */ } };
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    bgmBus = ctx.createGain(); bgmBus.gain.value = prefs.bgm ? 0.32 : 0; bgmBus.connect(master);
    seBus = ctx.createGain(); seBus.gain.value = prefs.se ? 0.7 : 0; seBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  // ---------- 音の部品 ----------
  function tone(bus, { f, t = 0, dur = 0.12, type = 'square', vol = 0.2, slide = null, attack = 0.005 }) {
    if (!ctx) return;
    const at = ctx.currentTime + t;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, at);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(bus);
    o.start(at); o.stop(at + dur + 0.02);
  }
  function noise(bus, { t = 0, dur = 0.08, vol = 0.2, hp = 4000, lp = null }) {
    if (!ctx) return;
    const at = ctx.currentTime + t;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const g = ctx.createGain();
    let node = src;
    if (hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    node.connect(g); g.connect(bus);
    src.start(at, Math.random() * 0.5); src.stop(at + dur + 0.02);
  }

  // ---------- 効果音 ----------
  const SE = {
    click: () => tone(seBus, { f: 880, dur: 0.05, vol: 0.12 }),
    step: () => tone(seBus, { f: 660 + Math.random() * 60, dur: 0.05, type: 'triangle', vol: 0.18 }),
    dice: () => { for (let i = 0; i < 5; i++) noise(seBus, { t: i * 0.06, dur: 0.04, vol: 0.25, hp: 1500 }); },
    diceStop: () => { tone(seBus, { f: 220, dur: 0.15, type: 'triangle', vol: 0.3, slide: 80 }); noise(seBus, { dur: 0.06, vol: 0.2, hp: 800 }); },
    doubles: () => [72, 76, 79, 84, 88].forEach((m, i) => tone(seBus, { f: mtof(m), t: i * 0.06, dur: 0.14, vol: 0.18 })),
    coin: () => { tone(seBus, { f: mtof(83), dur: 0.07, vol: 0.15 }); tone(seBus, { f: mtof(88), t: 0.07, dur: 0.22, vol: 0.15 }); },
    cash: () => { [76, 79, 84, 88, 91].forEach((m, i) => tone(seBus, { f: mtof(m), t: i * 0.05, dur: 0.12, vol: 0.14 })); noise(seBus, { t: 0.25, dur: 0.15, vol: 0.12, hp: 6000 }); },
    pay: () => [79, 75, 72, 67].forEach((m, i) => tone(seBus, { f: mtof(m), t: i * 0.07, dur: 0.12, type: 'sawtooth', vol: 0.1 })),
    bigPay: () => { [84, 80, 77, 72, 68, 65].forEach((m, i) => tone(seBus, { f: mtof(m), t: i * 0.08, dur: 0.16, type: 'sawtooth', vol: 0.12 })); noise(seBus, { t: 0.1, dur: 0.4, vol: 0.15, hp: 200, lp: 1200 }); },
    build: () => { [60, 64, 67, 72].forEach((m, i) => tone(seBus, { f: mtof(m), t: i * 0.07, dur: 0.14, vol: 0.16 })); noise(seBus, { t: 0.28, dur: 0.12, vol: 0.12, hp: 3000 }); },
    landmark: () => { [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => tone(seBus, { f: mtof(m), t: i * 0.06, dur: 0.2, vol: 0.16 })); [72, 76, 79].forEach((m) => tone(seBus, { f: mtof(m), t: 0.45, dur: 0.7, type: 'triangle', vol: 0.15 })); },
    acquire: () => { tone(seBus, { f: 200, dur: 0.3, type: 'sawtooth', vol: 0.15, slide: 800 }); [79, 83, 86].forEach((m, i) => tone(seBus, { f: mtof(m), t: 0.3 + i * 0.07, dur: 0.15, vol: 0.15 })); },
    skill: () => { tone(seBus, { f: 300, dur: 0.5, type: 'sawtooth', vol: 0.12, slide: 2400 }); [72, 76, 79, 84].forEach((m) => tone(seBus, { f: mtof(m), t: 0.45, dur: 0.8, type: 'square', vol: 0.07 })); noise(seBus, { t: 0.45, dur: 0.5, vol: 0.12, hp: 5000 }); },
    event: () => [67, 72, 76, 72, 79].forEach((m, i) => tone(seBus, { f: mtof(m), t: i * 0.09, dur: 0.15, type: 'triangle', vol: 0.2 })),
    quake: () => { noise(seBus, { dur: 1.6, vol: 0.5, hp: 30, lp: 300 }); tone(seBus, { f: 60, dur: 1.4, type: 'sawtooth', vol: 0.2, slide: 30 }); },
    boom: () => { noise(seBus, { dur: 0.6, vol: 0.5, hp: 40, lp: 900 }); tone(seBus, { f: 120, dur: 0.5, type: 'square', vol: 0.15, slide: 40 }); },
    bad: () => [64, 63, 62, 58].forEach((m, i) => tone(seBus, { f: mtof(m), t: i * 0.18, dur: 0.22, type: 'square', vol: 0.12 })),
    turn: () => { tone(seBus, { f: mtof(79), dur: 0.08, vol: 0.12 }); tone(seBus, { f: mtof(84), t: 0.08, dur: 0.16, vol: 0.12 }); },
    reach: () => { for (let i = 0; i < 3; i++) tone(seBus, { f: mtof(88), t: i * 0.12, dur: 0.08, vol: 0.14 }); tone(seBus, { f: mtof(93), t: 0.36, dur: 0.3, vol: 0.14 }); },
    lap: () => [72, 76, 79, 84, 79, 84].forEach((m, i) => tone(seBus, { f: mtof(m), t: i * 0.07, dur: 0.12, vol: 0.14 })),
    whoosh: () => noise(seBus, { dur: 0.35, vol: 0.18, hp: 900 }),
    plane: () => { noise(seBus, { dur: 1.2, vol: 0.12, hp: 400, lp: 2500 }); tone(seBus, { f: 180, dur: 1.2, type: 'sawtooth', vol: 0.05, slide: 260 }); },
    rattle: () => { noise(seBus, { dur: 0.03, vol: 0.18, hp: 2500 }); tone(seBus, { f: 900 + Math.random() * 500, dur: 0.03, type: 'square', vol: 0.04 }); },
    gaugeStop: () => { tone(seBus, { f: mtof(84), dur: 0.08, vol: 0.16 }); tone(seBus, { f: mtof(91), t: 0.06, dur: 0.18, vol: 0.14 }); },
    slam: () => { tone(seBus, { f: 160, dur: 0.25, type: 'sine', vol: 0.5, slide: 40 }); noise(seBus, { dur: 0.2, vol: 0.35, hp: 60, lp: 1500 }); noise(seBus, { t: 0.02, dur: 0.12, vol: 0.2, hp: 4000 }); },
    roulette: () => tone(seBus, { f: 1200 + Math.random() * 400, dur: 0.025, type: 'square', vol: 0.05 }),
    bigRoll: () => [72, 79, 84, 91].forEach((m, i) => tone(seBus, { f: mtof(m), t: i * 0.05, dur: 0.16, vol: 0.14 })),
    win: () => {
      const seq = [[72, 0], [72, 0.12], [72, 0.24], [76, 0.36], [79, 0.6], [76, 0.84], [79, 0.96], [84, 1.2]];
      seq.forEach(([m, t]) => tone(seBus, { f: mtof(m), t, dur: 0.2, vol: 0.16 }));
      [72, 76, 79, 84].forEach((m) => tone(seBus, { f: mtof(m), t: 1.2, dur: 1.4, type: 'triangle', vol: 0.12 }));
    },
  };
  function se(name) { if (ctx && prefs.se && SE[name]) SE[name](); }

  // ---------- BGM（オリジナル曲：C-G-Am-F の明るい進行） ----------
  // メロディ：小節ごとに [16分音符の位置, MIDI音程, 長さ(16分音符数)]
  const MELODY = [
    [[0, 72, 2], [2, 76, 2], [4, 79, 3], [8, 76, 2], [10, 77, 2], [12, 79, 4]],
    [[0, 79, 2], [2, 77, 2], [4, 74, 3], [8, 71, 2], [10, 74, 2], [12, 79, 4]],
    [[0, 76, 2], [2, 72, 2], [4, 69, 3], [8, 72, 2], [10, 76, 2], [12, 81, 4]],
    [[0, 77, 3], [4, 76, 2], [6, 74, 2], [8, 72, 4], [12, 74, 4]],
    [[0, 72, 2], [2, 76, 2], [4, 79, 2], [6, 84, 2], [8, 83, 2], [10, 81, 2], [12, 79, 4]],
    [[0, 77, 2], [2, 79, 2], [4, 77, 2], [6, 76, 2], [8, 74, 4], [12, 71, 4]],
    [[0, 69, 2], [2, 72, 2], [4, 77, 2], [6, 81, 2], [8, 79, 2], [10, 77, 2], [12, 76, 2], [14, 74, 2]],
    [[0, 74, 4], [4, 79, 2], [6, 76, 2], [8, 72, 8]],
  ];
  const CHORDS = [[48, 0], [43, 7], [45, 9], [41, 5], [48, 0], [43, 7], [41, 5], [43, 7]]; // [ベース音, 和音の根音(半音)]
  const TRIAD = { 0: [60, 64, 67], 7: [59, 62, 67], 9: [60, 64, 69], 5: [60, 65, 69] };
  const MODES = { main: { bpm: 138, lead: 'square' }, late: { bpm: 166, lead: 'sawtooth' } };
  let mode = null, timer = null, step = 0, nextAt = 0;

  function scheduleStep(st, at) {
    const m = MODES[mode], bar = Math.floor(st / 16) % 8, pos = st % 16, s16 = 60 / m.bpm / 4;
    const t = at - ctx.currentTime;
    // メロディ
    MELODY[bar].forEach(([p, note, len]) => {
      if (p === pos) tone(bgmBus, { f: mtof(note), t, dur: s16 * len * 0.9, type: m.lead, vol: mode === 'late' ? 0.07 : 0.09 });
    });
    // ベース（8分音符でオクターブ跳躍）
    const [bass, root] = CHORDS[bar];
    if (pos % 2 === 0) tone(bgmBus, { f: mtof(bass + (pos % 4 === 2 ? 12 : 0)), t, dur: s16 * 1.6, type: 'triangle', vol: 0.22 });
    // 裏拍の和音（はずむ感じ）
    if (pos === 2 || pos === 6 || pos === 10 || pos === 14) TRIAD[root].forEach((n) => tone(bgmBus, { f: mtof(n), t, dur: s16 * 0.8, type: 'square', vol: 0.025 }));
    // ドラム
    if (pos % 4 === 0) tone(bgmBus, { f: 150, t, dur: 0.12, type: 'sine', vol: 0.35, slide: 45 });
    if (pos === 4 || pos === 12) noise(bgmBus, { t, dur: 0.1, vol: 0.18, hp: 1800 });
    if (pos % 2 === 1 || (mode === 'late' && pos % 1 === 0)) noise(bgmBus, { t, dur: 0.03, vol: mode === 'late' ? 0.05 : 0.06, hp: 7000 });
  }
  function tick() {
    if (!ctx || !mode) return;
    const s16 = 60 / MODES[mode].bpm / 4;
    while (nextAt < ctx.currentTime + 0.15) {
      scheduleStep(step, nextAt);
      step++; nextAt += s16;
    }
  }
  function bgm(name) {
    if (!ctx) return;
    if (name === 'win') { stopBgm(); se('win'); return; }
    if (name === mode) return;
    mode = name || null;
    if (!mode) { stopBgm(); return; }
    if (!timer) { step = 0; nextAt = ctx.currentTime + 0.05; timer = setInterval(tick, 25); }
  }
  function stopBgm() { mode = null; if (timer) { clearInterval(timer); timer = null; } }

  function toggle(kind) {
    prefs[kind] = !prefs[kind];
    save();
    if (ctx) {
      if (kind === 'bgm') bgmBus.gain.value = prefs.bgm ? 0.32 : 0;
      if (kind === 'se') seBus.gain.value = prefs.se ? 0.7 : 0;
    }
    return prefs[kind];
  }

  GR.audio = { start, bgm, se, toggle, prefs };
})(typeof globalThis !== 'undefined' ? globalThis : this);
