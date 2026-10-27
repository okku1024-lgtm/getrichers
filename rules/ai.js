// =====================================================================
// ゲットリッチ復活 v2 — CPUの思考
// 台帳を見て「行動」を1つ返すだけ。ルールの処理はしない。
// （乱数は Math.random。CPUの判断は行動として送られるので同期に影響しない）
// =====================================================================
(function (root) {
  const GR = (root.GR = root.GR || {});
  const R = () => GR.rules;
  const C = () => GR.CONFIG;
  const pickRandom = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

  // 攻撃する相手：リーチ中の人 → 1位 → ランダム
  function attackTarget(s, pi, candidates, rnd) {
    const reach = candidates.filter((i) => R().reaches(s, i).length > 0);
    if (reach.length) return reach[0];
    const top = R().ranks(s)[0];
    if (candidates.includes(top)) return top;
    return pickRandom(candidates, rnd);
  }
  // 地震で壊すマス：リーチを崩せるマス（1位優先）→ 1位の物件 → ランダム
  function quakeTarget(s, ids, rnd) {
    const top = R().ranks(s)[0];
    let breaker = null;
    for (const id of ids) {
      const c = s.cells[id], owner = c.owner;
      const before = R().reaches(s, owner).length;
      const saved = { owner: c.owner, level: c.level };
      c.owner = -1; c.level = 0;
      const after = R().reaches(s, owner).length;
      c.owner = saved.owner; c.level = saved.level;
      if (after < before) { if (owner === top) return id; if (breaker == null) breaker = id; }
    }
    if (breaker != null) return breaker;
    const topIds = ids.filter((id) => s.cells[id].owner === top);
    return pickRandom(topIds.length ? topIds : ids, rnd);
  }
  // ---------- 盤面の読み ----------
  const W = () => Object.assign({ colors: 3, lineMiss: 1, tourists: 3 }, C().BALANCE.win || {});
  const isBuyable = (id) => ['prop', 'tourist'].includes(R().def(id).type);
  // 序盤か：3周目までで、物件がまだ少ない
  function isEarly(s, pi) {
    const p = s.players[pi];
    return p.laps <= 2 && R().ownedIds(s, pi).length < 5;
  }
  // 相手の勝ちを止めるためのマス：
  //   リーチ（またはあと2つ）の辺・観光地で、相手が持っていないマス（先に買えば止まる）と、
  //   相手が持っているマス（止まって買収すれば崩れる。ランドマークは買収できないので除く）
  function blockTargets(s, pi) {
    const K = C(), w = W(), out = new Map();
    const add = (id, v) => { if (s.cells[id].owner !== pi) out.set(id, Math.max(out.get(id) || 0, v)); };
    s.players.forEach((o, oi) => {
      if (oi === pi || o.bankrupt) return;
      for (const ids of Object.values(K.LINES)) {
        const miss = ids.filter((id) => s.cells[id].owner !== oi);
        if (miss.length > w.lineMiss + 1) continue;
        const v = miss.length <= w.lineMiss ? 100 : 60; // 勝ち確定寸前ほど急ぐ
        miss.forEach((id) => add(id, v));
        ids.filter((id) => s.cells[id].owner === oi && s.cells[id].level < 3).forEach((id) => add(id, v - 10));
      }
      const tMiss = K.TOURIST_IDS.filter((id) => s.cells[id].owner !== oi);
      if (K.TOURIST_IDS.length - tMiss.length >= w.tourists - 1) {
        tMiss.forEach((id) => add(id, 60));
        K.TOURIST_IDS.filter((id) => s.cells[id].owner === oi).forEach((id) => add(id, 50));
      }
      const mono = R().monopolyColors(s, oi);
      if (mono.length >= w.colors - 1) K.BOARD.forEach((d) => { if (d.type === 'prop' && !mono.includes(d.color) && s.cells[d.id].owner !== oi) add(d.id, 40); });
    });
    return out;
  }
  // マスの「止まりたさ」：自分の勝ち筋 > 相手の勝ちを止める > 空き地・自分の物件 > 相手の高い物件はなるべく避ける
  function cellValue(s, pi, id, ctx) {
    const d = R().def(id), c = s.cells[id], p = s.players[pi];
    if (ctx.win.has(id) && (c.owner < 0 || c.level < 3)) return 120;
    if (ctx.block.has(id) && (c.owner < 0 || c.level < 3)) return ctx.block.get(id);
    switch (d.type) {
      case 'prop': case 'tourist':
        if (c.owner < 0) return ctx.early ? 30 : 18;
        if (c.owner === pi) { // 自分の物件：ランドマークが建てられるなら積極的に戻ってくる
          if (d.type !== 'prop' || c.level >= 3) return 2;
          return R().maxLv(p) >= 3 ? 26 : 12;
        }
        return -Math.min(40, R().rentFor(s, id, pi) / Math.max(50, p.money) * 40);
      case 'chance': return 8;
      case 'study': { // 科目マス：その科目が低いほど行きたい（最高なら用なし）
        const S = GR.CONFIG.BALANCE.stats, v = R().stat(p, d.stat);
        return v >= S.max ? 0 : 8 + (S.max - v) * 0.8;
      }
      case 'start': return 6 + 5 * Math.max(0, GR.CONFIG.BALANCE.gacha.handMax - p.hand.length); // ぴったり止まると手札補充
      case 'travel': return 9;
      case 'tax': return -6;
      case 'island': return -15;
      case 'quake': return 5;
      case 'lab': { // 研究棟：上がる余地のあるステータスが多いほど行きたい
        const S = GR.CONFIG.BALANCE.stats;
        return 4 + 6 * GR.CONFIG.STAT_DEFS.filter((sd) => R().stat(p, sd.key) < S.max).length;
      }
      default: return 0;
    }
  }
  function boardCtx(s, pi) {
    return { win: new Set(R().winTargets(s, pi)), block: blockTargets(s, pi), early: isEarly(s, pi) };
  }
  // サイコロのゲージ位置（0〜1。大きいほど大きい目が出やすい）
  //   序盤：できるだけ大きい目で盤面を回る ／ それ以降：2〜12マス先で一番止まりたいマスを狙う
  function gauge(s, pi, rnd) {
    const p = s.players[pi], ctx = boardCtx(s, pi);
    let bestD = null, bestV = -Infinity;
    for (let dd = 2; dd <= 12; dd++) {
      const id = (p.pos + dd) % C().BOARD.length;
      // 狙った目のまわりにもブレるので、前後のマスも少し加味する
      const v = cellValue(s, pi, id, ctx) + 0.3 * (cellValue(s, pi, (id + 1) % C().BOARD.length, ctx) + cellValue(s, pi, (id + C().BOARD.length - 1) % C().BOARD.length, ctx));
      if (v > bestV) { bestV = v; bestD = dd; }
    }
    const urgent = bestV >= 55; // 勝ち筋・ブロック対象が届く距離にある
    // 人間らしいブレ：止めるタイミングが少しずれる。たまに大きく外す
    const miss = (rnd() - 0.5) * 0.26 + (rnd() < 0.15 ? (rnd() - 0.5) * 0.5 : 0);
    // ゲージは輪（12の次は2）。ブレも輪のまま回り込む
    const wrap = (u) => ((u % 1) + 1) % 1;
    if (ctx.early && !urgent) return wrap(0.76 + miss); // 12ギリギリは2に化けるので、10あたりを狙う
    return wrap((bestD - 2 + 0.5) / 11 + miss);
  }

  // 購入：序盤は積極的に。その後は通行料用の手元資金を少し残す。勝ち筋・ブロックになるマスは無理してでも買う
  function decideBuy(s, pd, rnd) {
    const pi = pd.player, p = s.players[pi], c = s.cells[pd.cell];
    const ok = pd.options.filter((o) => o.ok);
    if (!ok.length) return 0;
    const ctx = boardCtx(s, pi);
    const key = ctx.win.has(pd.cell) || ctx.block.has(pd.cell);
    const reserve = key ? 0 : ctx.early ? 60 : 200;
    if (pd.mode === 'mega') return p.money - ok[0].cost >= reserve * 0.5 ? ok[0].value : 0;
    if (pd.mode === 'tourist') return p.money - ok[0].cost >= reserve ? ok[0].value : 0;
    if (pd.mode === 'acquire') {
      const o = ok.find((x) => x.value === Math.max(c.level, 1)) || ok[0];
      if (key) return p.money - o.cost >= 0 ? o.value : 0;
      return p.money - o.cost >= 400 && rnd() > 0.4 ? o.value : 0;
    }
    // 購入・増築：買える一番上まで（序盤・勝ち筋は特に）。ランドマークは資金があれば必ず
    // ランドマークは手元資金を残さなくても建てる（通行料が大きく、買収もされない）
    const lm = ok.find((o) => o.value === 3);
    if (lm && p.money - lm.cost >= 0) return 3;
    const afford = ok.filter((o) => p.money - o.cost >= reserve);
    if (!afford.length) return 0;
    const top = afford[afford.length - 1];
    if (ctx.early || key) return top.value;
    return afford[0].value;
  }

  function decideCell(s, pd, rnd) {
    const ids = pd.options;
    switch (pd.purpose) {
      case 'quake': return quakeTarget(s, ids, rnd);
      case 'travel': case 'warp': case 'shuuden': { // 世界旅行・おくだのワープ：一番止まりたいマスへ
        const ctx = boardCtx(s, pd.player);
        return ids.slice().sort((a, b) => cellValue(s, pd.player, b, ctx) - cellValue(s, pd.player, a, ctx) || rnd() - 0.5)[0];
      }
      case 'evTravel': {
        const free = ids.find((id) => s.cells[id].owner < 0);
        return free != null ? free : pickRandom(ids, rnd);
      }
      case 'chWorldcup': case 'chSand': // 通行料が一番高い物件
        return ids.slice().sort((a, b) => R().rent(s, b) - R().rent(s, a))[0];
      case 'chForceSell': case 'chSwapTheirs': { // 相手のリーチを崩せる物件 → 相手の一番価値の高い物件
        const bl = blockTargets(s, pd.player), wt = new Set(R().winTargets(s, pd.player));
        const sc = (id) => (wt.has(id) ? 2000 : 0) + (bl.get(id) || 0) * 10 + R().invested(s, id) / 10;
        return ids.slice().sort((a, b) => sc(b) - sc(a))[0];
      }
      case 'chBuyLand': { // 勝利に近づくマス → 相手のリーチを止めるマス → 観光地 → 高い物件
        const wt = R().winTargets(s, pd.player).filter((id) => ids.includes(id));
        if (wt.length) return wt[0];
        const bl = blockTargets(s, pd.player);
        const bIds = ids.filter((id) => bl.has(id)).sort((a, b) => bl.get(b) - bl.get(a));
        if (bIds.length) return bIds[0];
        const tour = ids.filter((id) => R().def(id).type === 'tourist');
        if (tour.length) return tour[0];
        return ids.slice().sort((a, b) => (R().def(b).prices || [0])[0] - (R().def(a).prices || [0])[0])[0];
      }
      case 'insure': // 一番高い自分の物件
        return ids.slice().sort((a, b) => R().invested(s, b) - R().invested(s, a))[0];
      case 'ransuu': { // 一番止まりたいマス
        const ctx = boardCtx(s, pd.player);
        return ids.slice().sort((a, b) => cellValue(s, pd.player, b, ctx) - cellValue(s, pd.player, a, ctx))[0];
      }
      case 'gekirin': // 相手のリーチを崩せる → 勝ち筋 → 高い物件（そのあと自分で買う）
      case 'burn': { // 相手のリーチを崩せる物件 → 相手の一番高い物件（自分のは燃やさない）
        const bl = blockTargets(s, pd.player), pi2 = pd.player, wt = pd.purpose === 'gekirin' ? new Set(R().winTargets(s, pi2)) : new Set();
        const sc = (id) => (s.cells[id].owner === pi2 ? -9999 : 0) + (wt.has(id) ? 2000 : 0) + (bl.get(id) || 0) * 10 + R().invested(s, id) / 10;
        return ids.slice().sort((a, b) => sc(b) - sc(a))[0];
      }
      case 'enjou': // 大炎上：通行料が一番高い自分のマスを2倍に
        return ids.slice().sort((x, y) => R().rent(s, y) - R().rent(s, x))[0];
      case 'chSwapMine': // 自分の一番安い物件
        return ids.slice().sort((a, b) => R().invested(s, a) - R().invested(s, b))[0];
      default: return pickRandom(ids, rnd);
    }
  }

  // スキルゲージが満タンの時、今使うか（貯めておくか）
  function wantSkill(s, pi) {
    const p = s.players[pi], left = GR.CONFIG.BALANCE.maxTurns - s.turn;
    if (left <= 2) return true;
    switch (GR.CONFIG.CHARACTERS[p.char].skill.id) {
      case 'genjitsuka': return !p.fx.genjitsuka && (p.money < 700 || left <= 6);
      case 'zettaireido': return s.players.some((o, i) => i !== pi && !o.bankrupt && o.money >= 800);
      default: return true;
    }
  }
  // 研究棟：好きなイベントカードを1枚選ぶ（自分が損をするカード・自分が払わされるカードは選ばない）
  function pickEvent(s, pi) {
    const p = s.players[pi], EV = GR.CONFIG.EVENTS;
    const order = ['fumine', 'gekirin', 'summer', 'uekarashitsurei', 'typhoon', 'ransuu', 'shuudendash', 'pandorobou', 'oosimaka', 'kasaihoken', 'glass', 'travel', 'tossatu', 'mousugutsuku'];
    const bad = (e) => e.victim === p.char || e.waiter === p.char || e.catcher === p.char || (e.id === 'fumine' && p.hand.some((c) => EV[c].id === 'fumine'));
    for (const id of order) { const i = EV.findIndex((e) => e.id === id); if (i >= 0 && !bad(EV[i])) return i; }
    return 0;
  }
  // ゲーマーの意地：4つの効果から選ぶ
  //   勝ち筋のマスが相手のランドマーク・観光地 → なんでも買収 ／ 届く距離に大事なマス → 狙い通りの目
  //   前方（12マス以内）にお金持ちの相手がいる → 追い越し略奪 ／ それ以外 → 3回連続移動
  function pickGamer(s, pi) {
    const p = s.players[pi], N = GR.CONFIG.BOARD.length, ctx = boardCtx(s, pi);
    const wt = R().winTargets(s, pi);
    if (wt.some((id) => { const c = s.cells[id]; return c.owner >= 0 && c.owner !== pi && (R().def(id).type === 'tourist' || c.level >= 3); })) return 'mega';
    let best = -99; for (let d = 2; d <= 12; d++) best = Math.max(best, cellValue(s, pi, (p.pos + d) % N, ctx));
    if (best >= 100) return 'steady'; // 自分の勝ちマスが届く距離にある時だけ
    const ahead = s.players.filter((o, i) => i !== pi && !o.bankrupt && ((o.pos - p.pos + N) % N) >= 1 && ((o.pos - p.pos + N) % N) <= 12);
    if (ahead.length >= 2 && ahead.reduce((a, o) => a + Math.max(0, o.money), 0) * 0.2 >= 600) return 'steal';
    return 'combo';
  }
  // 手札から使うカードを選ぶ（自分に得なものだけ。なければ -1）
  function pickCard(s, pi) {
    const p = s.players[pi], EV = GR.CONFIG.EVENTS, R2 = R();
    const others = s.players.filter((o, i) => i !== pi && !o.bankrupt);
    const myBld = R2.ownedIds(s, pi).filter((id) => s.cells[id].level > 0).length;
    const allBld = s.cells.filter((c) => c.owner >= 0 && c.level > 0).length;
    const score = (ev) => {
      if (ev.passive) return 0; // 持っているだけで効くカードは使えない
      switch (ev.id) {
        case 'typhoon': return p.fx.typhoon ? 0 : 3;
        case 'ransuu': return p.fx.steady ? 0 : 3;
        case 'shuudendash': { const ctx = boardCtx(s, pi); let best = -99; for (let d = 1; d <= ev.range; d++) best = Math.max(best, cellValue(s, pi, (p.pos + d) % GR.CONFIG.BOARD.length, ctx)); return best >= 55 ? 4 : best >= 30 ? 1.5 : 0; }
        case 'glass': return s.cells[GR.CONFIG.BOARD.find((d) => d.name === ev.cellName).id].owner === pi ? 0 : (p.char === ev.victim ? 1 : 3);
        case 'travel': return p.char === ev.victim ? 0 : 2;
        case 'tossatu': return p.char === ev.victim || !others.some((o) => o.char === ev.victim) ? 0 : 2;
        case 'gekirin': return s.cells.some((c) => c.owner >= 0 && c.owner !== pi && (R2.def(c.id).type === 'tourist' || c.level > 0)) ? 3 : 0;
        case 'mousugutsuku': return p.char === ev.waiter || p.char === ev.catcher ? 0 : (others.some((o) => o.char === ev.waiter) && others.some((o) => o.char === ev.catcher) ? 2 : 0);
        case 'pandorobou': return others.some((o) => o.hand.length) ? 3 : 0;
        case 'oosimaka': return others.some((o) => o.charge >= 100) ? 3.5 : 0;
        case 'uekarashitsurei': return s.cells.some((c) => c.owner >= 0 && c.owner !== pi) ? 3 : 0;
        case 'daienjou': return myBld >= 1 ? 3 : 0; // 自分のマスの通行料2倍
        default: return 0; // 屋根・スチノリハウスは自分が損するので使わない
      }
    };
    let best = -1, bs = 0;
    p.hand.forEach((c, i) => { const v = score(EV[c]); if (v > bs) { bs = v; best = i; } });
    return best;
  }
  // 台帳を見て、手番のCPUの行動を返す（人間の番なら null）
  function decide(s, rnd = Math.random) {
    const who = GR.engine.whoActs(s);
    if (!who) return null;
    const pi = who.player;
    if (s.players[pi].isHuman) return null;
    const pd = s.pending;
    if (!pd) {
      if (s.canCard) {
        if (s.players[pi].charge >= 100 && wantSkill(s, pi)) return { type: 'useSkill', player: pi };
        if (s.players[pi].hand.length) { const idx = pickCard(s, pi); if (idx >= 0) return { type: 'useCard', player: pi, idx }; }
      }
      return { type: 'roll', player: pi, gauge: gauge(s, pi, rnd) };
    }
    switch (pd.kind) {
      case 'buy': return { type: 'choose', player: pi, value: decideBuy(s, pd, rnd) };
      case 'sell': {
        const cheapest = pd.options.slice().sort((a, b) => a.cost - b.cost)[0];
        return { type: 'choose', player: pi, value: cheapest ? cheapest.value : 'bankrupt' };
      }
      case 'cell': return { type: 'choose', player: pi, value: decideCell(s, pd, rnd) };
      case 'player': {
        if (pd.purpose === 'zettaireido') {
          // 絶対零度：所持金を0にされた時・物件を強制売却された時の損が一番大きい相手（あの夏の人は無効なので除く）
          const o = GR.CONFIG.CHARACTERS[(pd.data && pd.data.skillOf) || s.players[pi].char].skill.outcomes;
          const loss = (i) => s.players[i].fx.noBankrupt ? -1 : (o.zero * Math.max(0, s.players[i].money) + o.sell * (1 - ((GR.CONFIG.CHARACTERS[(pd.data && pd.data.skillOf) || s.players[pi].char].skill.sellRate) || 0.5)) * R().ownedIds(s, i).reduce((a, id) => a + R().invested(s, id), 0)) * (R().reaches(s, i).length ? 3 : 1); // リーチ中の人を優先して止める
          return { type: 'choose', player: pi, value: pd.options.slice().sort((a, b) => loss(b) - loss(a))[0] };
        }
        return { type: 'choose', player: pi, value: attackTarget(s, pi, pd.options, rnd) };
      }
      case 'pickCard': return { type: 'choose', player: pi, value: pd.options[0] };
      case 'gamer': return { type: 'choose', player: pi, value: pickGamer(s, pi) };
      case 'pickEvent': return { type: 'choose', player: pi, value: pickEvent(s, pi) };
      case 'roof': {
        const bld = R().ownedIds(s, pi).reduce((a, id) => a + R().invested(s, id), 0);
        // 失うものが小さい方を選ぶ（旧版は逆になっていた）
        return { type: 'choose', player: pi, value: s.players[pi].money <= bld ? 'black' : 'gray' };
      }
    }
    return null;
  }

  GR.ai = { decide };
})(typeof globalThis !== 'undefined' ? globalThis : this);
