// =====================================================================
// ゲットリッチ復活 v2 — ルールエンジン
//
// ・画面（DOM）には一切触れない。Node.js でもブラウザでも同じように動く。
// ・ゲームの状態はすべて「台帳」 state に入っている（JSONにそのまま保存・送信できる）。
// ・dispatch(state, action) → { state: 新しい台帳, effects: 演出の指示リスト }
//   画面側は effects を順番に再生するだけ。
// ・乱数は台帳の中の種(rng)から作るので、同じ台帳＋同じ行動なら必ず同じ結果になる。
//   → スマホ同期では「行動」だけ送れば全端末が同じ盤面になる。
// =====================================================================
(function (root) {
  const GR = (root.GR = root.GR || {});
  const C = () => GR.CONFIG;

  // ---------- 乱数（mulberry32：台帳に種を持つ） ----------
  function rand(s) {
    let a = (s.rng = (s.rng + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const randInt = (s, lo, hi) => lo + Math.floor(rand(s) * (hi - lo + 1));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---------- 盤面の計算（台帳を読むだけ。書き換えない） ----------
  const def = (id) => C().BOARD[id];
  const charOf = (p) => C().CHARACTERS[p.char];
  // ステータス（計画・設備・構造・材料）：プレイヤーごとの今の値（1〜max）
  const stat = (p, key) => (p.stats && p.stats[key]) || 1;
  // ステータスの効果量：1の時 at1 → max の時 atMax を直線でつなぐ
  function statVal(p, key) {
    const S = C().BALANCE.stats, d = S[key], v = Math.min(S.max, stat(p, key));
    if (d.table && d.table.length) return d.table[Math.max(0, Math.min(d.table.length - 1, v - 1))]; // 段階ごとの表
    const t = (v - 1) / Math.max(1, S.max - 1);
    return d.at1 + (d.atMax - d.at1) * t;
  }
  const matMul = () => 1; // （旧）材料の購入割引：今は使わない（材料＝強いカードの出やすさ）
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  function invested(s, id) {
    const d = def(id), c = s.cells[id];
    if (d.type === 'tourist') return c.owner >= 0 ? d.price : 0;
    if (d.type !== 'prop') return 0;
    return sum(d.prices.slice(0, c.level));
  }
  function ownedIds(s, pi) {
    return s.cells.filter((c) => c.owner === pi).map((c) => c.id);
  }
  function totalAssets(s, pi) {
    return s.players[pi].money + sum(ownedIds(s, pi).map((id) => invested(s, id)));
  }
  // 割合の支払い：所持金×割合（10M単位で四捨五入。所持金がマイナスなら0）
  function pct(money, rate) { return Math.round(Math.max(0, money) * (rate || 0) / 10) * 10; }
  function propValue(s, pi) { return sum(ownedIds(s, pi).map((id) => invested(s, id))); }
  // 税金：base='money'＝所持金の割合 / base='prop'＝持っている不動産の価値の割合
  function taxOf(s, pi, d) { return pct(d.taxBase === 'prop' ? propValue(s, pi) : s.players[pi].money, d.taxRate); }
  function ranks(s) {
    return s.players.map((_, i) => i).filter((i) => !s.players[i].bankrupt)
      .sort((a, b) => totalAssets(s, b) - totalAssets(s, a));
  }
  function maxLv(p) {
    const t = C().BALANCE.lapForLevel;
    return p.laps >= 3 ? t[3] : p.laps >= 2 ? t[2] : t[1];
  }
  function buyCost(s, id, tLv, pi) {
    const d = def(id), c = s.cells[id];
    let cost = sum(d.prices.slice(c.level, tLv));
    return Math.floor(cost * matMul(s, pi));
  }
  function acquireCost(s, id, tLv, pi) {
    const d = def(id), c = s.cells[id];
    if (d.type === 'tourist') return Math.floor(invested(s, id) * C().BALANCE.acquireRate * matMul(s, pi));
    return Math.floor((invested(s, id) * C().BALANCE.acquireRate + sum(d.prices.slice(c.level, Math.max(tLv, c.level)))) * matMul(s, pi));
  }
  function touristCost(s, id, pi) { return Math.floor(def(id).price * matMul(s, pi)); }
  // 実際に払う通行料：構造が高いほど安くなる
  function rentFor(s, id, payer) { return rent(s, id); } // 払う通行料（構造の効果は rent() の中で持ち主側に掛かる）
  function sellPrice(s, id) {
    return Math.floor(invested(s, id) * C().BALANCE.sellRate);
  }
  function colorCells(color) {
    return C().BOARD.filter((d) => d.type === 'prop' && d.color === color).map((d) => d.id);
  }
  function isMonopoly(s, id) {
    const d = def(id), c = s.cells[id];
    if (d.type !== 'prop' || c.owner < 0) return false;
    return colorCells(d.color).every((x) => s.cells[x].owner === c.owner);
  }
  function rent(s, id) {
    const d = def(id), c = s.cells[id];
    if (c.owner < 0) return 0;
    if (d.type === 'tourist') return Math.floor(C().BALANCE.touristToll * (c.wc ? 2 : 1) * (c.mul > 1 ? c.mul : 1) / (c.sand ? 2 : 1) * (C().BALANCE.rentMul || 1) * (1 + statVal(s.players[c.owner], 'struct')));
    const base = c.level >= 3 ? d.rent[3] * 2 : d.rent[c.level];
    // 同じ色をすべて独占していれば、建物の有無にかかわらず通行料2倍
    let r = isMonopoly(s, id) ? base * 2 : base;
    if (c.wc) r *= 2;                 // チャンス「ワールドカップ開催」
    if (c.mul > 1) r *= c.mul;        // 大炎上・げきりん：壊して作り直したマスは通行料2倍（重ねがけで4倍・8倍…）
    if (c.sand) r = Math.floor(r / 2); // チャンス「黄砂」
    return Math.floor(r * (C().BALANCE.rentMul || 1) * (1 + statVal(s.players[c.owner], 'struct'))); // rentMul：通行料の基本倍率／構造：持ち主の構造が高いほど通行料が高い
  }
  function monopolyColors(s, pi) {
    return Object.keys(C().COLOR_HEX).filter((col) => {
      const ids = colorCells(col);
      return ids.length && ids.every((x) => s.cells[x].owner === pi);
    });
  }
  // 勝利条件（数は BALANCE.win で調整）
  //   colors：この色数を完全独占で勝利 / lineMiss：辺の物件・観光地のうち、この数まで欠けていても勝利 / tourists：観光地をこの数持てば勝利
  function winRule() { return Object.assign({ colors: 3, lineMiss: 0, tourists: 4 }, C().BALANCE.win || {}); }
  function checkVictory(s, pi) {
    const K = C(), W = winRule();
    const owned = monopolyColors(s, pi);
    const cnames = (n) => owned.slice(0, n).map((c) => K.COLOR_NAME[c]).join('・');
    if (owned.length >= W.colors) return { msg: W.colors === 2 ? '🏆 ダブル独占！' : '🏆 トリプル独占！', detail: `${cnames(W.colors)}の${W.colors}色を完全独占！` };
    for (const [side, ids] of Object.entries(K.LINES)) {
      if (ids.filter((id) => s.cells[id].owner !== pi).length <= W.lineMiss) return { msg: '🏆 ライン独占！', detail: `${K.LINE_NAMES[side]}の物件・観光地を${W.lineMiss ? `${ids.length - W.lineMiss}つ以上` : 'すべて'}独占！` };
    }
    const tours = K.TOURIST_IDS.filter((id) => s.cells[id].owner === pi);
    if (tours.length >= W.tourists) {
      return { msg: '🏆 観光地独占！', detail: `${tours.map((id) => def(id).name).join('・')}を制覇！` };
    }
    return null;
  }
  function reaches(s, pi) {
    const K = C(), out = [], W = winRule();
    const owned = monopolyColors(s, pi);
    if (owned.length === W.colors - 1) out.push(`リーチ🔥 ${W.colors === 2 ? 'ダブル' : 'トリプル'}独占(${owned.map((c) => K.COLOR_NAME[c]).join('・')})`);
    for (const [side, ids] of Object.entries(K.LINES)) {
      if (ids.filter((id) => s.cells[id].owner !== pi).length === W.lineMiss + 1) out.push(`リーチ🔥 ライン独占(${K.LINE_NAMES[side]})`);
    }
    if (K.TOURIST_IDS.filter((id) => s.cells[id].owner === pi).length === W.tourists - 1) out.push('リーチ🔥 観光地独占');
    return out;
  }
  // pi が手に入れると勝利条件に近づくマス
  function winTargets(s, pi) {
    const K = C(), t = new Set(), W = winRule();
    for (const ids of Object.values(K.LINES)) {
      const miss = ids.filter((id) => s.cells[id].owner !== pi);
      if (miss.length === W.lineMiss + 1) miss.forEach((id) => t.add(id));
    }
    const missT = K.TOURIST_IDS.filter((id) => s.cells[id].owner !== pi);
    if (K.TOURIST_IDS.length - missT.length === W.tourists - 1) missT.forEach((id) => t.add(id));
    const owned = monopolyColors(s, pi);
    if (owned.length === W.colors - 1) {
      K.BOARD.forEach((d) => { if (d.type === 'prop' && !owned.includes(d.color) && s.cells[d.id].owner !== pi) t.add(d.id); });
    }
    return [...t];
  }

  // リーチマス：そのマス1つを手に入れれば勝ちになるマス（相手のランドマークは買収できないので除く）
  function reachCells(s, pi) {
    const K = C(), t = new Set(), W = winRule();
    const ok = (id) => { const c = s.cells[id]; return !(c.owner >= 0 && c.owner !== pi && c.level >= 3); };
    for (const ids of Object.values(K.LINES)) {
      const miss = ids.filter((id) => s.cells[id].owner !== pi);
      if (miss.length === W.lineMiss + 1 && W.lineMiss === 0 && ok(miss[0])) t.add(miss[0]);
    }
    const missT = K.TOURIST_IDS.filter((id) => s.cells[id].owner !== pi);
    if (K.TOURIST_IDS.length - missT.length === W.tourists - 1 && missT.length === 1) t.add(missT[0]);
    const owned = monopolyColors(s, pi);
    if (owned.length === W.colors - 1) {
      const cols = [...new Set(K.BOARD.filter((d) => d.type === 'prop').map((d) => d.color))].filter((c) => !owned.includes(c));
      cols.forEach((col) => {
        const miss = K.BOARD.filter((d) => d.type === 'prop' && d.color === col && s.cells[d.id].owner !== pi);
        if (miss.length === 1 && ok(miss[0].id)) t.add(miss[0].id);
      });
    }
    return [...t];
  }

  // ---------- 台帳の作成 ----------
  // opts: { chars:[4人のキャラ名], humans:[true,false,...], names?:[], seed?:number }
  function newGame(opts) {
    const K = C(), B = K.BALANCE;
    const chars = opts.chars || K.CHAR_ORDER;
    const st = {
      v: 2,
      rng: (opts.seed != null ? opts.seed : Math.floor(Math.random() * 2 ** 31)) | 0,
      turn: 1,
      current: 0,
      phase: 'roll',      // roll=サイコロ待ち / busy=処理中 / over=終了
      reroll: false,      // ゾロ目でもう一度
      canCard: true,      // このターンの最初（サイコロ前）ならイベントカードを1枚使える
      debug: false,
      debugEvent: null,
      players: chars.map((ch, i) => ({
        id: i,
        name: (opts.names && opts.names[i]) || ch,
        char: ch,
        color: K.CHARACTERS[ch].color,
        isHuman: !!(opts.humans && opts.humans[i]),
        pos: 0, money: B.startMoney, laps: 1, charge: 0, hand: [], autoCards: [], stats: Object.assign({}, K.CHARACTERS[ch].stats),
        bankrupt: false, skip: 0, doubleStreak: 0, oddEvenUsed: false, guess: null, skillTurn: 0,
        fx: { gamerNext: false, gamerLeft: 0, gamerOn: false, genjitsuka: false, typhoon: false, steady: false, insured: false, overtake: false, megaBuy: false, noBankrupt: false },
      })),
      cells: K.BOARD.map((d) => ({ id: d.id, owner: -1, level: 0 })),
      queue: [],
      pending: null,
      winner: null,
    };
    // ターン順：opts.shuffleOrder ならランダム（パネルの位置は変えず、回る順番だけ変える）
    st.order = opts.order ? opts.order.slice() : st.players.map((_, i) => i);
    if (opts.shuffleOrder) for (let i = st.order.length - 1; i > 0; i--) { const j = Math.floor(rand(st) * (i + 1)); [st.order[i], st.order[j]] = [st.order[j], st.order[i]]; }
    st.current = st.order[0];
    return st;
  }

  // ---------- 演出の記録 ----------
  function snap(s) {
    return { players: clone(s.players), cells: clone(s.cells), current: s.current, turn: s.turn };
  }
  function fx(ctx, e, withSnap) {
    if (withSnap) e.s = snap(ctx.s);
    ctx.fx.push(e);
  }
  const log = (ctx, msg) => fx(ctx, { t: 'log', msg });
  // 画面中央に出す大きな文字（tone: good / bad / gold / skill / info）
  const banner = (ctx, text, sub, tone, p) => fx(ctx, { t: 'banner', text, sub: sub || '', tone: tone || 'info', p });

  // タスクを積む。先に書いたものが先に実行される
  function push(s, ...tasks) {
    for (let i = tasks.length - 1; i >= 0; i--) s.queue.push(tasks[i]);
  }
  // opts.buy: 不動産の購入（スキル判定しない・あの夏でも払える） / opts.noSkill: スキル判定しない
  // ふみねの加護（手札にあれば自動）：総資産の半分を超えるお金を一度に失いそうな時、その損をなしにして+1000M。カードは消える
  function fumineGuard(ctx, pi, loss) {
    const s = ctx.s, p = s.players[pi], EV = C().EVENTS;
    const k = p.hand.findIndex((c) => EV[c] && EV[c].id === 'fumine');
    if (k < 0 || loss <= 0) return false;
    const ev = EV[p.hand[k]], ta = totalAssets(s, pi);
    if (ta <= 0 || loss <= ta * ev.lossFrac) return false;
    p.hand.splice(k, 1);
    log(ctx, `😇 ${p.name}: ふみねの加護！${loss.toLocaleString()}Mの損がなかったことに＋${ev.bonus}M`);
    banner(ctx, 'ふみねの加護！', `${loss.toLocaleString()}Mの損がなかったことに ＋${ev.bonus}M`, 'good', pi);
    fx(ctx, { t: 'splash', kind: 'event', img: ev.img, title: ev.name, card: true });
    p.money += ev.bonus;
    fx(ctx, { t: 'money', p: pi, delta: ev.bonus }, true);
    return true;
  }
  // あの夏は終わらない：持っていれば、1回休みを1度だけなかったことにする。守ったら true（カードは消える）
  function summerGuard(ctx, pi) {
    const s = ctx.s, p = s.players[pi], EV = C().EVENTS;
    const k = p.hand.findIndex((c) => EV[c] && EV[c].id === 'summer');
    if (k < 0) return false;
    const ev = EV[p.hand[k]];
    p.hand.splice(k, 1);
    log(ctx, `☀️ ${p.name}: あの夏は終わらない！1回休みがなかったことに`);
    fx(ctx, { t: 'splash', kind: 'event', img: ev.img, title: ev.name, card: true });
    banner(ctx, 'あの夏は終わらない！', `${p.name}の1回休みは無効`, 'good', pi);
    fx(ctx, { t: 'sync' }, true);
    return true;
  }
  // プルタ参戦：ゾロ目で動いている人が、カードを持つ人のいるマスを通ろうとしたら、そこで止める
  function purutaBlock(ctx, mover, pos) {
    const s = ctx.s, EV = C().EVENTS;
    const hi = s.players.findIndex((q, i) => i !== mover && !q.bankrupt && q.pos === pos && q.hand.some((c) => EV[c] && EV[c].id === 'puruta'));
    if (hi < 0) return false;
    const h = s.players[hi], k = h.hand.findIndex((c) => EV[c].id === 'puruta'), ev = EV[h.hand[k]];
    h.hand.splice(k, 1);
    log(ctx, `🧍 ${h.name}: プルタ参戦！巨体で通せんぼ → ${s.players[mover].name}は「${def(pos).name}」で止まる`);
    fx(ctx, { t: 'splash', kind: 'event', img: ev.img, title: ev.name, card: true });
    banner(ctx, 'プルタ参戦！', `巨体で通せんぼ！${s.players[mover].name}はここで止まる`, 'bad', mover);
    fx(ctx, { t: 'sync' }, true);
    return true;
  }
  function addMoney(ctx, pi, delta, opts = {}) {
    if (!delta) return 0;
    const p = ctx.s.players[pi];
    if (delta < 0 && !opts.buy && !opts.guarded && !p.fx.noBankrupt && fumineGuard(ctx, pi, -delta)) return 0;
    if (delta < 0 && !opts.buy && p.fx.noBankrupt) {
      log(ctx, `☀️ ${p.name}: あの夏は終わらない！支払い ${(-delta).toLocaleString()}M は免除`);
      return 0;
    }
    if (delta < 0 && !opts.buy && !opts.guarded) { ctx.lastLoss = { pi, to: -1, amount: -delta }; p.lastPay = null; }
    p.money += delta;
    fx(ctx, { t: 'money', p: pi, delta }, true);
    if (delta < 0 && !opts.buy && !opts.noSkill) lossCheck(ctx, pi);
    return delta;
  }
  // 支払い・略奪：払う側が「あの夏」なら何も動かない。実際に動いた額を返す
  function takeMoney(ctx, from, to, amount, why) {
    const s = ctx.s, fp = s.players[from];
    if (amount <= 0 || fp.bankrupt) return 0;
    if (fp.fx.noBankrupt) { log(ctx, `☀️ ${fp.name}: あの夏は終わらない！「${why}」${amount.toLocaleString()}M は免除`); return 0; }
    if (fumineGuard(ctx, from, amount)) return 0;
    const toOk = to >= 0 && !s.players[to].bankrupt;
    ctx.lastLoss = { pi: from, to: toOk ? to : -1, amount }; // 具現化の「支払いキャンセル」用
    fp.lastPay = { to: toOk ? to : -1, amount }; // 破産した時に「払いすぎ」を戻す用
    fx(ctx, { t: 'transfer', from, to: toOk ? to : -1, amount, why });
    addMoney(ctx, from, -amount, { guarded: true });
    if (toOk) addMoney(ctx, to, amount, { noSkill: true });
    return amount;
  }
  // 所持金・総資産が減った人のスキル判定を予約する
  function lossCheck(ctx, pi) {
    const s = ctx.s;
    if (s.winner || s.players[pi].bankrupt) return;
    if (s.players[pi].fx.genjitsuka) push(s, { k: 'genCheck', p: pi });
  }
  function setCell(ctx, id, owner, level, opts = {}) {
    const c = ctx.s.cells[id], prev = c.owner;
    if (prev !== owner) { delete c.wc; delete c.sand; delete c.insured; delete c.mul; } // 持ち主が変わる・壊されると倍率は消える
    c.owner = owner;
    c.level = owner < 0 ? 0 : level;
    fx(ctx, { t: 'cell', id }, true);
    if (prev >= 0 && prev !== owner && !opts.noSkill) lossCheck(ctx, prev);
  }
  function aliveOthers(s, pi) {
    return s.players.map((_, i) => i).filter((i) => i !== pi && !s.players[i].bankrupt);
  }
  function findChar(s, name) {
    return s.players.findIndex((p) => p.char === name && !p.bankrupt);
  }
  function setPending(s, pending) {
    s.pending = pending;
  }

  // ---------- タスク処理 ----------
  const H = {};

  // サイコロ移動の1マス
  // 移動中に破産した時：残りの移動は取りやめて手番を終える
  function endIfBankruptMover(s, pi) {
    if (pi === s.current && !s.queue.some((q) => q.k === 'endTurn')) push(s, { k: 'endTurn' });
  }
  H.step = (ctx, t) => {
    const s = ctx.s, p = s.players[t.p];
    if (p.bankrupt) { endIfBankruptMover(s, t.p); return; }
    p.pos = (p.pos + 1) % C().BOARD.length;
    tickLap(ctx, t.p);
    if (p.fx.overtake) gamerSteal(ctx, t.p); // ゲーマーの意地（追い越し略奪）：1周の間
    if (p.fx.typhoon) typhoonSteal(ctx, t.p);
    fx(ctx, { t: 'pos', p: t.p }, true);
    const paidWait = waiterCheck(ctx, t.p);
    const passedStart = p.pos === 0;
    if (passedStart) passStart(ctx, t.p);
    // プルタ参戦：ゾロ目で動いていて、まだ通り過ぎる途中なら、カードを持つ人のいるマスで止められる（振り直しもなし）
    const blocked = t.dbl && t.n > 1 && purutaBlock(ctx, t.p, p.pos);
    if (blocked && t.p === s.current) s.reroll = false;
    const cont = t.n > 1 && !blocked ? { k: 'step', p: t.p, n: t.n - 1, dbl: t.dbl } : { k: 'land', p: t.p };
    push(s, cont);
    if (paidWait) push(s, { k: 'solvency', p: t.p }); // 払えなければ、その場で売却・破産の処理
  };
  // ワープ移動（旅行など）。スキル判定はしない＝スキルの連鎖ループを構造的に防ぐ
  H.walk = (ctx, t) => {
    const s = ctx.s, p = s.players[t.p];
    if (p.bankrupt) { if (t.land && !t.visit) endIfBankruptMover(s, t.p); return; }
    if (p.pos === t.to) { if (t.land) push(s, { k: 'land', p: t.p, visit: t.visit }); return; }
    p.pos = (p.pos + 1) % C().BOARD.length;
    tickLap(ctx, t.p);
    fx(ctx, { t: 'pos', p: t.p }, true);
    const paidWait = waiterCheck(ctx, t.p);
    if (p.pos === 0) passStart(ctx, t.p);
    push(s, t);
    if (paidWait) push(s, { k: 'solvency', p: t.p });
  };
  // もうすぐ着く：待機中の人のマスを、待っている相手が通ったら合流（相手が待機料を払う）
  function waiterCheck(ctx, pi) {
    const s = ctx.s, p = s.players[pi];
    let hit = false;
    s.players.forEach((w, wi) => {
      if (wi === pi || w.bankrupt || w.fx.waitFor !== pi || w.pos !== p.pos) return;
      const r = w.fx.waitPayRate || 0, amt = pct(p.money, r);
      w.fx.waitFor = null; w.fx.waitPayRate = 0;
      log(ctx, `🛏 ${p.name}がやっと${w.name}に追いついた！待たせた分（所持金の${Math.round(r * 100)}%）${amt}M を払う`);
      banner(ctx, 'やっと着いた！', `${p.name} → ${w.name} ${amt}M`, 'rent', pi);
      takeMoney(ctx, pi, wi, amt, 'もうすぐ着く');
      hit = true;
    });
    return hit;
  }
  function gamerSteal(ctx, pi) {
    const s = ctx.s, p = s.players[pi], rate = p.fx.gamerRate != null ? p.fx.gamerRate : charOf(p).skill.stealRate;
    s.players.forEach((op, oi) => {
      if (oi === pi || op.bankrupt || op.pos !== p.pos) return;
      const take = takeMoney(ctx, oi, pi, Math.floor(Math.max(0, op.money) * rate), '追い越し略奪');
      if (take <= 0) return;
      log(ctx, `🎮 ${p.name}: ${op.name}を追い越して${take}M略奪！`);
      banner(ctx, '追い越し略奪！', `${op.name}から ${take}M`, 'skill', pi);
    });
  }
  // 富の台風18号：1周の間、通り越した（同じマスに来た）相手の所持金とスキルゲージの1/4を奪う
  function typhoonSteal(ctx, pi) {
    const s = ctx.s, p = s.players[pi], ev = C().EVENTS.find((e) => e.id === 'typhoon');
    s.players.forEach((op, oi) => {
      if (oi === pi || op.bankrupt || op.pos !== p.pos) return;
      const money = takeMoney(ctx, oi, pi, Math.floor(Math.max(0, op.money) * ev.stealRate), '富の台風18号');
      if (ctx.base) ctx.base[oi] = totalAssets(s, oi); // 奪われた分では相手のゲージは溜まらない
      const g = Math.floor(op.charge * ev.gaugeRate);
      if (g > 0) {
        const ob = op.charge, pb = p.charge;
        op.charge -= g; p.charge = Math.min(100, p.charge + g);
        fx(ctx, { t: 'charge', p: oi, from: ob, to: op.charge }, true);
        fx(ctx, { t: 'charge', p: pi, from: pb, to: p.charge }, true);
      }
      if (money <= 0 && g <= 0) return;
      log(ctx, `🌀 ${p.name}: ${op.name}を巻き込んだ！${money}Mとゲージ${g}%を奪った`);
      banner(ctx, '富の台風18号！', `${op.name}から ${money}M＋ゲージ${g}%`, 'skill', pi);
    });
  }
  // 「1周する間」続く効果：発動した時に盤面1周分（マス数）の歩数をセットし、1マス進むごとに1減らす。0になったら終わり
  const LAP_LABEL = { genjitsuka: '具現化', typhoon: '富の台風18号', steady: '狙い通りの目', overtake: '追い越し略奪', megaBuy: 'なんでも買収', noBankrupt: 'あの夏は終わらない' };
  function startLap(p, key) { p.fx[key] = true; p.fx.lapLeft = Object.assign({}, p.fx.lapLeft || {}, { [key]: C().BOARD.length }); }
  function tickLap(ctx, pi) {
    const p = ctx.s.players[pi], L = p.fx.lapLeft;
    if (!L) return;
    Object.keys(L).forEach((k) => {
      if (!p.fx[k]) { delete L[k]; return; }
      if (--L[k] <= 0) { delete L[k]; p.fx[k] = false; log(ctx, `${p.name}: ${LAP_LABEL[k] || k} 効果終了（1周した）`); }
    });
  }
  function passStart(ctx, pi) {
    const s = ctx.s, p = s.players[pi], B = C().BALANCE;
    p.laps++;
    fx(ctx, { t: 'lap', p: pi, amount: B.salary, laps: p.laps });
    addMoney(ctx, pi, B.salary);
    log(ctx, `${p.name}: スタート通過 +${B.salary}M（${p.laps}周目）`);
    drawCard(ctx, pi);
  }

  // visit=true：他人の手番中にワープしてきた時の着地（購入・通行料・税金だけ処理し、手番は終わらせない）
  H.land = (ctx, t) => {
    const s = ctx.s, pi = t.p, p = s.players[pi];
    const visit = !!t.visit;
    const END = visit ? [] : [{ k: 'endTurn' }];
    if (p.bankrupt) { push(s, ...END); return; }
    const d = def(p.pos), c = s.cells[p.pos];
    fx(ctx, { t: 'land', p: pi });
    log(ctx, `${p.name}: 📍 ${d.name}`);
    if (visit && !['tax', 'tourist', 'prop'].includes(d.type)) return;
    switch (d.type) {
      case 'start': {
        // スタートにぴったり止まったら：手札の上限までカードを補充（通過の1枚は step で配り済み）
        const G = C().BALANCE.gacha, n = G.fillOnStart ? Math.max(0, G.handMax - p.hand.length) : 0;
        if (n) {
          for (let k = 0; k < n; k++) addCard(ctx, pi, randomCard(s, pi));
          log(ctx, `🏁 ${p.name}: スタートにぴったり！手札を${n}枚補充`);
          banner(ctx, 'スタートにぴったり！', `カードを${n}枚補充`, 'good', pi);
        }
        push(s, ...END); return;
      }
      case 'study': {
        // 科目マス：studyOdds の確率で 落単（上がらない）／+1／+2（優）。上限あり
        const key = d.stat, nm = statName(key), S = C().BALANCE.stats, before = stat(p, key);
        const O = S.studyOdds || { fail: 0.25, plus1: 0.5, plus2: 0.25 }, r = rand(s);
        const gain = r < O.fail ? 0 : r < O.fail + O.plus1 ? 1 : 2;
        if (before >= S.max) {
          log(ctx, `📚 ${p.name}: ${nm}はもう最高（${S.max}）`);
          banner(ctx, `${nm}はもう満点！`, `${nm} ${before}（最高）`, 'info', pi);
        } else if (gain > 0) {
          for (let k = 0; k < gain; k++) statUp(ctx, pi, key);
          const after = stat(p, key);
          log(ctx, `📚 ${p.name}: ${nm}の単位取得${gain >= 2 ? '（優）' : ''}！ ${nm} ${before}→${after}`);
          banner(ctx, gain >= 2 ? '優で単位取得！！' : '単位取得！', `${nm} ${before} → ${after}`, gain >= 2 ? 'gold' : 'good', pi);
          fx(ctx, { t: 'stat', p: pi, key, from: before, to: after }, true);
        } else {
          log(ctx, `📚 ${p.name}: ${nm}を落単…（${nm} ${before}のまま）`);
          banner(ctx, '落単…', `${nm}は上がらなかった`, 'bad', pi);
          fx(ctx, { t: 'stat', p: pi, key, from: before, to: before, fail: true }, true);
        }
        push(s, ...END); return;
      }
      case 'tax': push(s, { k: 'pay', from: pi, to: -1, amount: taxOf(s, pi, d), why: d.name }, ...END); return;
      case 'chance': push(s, { k: 'chance', p: pi }); return;
      case 'island':
        if (summerGuard(ctx, pi)) { push(s, ...END); return; }
        p.skip = 1; s.reroll = false;
        log(ctx, `${p.name}: ${d.name}で1回休み🏝`);
        fx(ctx, { t: 'rest', p: pi, why: d.name });
        push(s, { k: 'endTurn' }); return;
      case 'quake': push(s, { k: 'quake', p: pi }); return;
      case 'lab': {
        // 研究棟（四隅の特別なマス）：全ステータス+1（確実。上限あり）
        const ups = C().STAT_DEFS.filter((sd) => statUp(ctx, pi, sd.key)).map((sd) => sd.name);
        if (ups.length) {
          log(ctx, `🏛 ${p.name}: 研究棟で猛勉強！ ${ups.join('・')} +1`);
          banner(ctx, '研究棟で猛勉強！', `${ups.length === 4 ? '全ステータス' : ups.join('・')} +1`, 'good', pi);
          fx(ctx, { t: 'stat', p: pi, all: true }, true);
        } else {
          log(ctx, `🏛 ${p.name}: 研究棟…ステータスはすべて最高`);
          banner(ctx, '研究棟', 'ステータスはすべて最高', 'info', pi);
        }
        push(s, ...END); return;
      }
      case 'travel': {
        const opts = travelOpts(s, pi);
        setPending(s, { kind: 'cell', purpose: 'travel', player: pi, options: opts, title: '🗺 移動先のマスを選択してください' });
        return;
      }
      case 'tourist':
        if (c.owner >= 0 && c.owner !== pi && p.fx.gamerOn && !visit) { gamerNoToll(ctx, pi, c.owner); push(s, ...END); }
        else if (c.owner < 0) push(s, { k: 'offer', p: pi, id: p.pos }, ...END);
        else if (c.owner === pi) push(s, ...END);
        else if (p.fx.megaBuy && !visit) { megaUse(ctx, pi, p.pos); push(s, { k: 'offer', p: pi, id: p.pos }, ...END); } // なんでも買収：通行料なし・購入金額のみで買える（1周に1回）
        else push(s, { k: 'pay', from: pi, to: c.owner, amount: rentFor(s, p.pos, pi), why: '観光地通行料', rentCell: p.pos }, ...END);
        return;
      case 'prop':
        // ゲーマーの意地（3回連続移動）中は、他人のマスでも通行料なし（買収は通常の価格で）
        if (c.owner >= 0 && c.owner !== pi && p.fx.gamerOn && !visit) { gamerNoToll(ctx, pi, c.owner); push(s, { k: 'offer', p: pi, id: p.pos }, ...END); }
        else if (c.owner === pi || c.owner < 0) push(s, { k: 'offer', p: pi, id: p.pos }, ...END);
        else if (p.fx.megaBuy && !visit) { megaUse(ctx, pi, p.pos); push(s, { k: 'offer', p: pi, id: p.pos }, ...END); }
        else push(s, { k: 'pay', from: pi, to: c.owner, amount: rentFor(s, p.pos, pi), why: isMonopoly(s, p.pos) ? '通行料（独占×2）' : '通行料', rentCell: p.pos }, { k: 'offer', p: pi, id: p.pos }, ...END);
        return;
      default: push(s, { k: 'endTurn' });
    }
  };

  // なんでも買収（すぎうら）：1周する間に1回だけ。他人のマス（ランドマーク・観光地も）に止まると通行料なし、購入金額のみで買える
  function megaUse(ctx, pi, id) {
    const p = ctx.s.players[pi], c = ctx.s.cells[id];
    p.fx.megaBuy = false; if (p.fx.lapLeft) delete p.fx.lapLeft.megaBuy;
    p.fx.megaCell = id;
    log(ctx, `🏰 ${p.name}: なんでも買収！${ctx.s.players[c.owner].name}の「${def(id).name}」は通行料なし・購入金額のみで買える`);
    banner(ctx, 'なんでも買収！', '通行料なし・購入金額のみで買える', 'skill', pi);
  }
  function gamerNoToll(ctx, pi, owner) {
    const p = ctx.s.players[pi];
    log(ctx, `🎮 ${p.name}: ゲーマーの意地！${ctx.s.players[owner].name}のマスでも通行料なし`);
    banner(ctx, '通行料なし！', 'ゲーマーの意地（3回連続移動）中', 'skill', pi);
  }
  // 敷地調査・世界旅行の行き先：買える（購入・建て増し・買収できる）マスだけ。1つもなければ従来どおり全マス
  function travelOpts(s, pi) {
    const p = s.players[pi];
    const all = C().BOARD.filter((x) => !C().CORNERS.includes(x.id) && x.id !== p.pos).map((x) => x.id);
    const ok = all.filter((id) => buyOptions(s, pi, id));
    return ok.length ? ok : all;
  }
  // 購入・アップグレード・買収の選択肢を作る（買えるものがなければ何もしない）
  function buyOptions(s, pi, id) {
    const d = def(id), c = s.cells[id], p = s.players[pi], names = C().LEVEL_NAMES;
    // なんでも買収：他人のマス（ランドマーク・観光地も）を購入金額（土地・建物にかかった額）だけで建物ごと買える
    if ((d.type === 'tourist' || d.type === 'prop') && c.owner >= 0 && c.owner !== pi && (p.fx.megaCell === id || p.fx.megaBuy)) {
      const cost = invested(s, id), lv = d.type === 'tourist' ? 1 : Math.max(c.level, 1);
      return { mode: 'mega', options: [{ value: lv, label: d.type === 'tourist' ? '観光地' : names[lv], cost, ok: p.money >= cost }] };
    }
    if (d.type === 'tourist') {
      if (c.owner >= 0) return null;
      const tc = touristCost(s, id, pi);
      return { mode: 'tourist', options: [{ value: 1, label: '観光地', cost: tc, ok: p.money >= tc }] };
    }
    if (d.type !== 'prop') return null;
    if (c.owner === pi || c.owner < 0) {
      const top = Math.min(maxLv(p), 3);
      if (c.level >= top) return null;
      const options = [];
      for (let lv = c.level + 1; lv <= top; lv++) {
        const cost = buyCost(s, id, lv, pi);
        options.push({ value: lv, label: names[lv], cost, ok: p.money >= cost });
      }
      return { mode: c.owner === pi ? 'upgrade' : 'buy', options };
    }
    // 他人の物件：買収（ランドマークは不可。建物レベルは下げない）
    if (c.level >= 3) return null;
    const from = Math.max(c.level, 1), to = Math.max(from, c.level >= 3 ? 3 : Math.min(maxLv(p), 2));
    const options = [];
    for (let lv = from; lv <= to; lv++) {
      const cost = acquireCost(s, id, lv, pi);
      options.push({ value: lv, label: names[lv], cost, ok: p.money >= cost });
    }
    return { mode: 'acquire', options };
  }
  H.offer = (ctx, t) => {
    const s = ctx.s, p = s.players[t.p];
    if (p.bankrupt) return;
    const o = buyOptions(s, t.p, t.id);
    if (!o || !o.options.some((x) => x.ok)) return;
    setPending(s, { kind: 'buy', player: t.p, cell: t.id, mode: o.mode, options: o.options });
  };
  // スキルゲージ：「総資産（所持金＋不動産の価値）の何割を失ったか」だけ溜まる（不動産の購入は除く）
  //   例：総資産2000Mで200M払う → 1割 → ゲージ+10%（×rate）。お金持ちほど溜まりにくく、ピンチほど溜まる
  //   処理の1ステップごとに比べる（購入はその直後に基準を取り直して除外）
  function assetSnap(s) { return s.players.map((_, i) => totalAssets(s, i)); }
  function chargeByAssets(ctx) {
    const now = assetSnap(ctx.s);
    if (ctx.base) ctx.base.forEach((b, i) => {
      const loss = b - now[i];
      if (loss > 0) addSkillCharge(ctx, i, b > 0 ? Math.min(1, loss / b) : 1);
    });
    ctx.base = assetSnap(ctx.s);
  }
  function addSkillCharge(ctx, pi, frac) {
    const s = ctx.s, p = s.players[pi], G = C().BALANCE.skillGauge;
    if (p.bankrupt || p.charge >= 100 || frac <= 0) return;
    const before = p.charge;
    const cr = charOf(p).skill.gaugeRate != null ? charOf(p).skill.gaugeRate : 1; // キャラごとの溜まりやすさ（勝率の調整用）
    // 終盤ほど溜まりやすい：1ターン目＝early倍 → 最終ターン＝late倍（直線的に上がる）
    const tp = Math.min(1, Math.max(0, (s.turn - 1) / Math.max(1, C().BALANCE.maxTurns - 1)));
    const tm = (G.early != null ? G.early : 1) + ((G.late != null ? G.late : 1) - (G.early != null ? G.early : 1)) * tp;
    p.charge = frac >= 1 ? 100 : Math.min(100, p.charge + frac * 100 * G.rate * cr * tm * statVal(p, 'equip')); // 総資産を全部失ったら必ず満タン
    fx(ctx, { t: 'charge', p: pi, from: before, to: p.charge }, true);
    if (p.charge >= 100) {
      log(ctx, `✨ ${p.name}: スキルゲージ満タン！自分のターンの最初に使える`);
      banner(ctx, 'スキルゲージ満タン！', `${p.name}：ターンの最初に「${charOf(p).skill.title}」が使える`, 'skill', pi);
    }
  }
  // カードを1枚手札に加える。手札がいっぱいの時は BALANCE.gacha.overflow で動きが変わる
  //   自動で発動するカードは autoCards に積んでおき、手番の終わり（endTurn）で順に発動する
  function addCard(ctx, pi, card, why) {
    const s = ctx.s, p = s.players[pi], G = C().BALANCE.gacha, mode = G.overflow || 'fireOldest';
    if (p.bankrupt) return false;
    if (p.hand.length >= G.handMax) {
      if (mode === 'block') { log(ctx, `🎴 ${p.name}: 手札がいっぱいなのでカードはもらえなかった`); return false; }
      if (mode === 'fireNew') {
        p.autoCards.push(card);
        log(ctx, `🎴 ${p.name}: 手札がいっぱい！新しいカード「${C().EVENTS[card].name}」が自動で発動する`);
        fx(ctx, { t: 'gacha', p: pi, card }, true);
        return true;
      }
      const old = p.hand.shift();
      if (mode === 'fireOldest') { p.autoCards.push(old); log(ctx, `🎴 ${p.name}: 手札がいっぱい！一番古いカード「${C().EVENTS[old].name}」が自動で発動する`); }
      else log(ctx, `🎴 ${p.name}: 手札がいっぱいなので、一番古いカードが抜けた`);
    }
    p.hand.push(card);
    if (why) log(ctx, `🎴 ${p.name}: ${why}（手札${p.hand.length}枚）`); // 中身は本人以外に見せない
    fx(ctx, { t: 'gacha', p: pi, card }, true);
    return true;
  }
  // 金・銀・銅の割合：総資産が他の人の平均より少ないほど金が、多いほど銅が出やすい
  function rarityMix(s, pi) {
    const R = C().BALANCE.rarity, others = s.players.filter((x, i) => i !== pi && !x.bankrupt).map((x) => totalAssets(s, x.id));
    if (!R || !others.length) return R ? R.even : null;
    const avg = sum(others) / others.length, gap = (totalAssets(s, pi) - avg) / Math.max(1, avg);
    const t = Math.max(-1, Math.min(1, gap / (R.gapFull || 0.5))), to = t < 0 ? R.behind : R.ahead, k = Math.abs(t);
    const mix = {};
    ['gold', 'silver', 'bronze'].forEach((r) => (mix[r] = R.even[r] + (to[r] - R.even[r]) * k));
    // 材料：高いほど金のカードが出やすく、銅が出にくい
    const m = statVal(s.players[pi], 'mat');
    mix.gold *= 1 + m; mix.bronze *= Math.max(0, 1 - m / 2);
    return mix;
  }
  // ランダムにカードを1枚選ぶ（金銀銅の割合 → そのランクの中から均等に）
  function randomCard(s, pi) {
    const E = C().EVENTS, mix = rarityMix(s, pi);
    if (!mix) return randInt(s, 0, E.length - 1);
    const ranks = ['gold', 'silver', 'bronze'].filter((r) => E.some((e) => e.rank === r));
    const tot = sum(ranks.map((r) => mix[r]));
    let x = rand(s) * tot, pick = ranks[ranks.length - 1];
    for (const r of ranks) { if ((x -= mix[r]) < 0) { pick = r; break; } }
    const ids = E.map((e, i) => (e.rank === pick ? i : -1)).filter((i) => i >= 0);
    return ids[randInt(s, 0, ids.length - 1)];
  }
  // スタート通過：カード1枚
  function drawCard(ctx, pi) { addCard(ctx, pi, randomCard(ctx.s, pi), 'スタート通過でカードを1枚手に入れた'); }
  // ステータスを上げる（上限あり）。上がったら true
  function statUp(ctx, pi, key) {
    const p = ctx.s.players[pi], S = C().BALANCE.stats;
    if (stat(p, key) >= S.max) return false;
    p.stats[key] = stat(p, key) + 1;
    return true;
  }
  const statName = (key) => (C().STAT_DEFS.find((d) => d.key === key) || { name: key }).name;

  function applyBuy(ctx, pi, id, mode, lv) {
    const s = ctx.s, p = s.players[pi], d = def(id), c = s.cells[id], names = C().LEVEL_NAMES;

    if (mode === 'tourist') {
      const tc = touristCost(s, id, pi);
      addMoney(ctx, pi, -tc, { buy: true }); setCell(ctx, id, pi, 0);
      log(ctx, `${p.name}:「${d.name}」観光地購入 -${tc}M`);
      fx(ctx, { t: 'build', p: pi, id, level: 0, mode });
    } else if (mode === 'mega') {
      const cost = invested(s, id), prev = c.owner;
      addMoney(ctx, pi, -cost, { buy: true }); setCell(ctx, id, pi, c.level, { noSkill: true }); // 代金は銀行へ（元の持ち主には入らない）
      delete p.fx.megaCell;
      log(ctx, `🏰 ${p.name}:「${d.name}」を${s.players[prev].name}から購入金額で購入 -${cost}M（代金は銀行へ）`);
      fx(ctx, { t: 'build', p: pi, id, level: c.level, mode: 'acquire', from: prev, cost });
    } else if (mode === 'acquire') {
      const cost = acquireCost(s, id, lv, pi), prev = c.owner, refund = invested(s, id);
      addMoney(ctx, prev, refund); addMoney(ctx, pi, -cost, { buy: true }); setCell(ctx, id, pi, d.type === 'tourist' ? 0 : lv, { noSkill: true });
      log(ctx, `${p.name}:「${d.name}」買収 -${cost}M ← ${s.players[prev].name}`);
      fx(ctx, { t: 'build', p: pi, id, level: lv, mode, from: prev, cost });
    } else {
      const cost = buyCost(s, id, lv, pi);
      addMoney(ctx, pi, -cost, { buy: true }); setCell(ctx, id, pi, lv);
      log(ctx, `${p.name}:「${d.name}」${names[lv]}${mode === 'upgrade' ? 'へ増築' : '購入'} -${cost}M`);
      fx(ctx, { t: 'build', p: pi, id, level: lv, mode });
    }
    // げきりん：壊したマスを使った人が買い直したら、通行料2倍（重ねがけあり）
    if (c.boostFor === pi) { c.mul = (c.mul > 1 ? c.mul : 1) * 2; log(ctx, `🐻 「${d.name}」の通行料が${c.mul}倍に！`); banner(ctx, '通行料アップ！', `「${d.name}」の通行料が${c.mul}倍`, 'gold', pi); fx(ctx, { t: 'cell', id }, true); }
    delete c.boostFor;
    ctx.base = assetSnap(s); // 購入（買収を含む）はゲージに数えない
    push(s, { k: 'checkWin', p: pi });
  }

  H.pay = (ctx, t) => {
    const s = ctx.s, p = s.players[t.from];
    if (p.bankrupt || !t.amount) return;
    if (t.rentCell != null) {
      // 通行料：ワールドカップ・黄砂は1回払われたら終わり。天使の加護・半額クーポンを持っていれば使う
      const c = s.cells[t.rentCell];
      if (c.wc || c.sand) { delete c.wc; delete c.sand; fx(ctx, { t: 'cell', id: t.rentCell }, true); }
      if (p.fx.angel) {
        p.fx.angel = false;
        log(ctx, `😇 ${p.name}: 天使の加護！通行料${t.amount}Mが無料に`);
        banner(ctx, '天使の加護！', `通行料 ${t.amount.toLocaleString()}M が無料`, 'good', t.from);
        return;
      }
      if (p.fx.coupon) {
        p.fx.coupon = false;
        log(ctx, `🎟 ${p.name}: 半額クーポン！通行料 ${t.amount}M → ${Math.floor(t.amount / 2)}M`);
        t = Object.assign({}, t, { amount: Math.floor(t.amount / 2), why: t.why + '（半額）' });
        if (!t.amount) return;
      }
    }
    const paid = takeMoney(ctx, t.from, t.to, t.amount, t.why);
    if (!paid) return;
    if (t.to >= 0 && !s.players[t.to].bankrupt) log(ctx, `${p.name}: ${t.why} ${t.amount}M → ${s.players[t.to].name}`);
    else log(ctx, `${p.name}: ${t.why} -${t.amount}M`);
    push(s, { k: 'solvency', p: t.from });
  };

  // 所持金不足のチェック → 売却 or 破産
  H.solvency = (ctx, t) => {
    const s = ctx.s, pi = t.p, p = s.players[pi], B = C().BALANCE;
    if (p.bankrupt || p.money > B.insolventAt) return;
    if (p.fx.noBankrupt) { log(ctx, `${p.name}: あの夏は終わらない！破産免除☀️`); return; }
    if (p.fx.genjitsuka && !t.noGen) { // さこう「具現化」は所持金0以下で発動
      genFire(ctx, pi);
      push(s, { k: 'solvency', p: pi, noGen: true });
      return;
    }
    if (p.money >= 0) return; // 所持金がちょうど0なら売却は不要（マイナスになった時だけ売却・破産）
    const sellable = ownedIds(s, pi);
    if (!sellable.length) { bankrupt(ctx, pi); return; }
    log(ctx, `${p.name}: 所持金不足！資産を売却してください💸`);
    setPending(s, {
      kind: 'sell', player: pi,
      options: sellable.map((id) => ({ value: id, label: def(id).name, cost: sellPrice(s, id) })),
    });
  };
  // さこう：具現化スタンバイ中に所持金が一定額を下回ったら発動
  H.genCheck = (ctx, t) => {
    const p = ctx.s.players[t.p];
    if (!p.bankrupt && p.fx.genjitsuka && p.money <= genSk(p).threshold) genFire(ctx, t.p); // 所持金が0以下になったら発動
  };
  function genSk(p) { return C().CHARACTERS[p.fx.genSkill || p.char].skill; }
  function genFire(ctx, pi) {
    const s = ctx.s, p = s.players[pi], B = C().BALANCE;
    {
      if (B.genjitsukaOncePerLap) p.fx.genjitsuka = false;
      fx(ctx, { t: 'splash', kind: 'skill', img: C().CHARACTERS[p.fx.genSkill || p.char].skillImg, title: '具現化' });
      const sk = genSk(p);
      // 所持金が尽きる原因になった支払いを、なかったことにする（受け取った人からも戻す）
      const L = ctx.lastLoss;
      if (L && L.pi === pi && L.amount > 0) {
        if (L.to >= 0 && !s.players[L.to].bankrupt) addMoney(ctx, L.to, -L.amount, { noSkill: true, guarded: true });
        addMoney(ctx, pi, L.amount, { noSkill: true });
        log(ctx, `💰 ${p.name}: 具現化！${L.amount.toLocaleString()}Mの支払いをキャンセル`);
        ctx.lastLoss = null;
      }
      aliveOthers(s, pi).forEach((oi) => {
        const op = s.players[oi];
        const take = takeMoney(ctx, oi, pi, pct(op.money, sk.stealRate), '具現化');
        log(ctx, `💰 ${p.name}: 具現化！${op.name}から${take}M略奪`);
      });
      // 建物・観光地が立っているマス（自分のマスも含む）からランダムに takeCells マスを、建物ごと自分のマスにする
      const pool = s.cells.filter((c) => c.owner >= 0 && (def(c.id).type === 'tourist' || (def(c.id).type === 'prop' && c.level > 0))).map((c) => c.id);
      const picks = [];
      while (picks.length < (sk.takeCells || 3) && pool.length) picks.push(pool.splice(randInt(s, 0, pool.length - 1), 1)[0]);
      let gained = 0;
      picks.forEach((id) => {
        const c = s.cells[id], prev = c.owner;
        if (prev === pi) { log(ctx, `💰 ${p.name}: 具現化！「${def(id).name}」…もともと自分のマスだった`); return; }
        gained++;
        setCell(ctx, id, pi, c.level);
        log(ctx, `💰 ${p.name}: 具現化！「${def(id).name}」を${s.players[prev].name}から奪った`);
        fx(ctx, { t: 'build', p: pi, id, level: c.level, mode: 'skill' });
      });
      banner(ctx, '具現化 発動！', `支払いキャンセル＋全員から略奪＋${gained}マスを奪取！`, 'skill', pi);
      push(s, { k: 'checkWin', p: pi });
    }
  }
  function bankrupt(ctx, pi) {
    const s = ctx.s, p = s.players[pi];
    if (p.fx.noBankrupt) { log(ctx, `${p.name}: あの夏は終わらない！破産免除☀️`); return; }
    // 払えなかった分は受け取った人から戻す：受け取れるのは「払った人の総資産（所持金＋残った物件の売値）」まで
    const short = -p.money, L = p.lastPay;
    if (short > 0 && L && L.to >= 0 && !s.players[L.to].bankrupt) {
      const cover = ownedIds(s, pi).reduce((a, id) => a + sellPrice(s, id), 0);
      const back = Math.min(L.amount, Math.max(0, short - cover), Math.max(0, s.players[L.to].money));
      if (back > 0) s.players[L.to].money -= back; // 払えなかった分は受け取った人から差し引く（表示はしない）
    }
    p.lastPay = null;
    if (p.money < 0) p.money = 0;
    p.bankrupt = true;
    log(ctx, `💀 ${p.name}: 総資産すべて支払い破産（ゲームオーバー）`);
    fx(ctx, { t: 'bankrupt', p: pi });
    ownedIds(s, pi).forEach((id) => setCell(ctx, id, -1, 0, { noSkill: true }));
    fx(ctx, { t: 'sync' }, true);
    const alive = s.players.filter((x) => !x.bankrupt);
    if (alive.length === 1) win(ctx, alive[0].id, { msg: '👑 最後の生き残り！', detail: '他の全プレイヤーを破産させました！' });
  }
  function win(ctx, pi, info) {
    const s = ctx.s;
    s.winner = { player: pi, msg: info.msg, detail: info.detail };
    s.phase = 'over';
    s.pending = null;
    s.queue = [];
    log(ctx, `🎊 ${s.players[pi].name}の勝利！ ${info.msg} ${info.detail}`);
    fx(ctx, { t: 'win', p: pi }, true);
  }
  H.checkWin = (ctx, t) => {
    const v = checkVictory(ctx.s, t.p);
    if (v) win(ctx, t.p, v);
  };

  // ---------- スキル ----------
  // ターンの最初にカードを使った後、サイコロ待ちに戻す
  H.resumeRoll = (ctx) => {
    const s = ctx.s, p = s.players[s.current];
    if (p.bankrupt || p.skip > 0) { push(s, { k: 'endTurn' }); return; }
    s.phase = 'roll';
    fx(ctx, { t: 'sync' }, true);
  };
  // t.skillOf：他のキャラのスキルを使う時（カード「6vおおしまか」）
  H.skill = (ctx, t) => {
    const s = ctx.s, pi = t.p, p = s.players[pi], sk = t.skillOf ? C().CHARACTERS[t.skillOf].skill : charOf(p).skill;
    switch (sk.id) {
      case 'zettaireido': {
        const targets = aliveOthers(s, pi);
        if (targets.length) setPending(s, { kind: 'player', purpose: 'zettaireido', player: pi, options: targets, data: { skillOf: t.skillOf }, title: '❄️ 絶対零度：対象を選択' });
        return;
      }
      case 'gamer':
        // ゲーマーの意地：4つの効果から1つ選ぶ
        setPending(s, { kind: 'gamer', player: pi, options: sk.choices.map((c) => c.id), data: { at: t.at, skillOf: t.skillOf }, title: '🎮 ゲーマーの意地：効果を1つ選ぶ' });
        return;
      case 'tabidachi': {
        // 突然の旅立ち：銀行から旅費 +bankGain M → 好きなマスへワープ
        const total = sk.bankGain || 0;
        if (total) addMoney(ctx, pi, total);
        log(ctx, `✈️ ${p.name}: 突然の旅立ち！銀行から${total.toLocaleString()}M`);
        banner(ctx, `+${total.toLocaleString()}M！`, '好きなマスへ飛ぶ！', 'skill', pi);
        const opts = travelOpts(s, pi);
        if (t.at === 'turnStart') {
          // ターンの最初に使用：ワープ先で購入・通行料を処理してから、サイコロを振る
          setPending(s, { kind: 'cell', purpose: 'warp', player: pi, options: opts, data: { visit: true }, title: '✈️ 突然の旅立ち：移動先を選択' });
        } else if (pi === s.current) {
          // 自分の手番：残りの移動・購入・手番終了を取り消して、ワープ先で改めて処理
          s.queue = s.queue.filter((q) => !(((q.k === 'step' || q.k === 'land' || q.k === 'offer') && q.p === pi) || q.k === 'endTurn'));
          setPending(s, { kind: 'cell', purpose: 'warp', player: pi, options: opts, title: '✈️ 突然の旅立ち：移動先を選択' });
        } else {
          // 他人の手番：ワープ先で購入・通行料だけ処理（手番は進めない）
          setPending(s, { kind: 'cell', purpose: 'warp', player: pi, options: opts, data: { visit: true }, title: '✈️ 突然の旅立ち：移動先を選択' });
        }
        return;
      }
      case 'genjitsuka':
        startLap(p, 'genjitsuka'); p.fx.genSkill = t.skillOf || p.char;
        log(ctx, `💰 ${p.name}: 具現化！1周の間、${sk.threshold > 0 ? `所持金が${sk.threshold}M未満になったら` : '所持金が0以下になったら'}全員から略奪できる`);
        banner(ctx, '具現化スタンバイ！', sk.threshold > 0 ? `1周の間、所持金が${sk.threshold}M未満になったら発動` : '1周の間、所持金が0以下になったら発動', 'skill', pi);
        push(s, { k: 'genCheck', p: pi });
        return;
    }
  };

  // ---------- 地震・破壊 ----------
  H.quake = (ctx, t) => {
    const s = ctx.s;
    fx(ctx, { t: 'splash', kind: 'quake', img: C().IMAGES.quake, title: '地震' });
    const targets = s.cells.filter((c) => c.owner >= 0 && (def(c.id).type === 'tourist' || c.level > 0)).map((c) => c.id);
    if (!targets.length) { log(ctx, '🌋 地震！対象なし'); push(s, { k: 'endTurn' }); return; }
    setPending(s, { kind: 'cell', purpose: 'quake', player: t.p, options: targets, title: '🌋 破壊する建物を選択してください' });
  };
  // 火災保険：自分の建物が壊される効果の対象になった時、1回だけ守る。守ったら true
  function shieldBlock(ctx, owner, what) {
    const s = ctx.s, o = s.players[owner], EV = C().EVENTS;
    if (owner < 0 || !o) return false;
    if (o.fx.insured) { // （旧）加入済みの保険
      o.fx.insured = false;
      log(ctx, `🧯 ${o.name}: 火災保険で${what}を守った！（保険はこれで終了）`);
      banner(ctx, '火災保険で守った！', `${o.name}：${what}は無事`, 'good', owner);
      return true;
    }
    // 火災保険募集人の営業：持っているだけで効く。守る時に、さこうへ所持金の◯%を払う（カードは消える）
    const k = o.hand.findIndex((c) => EV[c] && EV[c].id === 'kasaihoken');
    if (k < 0) return false;
    const ev = EV[o.hand[k]];
    o.hand.splice(k, 1);
    fx(ctx, { t: 'splash', kind: 'event', img: ev.img, title: ev.name, card: true });
    const sk = findChar(s, ev.payee), fee = pct(o.money, ev.costRate);
    if (sk >= 0 && sk !== owner && !s.players[sk].bankrupt) takeMoney(ctx, owner, sk, fee, '火災保険');
    else if (sk < 0) addMoney(ctx, owner, -fee);
    log(ctx, `🧯 ${o.name}: 火災保険で${what}を守った！${sk !== owner ? `（${ev.payee}に${fee.toLocaleString()}M）` : ''}`);
    banner(ctx, '火災保険で守った！', `${o.name}：${what}は無事${sk !== owner ? `（${ev.payee}に${fee.toLocaleString()}M）` : ''}`, 'good', owner);
    push(s, { k: 'solvency', p: owner });
    return true;
  }
  H.destroy = (ctx, t) => {
    const s = ctx.s, c = s.cells[t.id];
    if (c.owner < 0) return;
    if (shieldBlock(ctx, c.owner, `「${def(t.id).name}」`)) return;
    if (t.thenBuy != null) push(s, { k: 'offer', p: t.thenBuy, id: t.id }); // げきりん：壊したあと、使った人が購入できる（買えば通行料2倍）
    log(ctx, `💥「${def(t.id).name}」を破壊（${t.why}・${s.players[c.owner].name}所有）`);
    fx(ctx, { t: 'shake', id: t.id });
    setCell(ctx, t.id, -1, 0);
    if (t.thenBuy != null) c.boostFor = t.thenBuy;
  };

  // ---------- チャンスイベント ----------
  // t.card があれば「イベントカードを使った」：効果はチャンスと同じ。終わったらサイコロ待ちに戻る
  H.event = (ctx, t) => {
    const s = ctx.s, pi = t.p, p = s.players[pi], K = C();
    const fromHand = t.card != null, auto = !!t.auto;
    const card = fromHand && !auto; // 手札から自分で使った時だけ true（自動発動はチャンスと同じ流れ：最後に手番終了）
    const idx = fromHand ? t.card : s.debug && s.debugEvent != null ? Math.min(s.debugEvent, K.EVENTS.length - 1) : randInt(s, 0, K.EVENTS.length - 1);
    const ev = K.EVENTS[idx];
    log(ctx, card ? `🎴 ${p.name}: カード「${ev.name}」を使った${ev.icon}` : auto ? `🎴 ${p.name}: 手札があふれて「${ev.name}」が自動発動！${ev.icon}` : `${p.name}: チャンス → ${ev.name}${ev.icon}`);
    fx(ctx, { t: 'splash', kind: 'event', img: ev.img, title: ev.name, card });
    const end = card ? { k: 'resumeRoll' } : { k: 'endTurn' };
    // 持っているだけで効くカード（ふみね・あの夏・プルタ）が手札あふれで自動発動した時は、効果なしで消えるだけ
    if (auto && ev.passive) {
      log(ctx, `${p.name}: 「${ev.name}」は持っているだけで効くカード。手札からあふれて消えてしまった`);
      banner(ctx, `${ev.name}が…`, '手札からあふれて消えてしまった', 'bad', pi);
      push(s, end); return;
    }
    switch (ev.id) {
      case 'travel': {
        const v = findChar(s, ev.victim);
        if (v < 0) { log(ctx, `${ev.victim}は不在のためスキップ`); push(s, end); return; }
        const amt = pct(s.players[v].money, ev.costRate);
        log(ctx, `${s.players[v].name}: ${ev.name} -${amt}M（所持金の${ev.costRate * 100}%）😭`);
        push(s, { k: 'pay', from: v, to: -1, amount: amt, why: ev.name }, { k: 'evTravel', p: pi, v, card });
        return;
      }
      case 'glass': {
        const id = K.BOARD.find((d) => d.name === ev.cellName).id;
        const prev = s.cells[id].owner;
        setCell(ctx, id, pi, 0);
        log(ctx, `${p.name}:「${ev.cellName}」取得（前所有者: ${prev >= 0 ? s.players[prev].name : 'なし'}）`);
        const v = findChar(s, ev.victim);
        const tasks = [];
        if (v >= 0) tasks.push({ k: 'pay', from: v, to: -1, amount: pct(s.players[v].money, ev.costRate), why: ev.name });
        push(s, ...tasks, { k: 'checkWin', p: pi }, end);
        return;
      }
      case 'roof':
        setPending(s, { kind: 'roof', player: pi, options: ['black', 'gray'], img: ev.img, card });
        return;
      case 'stinori':
        if (summerGuard(ctx, pi)) { push(s, end); return; }
        p.skip = 1; s.reroll = false;
        log(ctx, `${p.name}: スチノリハウスに捕まった！1回休み🏠`);
        fx(ctx, { t: 'rest', p: pi, why: 'スチノリハウス' });
        push(s, end); return;
      case 'daienjou': {
        // 大炎上：自分の建物（物件・観光地）を1つ選ぶ → 一度燃えて、同じ建物に作り直される。そのマスの通行料は2倍（重ねがけあり・ずっと）
        const mine = ownedIds(s, pi).filter((id) => def(id).type === 'tourist' || s.cells[id].level > 0);
        if (!mine.length) { log(ctx, '燃やせる建物がなかった…'); banner(ctx, '空振り…', '自分の建物がない', 'bad', pi); push(s, end); return; }
        setPending(s, { kind: 'cell', purpose: 'enjou', player: pi, options: mine, data: { card }, title: '🔥 大炎上：通行料を2倍にする自分の建物を選択' });
        push(s, end); return;
      }
      case 'typhoon':
        startLap(p, 'typhoon');
        log(ctx, `🌀 ${p.name}: 1周の間、通り越した相手の所持金とゲージの1/4を奪う`);
        push(s, end); return;
      case 'tossatu': {
        const v = findChar(s, ev.victim);
        if (v < 0) { log(ctx, `${ev.victim}は不在のためスキップ`); push(s, end); return; }
        const vp = s.players[v];
        if (summerGuard(ctx, v)) { push(s, end); return; }
        vp.skip = 1; // その場で1回休み（移動はしない）
        if (v === s.current) s.reroll = false;
        log(ctx, `${vp.name}: 盗撮ダメ絶対！その場で1回休み`);
        fx(ctx, { t: 'rest', p: v, why: '盗撮ダメ絶対' });
        push(s, end); return;
      }
      case 'gekirin': {
        // 設計課題のげきりん：建物のあるマス（他人の物件・観光地）を選んで壊す → そのあと使った人が土地を購入できる（代金は銀行へ）
        const opts = s.cells.filter((c) => c.owner >= 0 && c.owner !== pi && (def(c.id).type === 'tourist' || (def(c.id).type === 'prop' && c.level > 0))).map((c) => c.id);
        if (!opts.length) { log(ctx, '壊せる建物がなかった'); banner(ctx, '空振り…', '壊せる建物がない', 'bad', pi); push(s, end); return; }
        setPending(s, { kind: 'cell', purpose: 'gekirin', player: pi, options: opts, data: { card }, title: '🐻 建物を壊すマスを選択（そのあと購入できる）' });
        push(s, end); return;
      }
      case 'mousugutsuku': {
        // もうすぐ着く：さだは、すぎうらに追いつかれるまでその場で待機。追いついたら すぎうら→さだ 700M
        const w = findChar(s, ev.waiter), c2 = findChar(s, ev.catcher);
        if (w < 0 || c2 < 0) { log(ctx, `${ev.waiter}か${ev.catcher}がいないのでスキップ`); push(s, end); return; }
        const wp = s.players[w];
        wp.fx.waitFor = c2; wp.fx.waitPayRate = ev.payRate;
        log(ctx, `🛏 ${wp.name}: 「もうすぐ着く」…${s.players[c2].name}に追いつかれるまで「${def(wp.pos).name}」で待機`);
        banner(ctx, 'もうすぐ着く…', `${wp.name}は${s.players[c2].name}が来るまで待機`, 'bad', w);
        if (w === s.current) { s.reroll = false; push(s, { k: 'endTurn' }); return; }
        push(s, end); return;
      }
      case 'pandorobou': {
        const targets = aliveOthers(s, pi).filter((i) => s.players[i].hand.length);
        if (!targets.length || p.hand.length >= C().BALANCE.gacha.handMax) { log(ctx, 'もらえるカードがなかった'); banner(ctx, '空振り…', 'カードを持っている相手がいない', 'bad', pi); push(s, end); return; }
        setPending(s, { kind: 'player', purpose: 'panSteal', player: pi, options: targets, title: '🍞 カードをもらう相手を選択' });
        push(s, end); return;
      }
      case 'oosimaka': {
        const targets = aliveOthers(s, pi).filter((i) => s.players[i].charge >= 100);
        if (!targets.length) { log(ctx, 'スキルゲージが溜まっている人がいなかった'); banner(ctx, '空振り…', 'ゲージ満タンの人がいない', 'bad', pi); push(s, end); return; }
        setPending(s, { kind: 'player', purpose: 'oosimaka', player: pi, options: targets, title: '💜 スキルを借りる相手を選択（ゲージ満タンの人）' });
        push(s, end); return;
      }
      case 'fumine': {
        // 持っているだけで効くカード：自動発動した時は効果なし（手札から抜けるだけ）／チャンスで出た時はカードをもらう
        if (auto) {
          log(ctx, `${p.name}: 「${ev.name}」は持っているだけで効くカード。手札から抜けてしまった`);
          banner(ctx, 'ふみねの加護が…', '手札からあふれて消えてしまった', 'bad', pi);
        } else if (!card) {
          addCard(ctx, pi, idx);
          log(ctx, `${p.name}: 「${ev.name}」のカードをもらった（持っているだけで効く）`);
          banner(ctx, 'ふみねの加護をもらった！', '大きな損をした時に、自動で守ってくれる', 'good', pi);
        }
        push(s, end); return;
      }
      case 'shuudendash': {
        // 終電ダッシュ：1〜5マス先へ移動してマスの処理。このターンはサイコロを振らず、次のターンは休み
        const opts = []; for (let d = 1; d <= ev.range; d++) opts.push((p.pos + d) % K.BOARD.length);
        setPending(s, { kind: 'cell', purpose: 'shuuden', player: pi, options: opts, data: { card }, title: `🚃 終電ダッシュ：${ev.range}マス先までの移動先を選択` });
        return;
      }
      case 'ransuu':
        // 乱数の支配者：1周する間、サイコロのブレがなくなる（ゲージで狙った目がそのまま出る）
        startLap(p, 'steady');
        log(ctx, `🎲 ${p.name}: 乱数の支配者！1周する間、狙った目がそのまま出る`);
        banner(ctx, '乱数の支配者！', '1周する間、狙った目がそのまま出る', 'skill', pi);
        push(s, end); return;
      case 'uekarashitsurei': {
        const opts = s.cells.filter((c) => c.owner >= 0 && ['prop', 'tourist'].includes(def(c.id).type)).map((c) => c.id);
        if (!opts.length) { log(ctx, '焼き払う不動産がなかった'); push(s, end); return; }
        setPending(s, { kind: 'cell', purpose: 'burn', player: pi, options: opts, title: '🪂 焼滅させる不動産を選択' });
        push(s, end); return;
      }
    }
  };
  // ---------- チャンスマス（本家ゲットリッチのチャンスカード風。中身は config の CHANCES） ----------
  function propsOf(s, pi, opts = {}) {
    return s.cells.filter((c) => {
      const d = def(c.id);
      if (!['prop', 'tourist'].includes(d.type) || c.owner < 0) return false;
      if (opts.mine ? c.owner !== pi : c.owner === pi) return false;
      if (s.players[c.owner].bankrupt) return false;
      if (opts.noLandmark && c.level >= 3) return false;
      return true;
    }).map((c) => c.id);
  }
  // チャンスマス：イベントカードの効果がランダムで1つ起きる
  H.chance = (ctx, t) => { push(ctx.s, { k: 'event', p: t.p }); };
  H.chanceOld = (ctx, t) => {
    const s = ctx.s, pi = t.p, p = s.players[pi], K = C(), END = { k: 'endTurn' };
    const list = K.CHANCES;
    let idx;
    if (s.debug && s.debugEvent != null && s.debugEvent >= 100) idx = Math.min(s.debugEvent - 100, list.length - 1);
    else {
      const tot = list.reduce((a, c) => a + (c.weight != null ? c.weight : 1), 0);
      let r = rand(s) * tot; idx = 0;
      for (; idx < list.length - 1; idx++) { r -= list[idx].weight != null ? list[idx].weight : 1; if (r < 0) break; }
    }
    const ch = list[idx];
    log(ctx, `${p.name}: チャンス → ${ch.icon}${ch.name}`);
    fx(ctx, { t: 'chance', p: pi, icon: ch.icon, name: ch.name, desc: ch.desc, tone: ch.tone || 'info' });
    const pick = (purpose, options, title, data) => {
      if (!options.length) { log(ctx, `${ch.name}：対象になるマスがなかった`); banner(ctx, '対象なし…', `${ch.name}の対象がなかった`, 'bad', pi); push(s, END); return; }
      setPending(s, { kind: 'cell', purpose, player: pi, options, title, data });
    };
    switch (ch.id) {
      case 'angel': p.fx.angel = true; push(s, END); return;
      case 'coupon': p.fx.coupon = true; push(s, END); return;
      case 'bonus': addMoney(ctx, pi, ch.amount || 300); push(s, END); return;
      case 'worldcup': pick('chWorldcup', propsOf(s, pi, { mine: true }), '🏆 ワールドカップを開催する自分の物件を選択'); return;
      case 'travel': {
        const opts = travelOpts(s, pi);
        setPending(s, { kind: 'cell', purpose: 'travel', player: pi, options: opts, title: '🗺 敷地調査：行き先を選択' });
        return;
      }
      case 'swap': {
        const mine = propsOf(s, pi, { mine: true, noLandmark: true }), theirs = propsOf(s, pi, { noLandmark: true });
        if (!mine.length || !theirs.length) { pick('chSwapMine', [], ''); return; }
        pick('chSwapMine', mine, '🔄 都市交換：渡す自分の物件を選択');
        return;
      }
      case 'buyLand': {
        // 土地買い付け：空いている物件・観光地を1つ選んで、その場で購入（物件は住宅付き）
        const opts = s.cells.filter((c) => c.owner < 0 && ['prop', 'tourist'].includes(def(c.id).type) && p.money >= landPrice(c.id)).map((c) => c.id);
        pick('chBuyLand', opts, '🏗 土地買い付け：買う空き地を選択');
        return;
      }
      case 'forceSell': pick('chForceSell', propsOf(s, pi, { noLandmark: true }), '💥 強制売却：売却させる相手の物件を選択'); return;
      case 'sand': pick('chSand', propsOf(s, pi), '🌪 黄砂：通行料を半額にする相手の物件を選択'); return;
      case 'island':
        p.pos = K.ISLAND_ID; p.skip = 1; s.reroll = false;
        fx(ctx, { t: 'pos', p: pi }, true);
        fx(ctx, { t: 'rest', p: pi, why: K.BOARD[K.ISLAND_ID].name });
        push(s, END); return;
      case 'donate': {
        const others = aliveOthers(s, pi);
        const each = others.length ? Math.floor(Math.max(0, p.money) * (ch.rate || 0.1) / others.length) : 0;
        others.forEach((oi) => takeMoney(ctx, pi, oi, each, '寄付'));
        push(s, { k: 'solvency', p: pi }, END); return;
      }
      default: push(s, END);
    }
  };
  function landPrice(id) { const d = def(id); return d.type === 'tourist' ? d.price : d.prices[0]; }
  function chanceChoose(ctx, pd, v) {
    const s = ctx.s, pi = pd.player, p = s.players[pi], END = { k: 'endTurn' };
    switch (pd.purpose) {
      case 'chWorldcup':
        s.cells[v].wc = true; delete s.cells[v].sand;
        fx(ctx, { t: 'cell', id: v }, true);
        log(ctx, `🏆 ${p.name}:「${def(v).name}」でワールドカップ開催！次に誰かが止まるまで通行料2倍`);
        banner(ctx, 'ワールドカップ開催！', `「${def(v).name}」の通行料が2倍`, 'gold', pi);
        push(s, END); return;
      case 'chBuyLand': {
        const d = def(v), price = landPrice(v);
        addMoney(ctx, pi, -price, { buy: true });
        setCell(ctx, v, pi, d.type === 'prop' ? 1 : 0);
        ctx.base = assetSnap(s); // 購入はゲージに数えない
        log(ctx, `🏗 ${p.name}: 土地買い付けで「${d.name}」を購入 -${price}M`);
        fx(ctx, { t: 'build', p: pi, id: v, level: d.type === 'prop' ? 1 : 0, mode: d.type === 'prop' ? 'buy' : 'tourist' });
        push(s, { k: 'checkWin', p: pi }, END); return;
      }
      case 'chSand': {
        const c = s.cells[v]; c.sand = true; delete c.wc;
        fx(ctx, { t: 'cell', id: v }, true);
        log(ctx, `🌪 ${p.name}:「${def(v).name}」に黄砂！次に誰かが止まるまで通行料半額`);
        banner(ctx, '黄砂！', `「${def(v).name}」の通行料が半額`, 'bad', c.owner);
        push(s, END); return;
      }
      case 'chForceSell': {
        const c = s.cells[v], owner = c.owner, price = sellPrice(s, v);
        setCell(ctx, v, -1, 0);
        addMoney(ctx, owner, price, { noSkill: true });
        log(ctx, `💥 ${p.name}: ${s.players[owner].name}の「${def(v).name}」を強制売却（+${price}M は持ち主へ）`);
        banner(ctx, '強制売却！', `${s.players[owner].name}の「${def(v).name}」が売りに出された`, 'rent', pi);
        push(s, { k: 'checkWin', p: pi }, END); return;
      }
      case 'chSwapMine': {
        const theirs = propsOf(s, pi, { noLandmark: true });
        setPending(s, { kind: 'cell', purpose: 'chSwapTheirs', player: pi, options: theirs, data: { mine: v }, title: '🔄 都市交換：もらう相手の物件を選択' });
        return;
      }
      case 'chSwapTheirs': {
        const a = pd.data.mine, b = v, ca = s.cells[a], cb = s.cells[b], other = cb.owner;
        const la = ca.level, lb = cb.level;
        setCell(ctx, a, other, la); setCell(ctx, b, pi, lb);
        log(ctx, `🔄 ${p.name}:「${def(a).name}」と ${s.players[other].name}の「${def(b).name}」を交換！`);
        banner(ctx, '都市交換！', `「${def(a).name}」⇄「${def(b).name}」`, 'skill', pi);
        push(s, { k: 'checkWin', p: pi }, { k: 'checkWin', p: other }, END); return;
      }
    }
  }
  H.evTravel = (ctx, t) => {
    const s = ctx.s;
    if (s.players[t.v].bankrupt || s.players[t.p].bankrupt) { push(s, { k: t.card ? 'resumeRoll' : 'endTurn' }); return; }
    const pos = s.players[t.p].pos;
    const opts = s.cells.filter((c) => ['prop', 'tourist'].includes(def(c.id).type) && c.id !== pos).map((c) => c.id);
    setPending(s, { kind: 'cell', purpose: 'evTravel', player: t.p, options: opts, data: { v: t.v, card: !!t.card }, title: '🏖️ 旅行先を選択してください' });
  };
  H.evTravelRent = (ctx, t) => {
    const s = ctx.s, v = s.players[t.v];
    if (t.v === t.p || v.bankrupt) return;
    const id = v.pos, c = s.cells[id];
    if (c.owner >= 0 && c.owner !== t.v) push(s, { k: 'pay', from: t.v, to: c.owner, amount: rentFor(s, id, t.v), why: '通行料', rentCell: id });
  };

  // ---------- ターン終了 ----------
  H.endTurn = (ctx) => {
    const s = ctx.s, B = C().BALANCE, cur = s.players[s.current];
    s.players.forEach((x) => { delete x.fx.megaCell; }); // なんでも買収で買わなかった時は、ここで権利が消える
    // 手札があふれて自動発動するカード：手番の処理が全部終わったここで、1枚ずつ発動（発動後にまた endTurn に戻る）
    const ai = s.players.findIndex((x) => !x.bankrupt && x.autoCards && x.autoCards.length);
    if (ai >= 0) {
      const card = s.players[ai].autoCards.shift();
      push(s, { k: 'event', p: ai, card, auto: true });
      return;
    }
    if (cur.fx.gamerOn) {
      if (cur.fx.gamerLeft > 0 && !cur.bankrupt && cur.skip === 0) {
        s.reroll = false; s.phase = 'roll';
        log(ctx, `🎮 ${cur.name}: ゲーマーの意地！あと${cur.fx.gamerLeft}回動ける`);
        fx(ctx, { t: 'turn', p: s.current, again: true, gamer: cur.fx.gamerLeft }, true);
        return;
      }
      cur.fx.gamerOn = false; cur.fx.gamerLeft = 0;
      log(ctx, `${cur.name}: ゲーマーの意地 効果終了`);
    }
    if (s.reroll && !cur.bankrupt && cur.skip === 0) {
      s.reroll = false; s.phase = 'roll';
      log(ctx, `${cur.name}: ゾロ目！もう一度サイコロを振れます🎲`);
      fx(ctx, { t: 'turn', p: s.current, again: true }, true);
      return;
    }
    s.reroll = false; cur.doubleStreak = 0;
    const alive = s.players.filter((x) => !x.bankrupt);
    if (alive.length <= 1) { if (alive.length) win(ctx, alive[0].id, { msg: '👑 最後の生き残り！', detail: '他の全プレイヤーを破産させました！' }); return; }
    for (let guard = 0; guard < 100; guard++) {
      const ord = s.order || s.players.map((_, i) => i), n = ord.length, k = ord.indexOf(s.current);
      let nk = (k + 1) % n;
      while (s.players[ord[nk]].bankrupt) nk = (nk + 1) % n;
      if (nk <= k) s.turn++; // 順番が一周したら次のターン
      const next = ord[nk];
      if (s.turn > B.maxTurns) {
        const w = ranks(s)[0];
        win(ctx, w, { msg: '⏰ タイムアップ！', detail: `${B.maxTurns}ターン終了！総資産${totalAssets(s, w).toLocaleString()}Mで1位！` });
        return;
      }
      s.current = next;
      const np = s.players[next];
      if (np.skip > 0) { np.skip--; log(ctx, `${np.name}: 1回休み`); continue; }
      if (np.fx.waitFor != null) {
        const wf = s.players[np.fx.waitFor];
        if (!wf || wf.bankrupt) { np.fx.waitFor = null; }
        else { log(ctx, `🛏 ${np.name}: ${wf.name}が来るまで待機中…`); continue; }
      }
      if (s.debug && np.hand.length < C().BALANCE.gacha.handMax) np.hand.push(randInt(s, 0, C().EVENTS.length - 1)); // DEBUG：毎ターンカード1枚
      if (s.debug) np.charge = 100; // DEBUG：毎ターン スキルゲージ満タン
      if (np.fx.gamerNext) {
        np.fx.gamerNext = false; np.fx.gamerLeft = charOf(np).skill.moves;
        log(ctx, `🎮 ${np.name}: ゲーマーの意地！このターンは${np.fx.gamerLeft}回連続で動ける`);
      }
      break;
    }
    s.phase = 'roll'; s.canCard = true;
    log(ctx, `— ${s.players[s.current].name} のターン —`);
    fx(ctx, { t: 'turn', p: s.current }, true);
  };

  // ---------- サイコロ ----------
  // 乱数の支配者を使っている間（1周する間）はブレなし
  function steadyMul(s, pi) { return s.players[pi].fx.steady ? (C().EVENTS.find((e) => e.id === 'ransuu').spreadMul || 0) : 1; }
  // gauge: 0〜1（ゲージの停止位置）。左ほど小さい目、右ほど大きい目が出やすい
  function rollDice(s, pi, gauge, forced) {
    const p = s.players[pi];
    const spread = (statVal(p, 'plan') + (p.isHuman ? 0 : (C().BALANCE.cpuDiceExtra || 0))) * steadyMul(s, pi); // 計画が高いほどブレが小さい（CPUはさらに±1ブレる）
    if (forced) {
      if (forced === 2 || forced === 12) return [forced / 2, forced / 2];
      // ゾロ目にならない組み合わせで出す（例：8 → 3+5）
      let v1 = Math.max(1, Math.min(6, forced - 6)), v2 = forced - v1;
      if (v1 === v2) { v1 -= 1; v2 += 1; }
      return [v1, v2];
    }
    // ゲージで「合計」を狙う → 組み合わせはランダムに分ける（ゾロ目は本物のサイコロより少し出にくく）
    //   2つのサイコロを同じ目の近くに寄せると、ゾロ目ばかり出てしまうため
    // ゲージは時計（一周で戻る）なので、合計2〜12の11段階も輪になっている：12を狙ってブレると2・3に行くこともある
    const pickT = () => 2 + ((((Math.round(gauge * 11 - 0.5 + (rand(s) - 0.5) * spread)) % 11) + 11) % 11);
    let T = pickT();
    // 2と12（必ずゾロ目）は本物のサイコロでもめったに出ないので、半分の確率で振り直す
    if ((T === 2 || T === 12) && rand(s) < C().BALANCE.edgeReroll) T = pickT();
    const pairs = [];
    for (let a = Math.max(1, T - 6); a <= Math.min(6, T - 1); a++) pairs.push([a, T - a, a === T - a ? C().BALANCE.doubleWeight : 1]);
    let r = rand(s) * pairs.reduce((x, q) => x + q[2], 0);
    for (const q of pairs) { r -= q[2]; if (r < 0) return [q[0], q[1]]; }
    const q = pairs[pairs.length - 1];
    return [q[0], q[1]];
  }

  // ---------- 行動の受付 ----------
  // action: { type:'roll', player, gauge, forced? } / { type:'predict', player, guess } /
  //         { type:'choose', player, value } / { type:'debug', on, event? }
  function dispatch(state, action) {
    const s = clone(state);
    const ctx = { s, fx: [], steps: 0 };
    ctx.base = assetSnap(s);
    const err = validate(s, action);
    if (err) return { state, effects: [], error: err };

    if (action.type === 'debug') {
      s.debug = !!action.on;
      s.debugEvent = action.event != null && action.event !== '' ? Number(action.event) : null;
      return { state: s, effects: [] };
    }
    if (action.type === 'debugSet') {
      // DEBUG専用：マスの所有者とレベルを直接変更（勝利条件のテスト用）
      const d = def(action.id), owner = action.owner;
      setCell(ctx, action.id, owner, d.type === 'prop' && owner >= 0 ? Math.max(1, action.level || 1) : 0, { noSkill: true });
      log(ctx, `🛠 DEBUG:「${d.name}」→ ${owner >= 0 ? s.players[owner].name + ' / ' + C().LEVEL_NAMES[s.cells[action.id].level] : '未所有'}`);
      if (owner >= 0) push(s, { k: 'checkWin', p: owner });
      run(ctx);
      return { state: s, effects: ctx.fx };
    }
    if (action.type === 'predict') {
      const p = s.players[action.player];
      p.oddEvenUsed = true; p.guess = action.guess;
      log(ctx, `🔮 ${p.name}: 次の合計は「${action.guess === 'odd' ? '奇数' : '偶数'}」と予想`);
      return { state: s, effects: ctx.fx };
    }
    if (action.type === 'useSkill') {
      const p = s.players[action.player], sk = charOf(p).skill;
      s.phase = 'busy'; s.canCard = false; p.charge = 0;
      log(ctx, `✨ ${p.name}: スキル「${sk.title}」発動！`);
      fx(ctx, { t: 'splash', kind: 'skill', img: charOf(p).skillImg, title: sk.title }, true);
      push(s, { k: 'skill', p: action.player, at: 'turnStart' }, { k: 'resumeRoll' });
    }
    if (action.type === 'useCard') {
      const p = s.players[action.player];
      const card = p.hand.splice(action.idx, 1)[0];
      s.phase = 'busy'; s.canCard = false;
      fx(ctx, { t: 'sync' }, true);
      push(s, { k: 'event', p: action.player, card });
    }
    if (action.type === 'roll') doRoll(ctx, action);
    if (action.type === 'choose') doChoose(ctx, action);
    chargeByAssets(ctx);
    run(ctx);
    return { state: s, effects: ctx.fx };
  }
  function validate(s, a) {
    if (!a || !a.type) return '不正な行動';
    if (a.type === 'debug') return null;
    if (s.winner) return 'ゲームは終了しています';
    if (a.type === 'debugSet') {
      if (!s.debug) return 'DEBUGモードではありません';
      if (s.pending || s.phase !== 'roll') return '処理中は変更できません';
      if (!['prop', 'tourist'].includes(def(a.id) && def(a.id).type)) return '物件・観光地のみ変更できます';
      return null;
    }
    if (a.type === 'useSkill') {
      if (s.pending || s.phase !== 'roll') return 'いまはスキルを使えません';
      if (a.player !== s.current) return '手番ではありません';
      if (!s.canCard) return 'スキルかカードは、ターンの最初（サイコロ前）にどちらか1つだけ使えます';
      if (s.players[a.player].charge < 100) return 'スキルゲージが溜まっていません';
      return null;
    }
    if (a.type === 'useCard') {
      if (s.pending || s.phase !== 'roll') return 'いまはカードを使えません';
      if (a.player !== s.current) return '手番ではありません';
      if (!s.canCard) return 'スキルかカードは、ターンの最初（サイコロ前）にどちらか1つだけ使えます';
      const h = s.players[a.player].hand;
      if (!Number.isInteger(a.idx) || a.idx < 0 || a.idx >= h.length) return 'そのカードはありません';
      if (C().EVENTS[h[a.idx]].passive) return 'このカードは持っているだけで効きます（使えません）';
      return null;
    }
    if (a.type === 'roll' || a.type === 'predict') {
      if (s.pending || s.phase !== 'roll') return 'いまはサイコロを振れません';
      if (a.player !== s.current) return '手番ではありません';
      if (a.type === 'predict' && (s.players[a.player].oddEvenUsed || !['odd', 'even'].includes(a.guess))) return '予想はできません';
      return null;
    }
    if (a.type === 'choose') {
      const pd = s.pending;
      if (!pd) return '選択待ちではありません';
      if (a.player !== pd.player) return 'あなたの選択ではありません';
      if (pd.kind === 'buy') {
        if (a.value === 0 || a.value == null) return null;
        const o = pd.options.find((x) => x.value === a.value);
        return o && o.ok ? null : 'その選択肢は選べません';
      }
      if (pd.kind === 'sell') return a.value === 'bankrupt' || pd.options.some((x) => x.value === a.value) ? null : 'その選択肢は選べません';
      return pd.options.includes(a.value) ? null : 'その選択肢は選べません';
    }
    return '不明な行動';
  }
  function doRoll(ctx, a) {
    const s = ctx.s, pi = a.player, p = s.players[pi], K = C(), B = K.BALANCE;
    s.phase = 'busy'; s.canCard = false;
    if (p.bankrupt) { push(s, { k: 'endTurn' }); return; }
    const gauge = Math.max(0, Math.min(1, Number(a.gauge) || 0));
    let forced = s.debug ? a.forced : null;
    let dice = null;
    if (p.fx.fixedRoll) {
      // 乱数の支配者：合計だけ確定。組み合わせはランダム（ゾロ目になることもある）
      const n = p.fx.fixedRoll; p.fx.fixedRoll = 0; forced = n;
      const lo = Math.max(1, n - 6), hi = Math.min(6, n - 1), d1 = randInt(s, lo, hi);
      dice = [d1, n - d1];
      log(ctx, `🎲 ${p.name}: 乱数の支配者！目は${n}で確定`);
    }
    const [v1, v2] = dice || rollDice(s, pi, gauge, forced);
    const blur = 0;
    const total = Math.max(1, v1 + v2 + blur);
    fx(ctx, { t: 'dice', p: pi, v1, v2, total, blur, gauge, dbl: v1 === v2 ? p.doubleStreak + 1 : 0 });
    log(ctx, `${p.name}: 🎲 ${v1}+${v2}=${v1 + v2}${blur ? ` → ブレ${blur > 0 ? '+' : ''}${blur}＝${total}` : ''}`);
    if (p.guess) {
      const hit = (p.guess === 'odd') === ((v1 + v2) % 2 === 1);
      log(ctx, hit ? '🎯 予想的中！' : '😢 予想はずれ…');
      banner(ctx, hit ? '予想的中！' : '予想はずれ…', '', hit ? 'good' : 'bad', pi);
      if (hit && B.oddEvenBonus) addMoney(ctx, pi, B.oddEvenBonus);
      p.guess = null;
    }
    if (p.fx.gamerLeft > 0 || p.fx.gamerOn) {
      // ゲーマーの意地：ゾロ目は関係なく、決まった回数だけ動く
      if (!p.fx.gamerOn) { p.fx.gamerOn = true; banner(ctx, 'ゲーマーの意地！', `${p.fx.gamerLeft}回連続移動スタート`, 'skill', pi); }
      p.fx.gamerLeft--;
      p.doubleStreak = 0; s.reroll = false;
    } else if (v1 === v2) {
      p.doubleStreak++;
      if (p.doubleStreak >= B.doublesToJail) {
        p.doubleStreak = 0; s.reroll = false;
        p.pos = K.ISLAND_ID; p.skip = summerGuard(ctx, pi) ? 0 : 1;
        log(ctx, `${p.name}: ${B.doublesToJail}連続ゾロ目！${K.BOARD[K.ISLAND_ID].name}送り🏝`);
        fx(ctx, { t: 'rest', p: pi, why: `${B.doublesToJail}連続ゾロ目` });
        fx(ctx, { t: 'pos', p: pi }, true);
        push(s, { k: 'endTurn' });
        return;
      }
      s.reroll = true;
    } else { p.doubleStreak = 0; s.reroll = false; }
    push(s, { k: 'step', p: pi, n: total, dbl: v1 === v2 });
  }
  function doChoose(ctx, a) {
    const s = ctx.s, pd = s.pending, pi = pd.player, p = s.players[pi];
    s.pending = null;
    const v = a.value;
    switch (pd.kind) {
      case 'buy':
        if (v) applyBuy(ctx, pi, pd.cell, pd.mode, v);
        else delete s.cells[pd.cell].boostFor; // 買わなかったら2倍の権利は消える
        return;
      case 'sell':
        if (v === 'bankrupt') { bankrupt(ctx, pi); return; }
        {
          const price = sellPrice(s, v);
          addMoney(ctx, pi, price);
          setCell(ctx, v, -1, 0, { noSkill: true });
          log(ctx, `${p.name}:「${def(v).name}」売却 +${price}M`);
          push(s, { k: 'solvency', p: pi });
        }
        return;
      case 'cell':
        if (pd.purpose === 'travel' || pd.purpose === 'warp') {
          log(ctx, `${p.name}: ✈️ ${def(v).name}へ！`);
          fx(ctx, { t: 'warp', p: pi, to: v });
          push(s, { k: 'walk', p: pi, to: v, land: true, visit: !!(pd.data && pd.data.visit) });
        } else if (pd.purpose === 'insure') {
          s.cells[v].insured = { owner: pi, rate: C().EVENTS.find((e) => e.id === 'kasaihoken').rate };
          fx(ctx, { t: 'cell', id: v }, true);
          log(ctx, `🧯 ${p.name}:「${def(v).name}」に火災保険をかけた`);
          banner(ctx, '火災保険に加入！', `「${def(v).name}」がなくなったら購入金額の5倍が戻る`, 'good', pi);
          push(s, { k: pd.data && pd.data.card ? 'resumeRoll' : 'endTurn' });
        } else if (pd.purpose === 'ransuu') {
          const d = (v - p.pos + C().BOARD.length) % C().BOARD.length;
          p.fx.fixedRoll = d;
          log(ctx, `🎲 ${p.name}: 乱数の支配者！次のサイコロは${d}（「${def(v).name}」）で確定`);
          banner(ctx, '乱数の支配者！', `次のサイコロは ${d} で確定`, 'skill', pi);
        } else if (pd.purpose === 'shuuden') {
          p.skip = summerGuard(ctx, pi) ? 0 : 1; s.reroll = false;
          log(ctx, `🚃 ${p.name}: 終電ダッシュ！「${def(v).name}」へ（次のターンは休み）`);
          fx(ctx, { t: 'warp', p: pi, to: v });
          push(s, { k: 'walk', p: pi, to: v, land: true });
        } else if (pd.purpose === 'gekirin') {
          banner(ctx, '設計課題のげきりん！', `「${def(v).name}」を破壊！`, 'rent', pi);
          push(s, { k: 'destroy', id: v, why: 'げきりん', thenBuy: pi }, { k: 'checkWin', p: pi });
        } else if (pd.purpose === 'enjou') {
          // 大炎上：燃えて → 同じ建物に作り直し → 通行料2倍（持ち主はそのまま）
          const c = s.cells[v];
          fx(ctx, { t: 'shake', id: v });
          c.mul = (c.mul > 1 ? c.mul : 1) * 2;
          log(ctx, `🔥 ${p.name}: 大炎上！「${def(v).name}」が燃えて作り直し → 通行料${c.mul}倍`);
          banner(ctx, '大炎上！', `「${def(v).name}」を作り直して通行料${c.mul}倍！`, 'gold', pi);
          fx(ctx, { t: 'cell', id: v }, true);
        } else if (pd.purpose === 'burn') {
          banner(ctx, '上から失礼します！', `「${def(v).name}」が焼滅…`, 'rent', pi);
          push(s, { k: 'destroy', id: v, why: '上から失礼します' }, { k: 'checkWin', p: pi });
        } else if (pd.purpose.startsWith('ch')) {
          chanceChoose(ctx, pd, v);
        } else if (pd.purpose === 'quake') {
          push(s, { k: 'destroy', id: v, why: '地震' }, { k: 'endTurn' });
        } else if (pd.purpose === 'evTravel') {
          const vi = pd.data.v;
          log(ctx, `${p.name}: 完全週休二日制旅行 → ${def(v).name}`);
          fx(ctx, { t: 'warp', p: pi, to: v }); if (vi !== pi) fx(ctx, { t: 'warp', p: vi, to: v });
          if (pd.data.card) push(s, { k: 'walk', p: pi, to: v }, { k: 'walk', p: vi, to: v }, { k: 'evTravelRent', p: pi, v: vi }, { k: 'land', p: pi, visit: true }, { k: 'resumeRoll' });
          else push(s, { k: 'walk', p: pi, to: v }, { k: 'walk', p: vi, to: v }, { k: 'evTravelRent', p: pi, v: vi }, { k: 'land', p: pi });
        }
        return;
      case 'pickCard': {
        const from = s.players[pd.data.from], idx = from.hand.indexOf(pd.data.cards[v]);
        if (idx >= 0) {
          const card = from.hand.splice(idx, 1)[0];
          addCard(ctx, pi, card);
          log(ctx, `🍞 ${p.name}: ${from.name}からカードを1枚もらった`);
          banner(ctx, 'お前のパンは俺のもの！', `${from.name}のカードを1枚いただき`, 'skill', pi);
          fx(ctx, { t: 'sync' }, true);
        }
        return;
      }
      case 'player':
        if (pd.purpose === 'zettaireido') zettaireido(ctx, pi, v, pd.data && pd.data.skillOf);
        else if (pd.purpose === 'panSteal') {
          const hand = s.players[v].hand;
          setPending(s, { kind: 'pickCard', player: pi, options: hand.map((_, i) => i), data: { from: v, cards: hand.slice() }, title: `🍞 ${s.players[v].name}の手札から1枚もらう` });
        } else if (pd.purpose === 'oosimaka') {
          const op = s.players[v], skOf = op.char;
          log(ctx, `💜 ${p.name}: ${op.name}のスキル「${C().CHARACTERS[skOf].skill.title}」を使う！`);
          fx(ctx, { t: 'splash', kind: 'skill', img: C().CHARACTERS[skOf].skillImg, title: C().CHARACTERS[skOf].skill.title }, true);
          s.queue.push({ k: 'skill', p: pi, at: 'turnStart', skillOf: skOf });
        }
        return;
      case 'pickEvent': {
        addCard(ctx, pi, v, '研究棟でカードを1枚選んだ');
        return;
      }
      case 'gamer': {
        const sk = pd.data && pd.data.skillOf ? C().CHARACTERS[pd.data.skillOf].skill : charOf(p).skill;
        const ch = sk.choices.find((c) => c.id === v);
        p.fx.gamerRate = sk.stealRate;
        if (v === 'combo') {
          if (pd.data && pd.data.at === 'turnStart') { p.fx.gamerLeft = sk.moves; banner(ctx, '🎮 3回連続移動！', `このターン ${sk.moves}回続けて動ける！`, 'skill', pi); }
          else { p.fx.gamerNext = true; banner(ctx, '🎮 3回連続移動！', `次のターン ${sk.moves}回続けて動ける！`, 'skill', pi); }
        } else {
          startLap(p, { steal: 'overtake', steady: 'steady', mega: 'megaBuy' }[v]);
          banner(ctx, `🎮 ${ch.label}！`, ch.desc, 'skill', pi);
        }
        log(ctx, `🎮 ${p.name}: ゲーマーの意地 →「${ch.label}」`);
        return;
      }
      case 'roof': {
        fx(ctx, { t: 'flash' });
        if (v === 'black' && p.fx.noBankrupt) {
          log(ctx, `${p.name}: 屋根→黒…でも、あの夏は終わらない！所持金は無事☀️`);
          banner(ctx, '黒を選んだ！', 'あの夏は終わらない！所持金は無事', 'good', pi);
          push(s, { k: pd.card ? 'resumeRoll' : 'endTurn' });
        } else if (v === 'black') {
          log(ctx, `${p.name}: 屋根→黒 所持金${p.money}M消滅💀`);
          banner(ctx, '黒を選んだ！', `所持金 ${p.money.toLocaleString()}M が消滅…`, 'bad', pi);
          addMoney(ctx, pi, -p.money);
          push(s, { k: 'solvency', p: pi }, { k: pd.card ? 'resumeRoll' : 'endTurn' });
        } else {
          log(ctx, `${p.name}: 屋根→グレー 全建物消滅🏚️`);
          banner(ctx, 'グレーを選んだ！', '所有する建物がすべて消滅…', 'bad', pi);
          if (!shieldBlock(ctx, pi, '建物')) ownedIds(s, pi).forEach((id) => setCell(ctx, id, -1, 0));
          push(s, { k: pd.card ? 'resumeRoll' : 'endTurn' });
        }
      }
    }
  }
  // さだ以外の全員が、その場で1回休み（移動はしない）
  function sendAllToIsland(ctx, pi) {
    const s = ctx.s;
    // まとめて1回の演出で全員1回休み（1人ずつは出さない）
    const ps = aliveOthers(s, pi).filter((oi) => !summerGuard(ctx, oi));
    ps.forEach((oi) => { s.players[oi].skip = 1; if (oi === s.current) s.reroll = false; }); // 手番の人はゾロ目の振り直しなし
    if (!ps.length) return;
    log(ctx, `📐 ${ps.map((oi) => s.players[oi].name).join('・')}: その場で1回休み`);
    fx(ctx, { t: 'restAll', ps, by: pi }, true);
  }
  // さだ「絶対零度」：結果は3通り（確率は CHARACTERS.さだ.skill.outcomes）
  //   sell：対象の物件をすべて半額で強制売却（代金は対象の所持金に入る）
  //   zero：対象の所持金を0に
  //   island：さだ以外の全員がその場で1回休み
  function zettaireido(ctx, pi, ti, skillOf) {
    // 絶対零度：①強制売却 → ②所持金0 → ③全員を設計課題（1回休み）の順に、それぞれ別々にくじを引く（全部当たりも全部ハズレもある）
    const s = ctx.s, sk = skillOf ? C().CHARACTERS[skillOf].skill : charOf(s.players[pi]).skill, tp = s.players[ti], o = sk.outcomes;
    const guard = tp.fx.noBankrupt;
    let hits = 0;
    // ① 物件をすべて半額で強制売却
    if (rand(s) < o.sell) {
      hits++;
      if (guard) { log(ctx, `❄️ ①強制売却…${tp.name}は「あの夏は終わらない」で無効☀️`); banner(ctx, '①強制売却 → 無効', `${tp.name}は あの夏の中`, 'bad', pi); }
      else {
        const props = ownedIds(s, ti).filter((id) => def(id).type === 'prop');
        let total = 0;
        props.forEach((id) => { total += Math.floor(invested(s, id) * sk.sellRate); setCell(ctx, id, -1, 0); });
        if (total) addMoney(ctx, ti, total, { noSkill: true });
        log(ctx, `❄️ ①アタリ！${tp.name}の物件${props.length}件を半額で強制売却（+${total}M）`);
        banner(ctx, '①強制売却 アタリ！', `${tp.name}の物件${props.length}件を半額で手放させた`, 'skill', pi);
      }
    } else { log(ctx, '❄️ ①強制売却…ハズレ'); banner(ctx, '①強制売却 ハズレ…', '', 'bad', pi); }
    // ② 所持金を0に
    if (rand(s) < o.zero) {
      hits++;
      if (guard) { log(ctx, `❄️ ②凍結…${tp.name}は「あの夏は終わらない」で無効☀️`); banner(ctx, '②凍結 → 無効', `${tp.name}は あの夏の中`, 'bad', pi); }
      else {
        const lost = Math.max(0, tp.money);
        addMoney(ctx, ti, -tp.money);
        log(ctx, `❄️ ②アタリ！${tp.name}の所持金${lost.toLocaleString()}Mを0に`);
        banner(ctx, '②凍結 アタリ！', `${tp.name}の所持金が0に`, 'skill', pi);
      }
    } else { log(ctx, '❄️ ②凍結…ハズレ'); banner(ctx, '②凍結 ハズレ…', '', 'bad', pi); }
    // ③ さだ以外の全員がその場で1回休み
    if (rand(s) < o.island) {
      hits++;
      log(ctx, '❄️ ③アタリ！さだ以外の全員がその場で1回休み');
      banner(ctx, '③全員1回休み アタリ！', 'さだ以外の全員がその場で1回休み', 'skill', pi);
      sendAllToIsland(ctx, pi);
    } else { log(ctx, '❄️ ③全員1回休み…ハズレ'); banner(ctx, '③全員1回休み ハズレ…', '', 'bad', pi); }
    if (hits === 3) banner(ctx, '絶対零度 パーフェクト!!', '3つ全部アタリ', 'gold', pi);
    else if (!hits) banner(ctx, '全部ハズレ…', '絶対零度は不発', 'bad', pi);
  }

  function run(ctx) {
    const s = ctx.s, max = C().BALANCE.maxStepsPerAction;
    while (!s.pending && !s.winner && s.queue.length) {
      if (++ctx.steps > max) {
        // 安全弁：想定外の連鎖が起きたら強制的に次のターンへ
        log(ctx, '⚠️ 処理が長すぎるため強制的にターンを終了しました');
        s.queue = []; s.reroll = false;
        H.endTurn(ctx);
        ctx.fx.push({ t: 'error', msg: 'step limit' });
        break;
      }
      const t = s.queue.pop();
      H[t.k](ctx, t);
      chargeByAssets(ctx);
    }
    if (!s.pending && !s.winner && !s.queue.length && s.phase === 'busy') {
      // ここに来るのはタスクが endTurn を積み忘れた時だけ（バグ検出用）
      ctx.fx.push({ t: 'error', msg: 'stalled' });
      H.endTurn(ctx);
    }
  }

  // いま誰が何をする番か
  function whoActs(s) {
    if (s.winner) return null;
    if (s.pending) return { player: s.pending.player, kind: s.pending.kind };
    if (s.phase === 'roll') return { player: s.current, kind: 'roll' };
    return null;
  }

  GR.engine = { newGame, dispatch, whoActs, rand };
  GR.rules = {
    def, invested, totalAssets, ranks, maxLv, buyCost, acquireCost, sellPrice, rent, rentFor, rarityMix, touristCost, stat, statVal, isMonopoly,
    monopolyColors, checkVictory, reaches, winTargets, reachCells, ownedIds,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
