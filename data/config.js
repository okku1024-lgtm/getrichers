// =====================================================================
// ゲットリッチ復活 v2 — 設定表
// ここには「数値・名前・マスの並び」だけを書く。ルールの処理は rules/engine.js。
// バランス調整は基本的にこのファイルの数字を書き換えるだけで済む。
// =====================================================================
(function (root) {
  const ASSET = 'assets/';

  // ---------- バランス値 ----------
  const BALANCE = {
    startMoney: 1500,        // 初期所持金
    salary: 500,             // スタート通過ボーナス
    maxTurns: 20,            // このターンを超えたら総資産で勝敗
    insolventAt: 0,          // 所持金がこの値以下になったら判定（ちょうど0なら売却不要。マイナスの時だけ売却/破産）
    sellRate: 0.75,          // 売却価格＝投資額×この値
    acquireRate: 2,          // 買収価格＝投資額×この値
    // 勝利条件：colors色を完全独占／辺の物件・観光地のうち lineMiss 個まで欠けていてもライン独占／観光地を tourists か所でも独占
    win: { colors: 3, lineMiss: 0, tourists: 4 }, // 元祖ゲットリッチと同じ：ライン独占＝辺をすべて購入／観光地独占＝観光地すべて（ここは変えない）
    touristToll: 50,         // 観光地の通行料
    priceMul: 2,             // 購入金額の基本倍率（物件・観光地の価格。2＝元の2倍）
    rentMul: 2,              // 通行料の基本倍率（物件の rent と観光地の通行料すべてに掛かる。2＝元の2倍）
    doublesToJail: 3,        // ゾロ目この回数連続で設計課題送り
    edgeReroll: 0.6,         // 合計2・12（必ずゾロ目）が出た時に振り直す確率
    cpuDiceExtra: 2, // CPUだけサイコロのブレ幅を足す（2 = さらに±1ずれる）
    doubleWeight: 0.4,       // ゾロ目の出やすさ（同じ合計になる組み合わせの中での重み。1=本物のサイコロと同じ）
    lapForLevel: { 1: 1, 2: 2, 3: 3 }, // 周回数→建てられる最大レベル
    oddEvenBonus: 0,         // 奇数偶数予想が当たった時のボーナス（0=ログのみ）

    // スキルゲージ：総資産（所持金＋不動産の価値）の何割を失ったかで溜まる。100%で満タン（不動産の購入は除く）
    //   例：総資産2000Mで200M払う → 1割 → +10%×rate。通行料・税金・建物の破壊・強制売却・略奪など
    //   満タンなら自分のターンの最初（サイコロ前）にボタンで使える（スキルはゲージで使うだけ）
    skillGauge: { rate: 4.8, early: 0.6, late: 1.8 }, // rate：溜まりやすさ（4.8なら総資産の1割で+48%）／early→late：1ターン目0.6倍から最終ターン1.8倍まで、終盤ほど溜まりやすい
    //   キャラごとの微調整は各スキルの gaugeRate（勝率をそろえるため。ふつうは1）
    // カード：スタートを通過するたびに1枚。スタートにぴったり止まったら手札の上限まで補充
    //   カードは自分のターンの最初に1枚使える（スキルとカードは1ターンにどちらか1つ）。捨てられない（使わないと減らない）
    //   overflow：手札がいっぱいの時に新しいカードが来たら…（ここを書き換えるだけで切り替わる）
    //     'fireOldest' ＝一番古いカードが自動で発動し、新しいカードが手札に入る
    //     'fireNew'    ＝手札はそのまま、新しく来たカードがその場で自動発動
    //     'dropOldest' ＝一番古いカードが捨てられ、新しいカードが手札に入る
    //     'block'      ＝新しいカードはもらえない
    gacha: { handMax: 3, overflow: 'fireOldest', fillOnStart: true },
    // カードの出やすさ：金・銀・銅（EVENTS の rank）。もらう人の総資産と「他の人の平均」の差で変わる
    //   差 ＝（自分の総資産 − 他の人の平均）÷ 他の人の平均。-gapFull 以下なら behind、+gapFull 以上なら ahead、0 なら even
    //   その間は直線でつなぐ。数字は「金・銀・銅のどれが出るか」の割合（合計1）。同じランクの中では同じ確率
    rarity: {
      gapFull: 0.8,
      behind: { gold: 0.40, silver: 0.40, bronze: 0.20 }, // 大きく負けている人
      even:   { gold: 0.20, silver: 0.45, bronze: 0.35 }, // 互角
      ahead:  { gold: 0.10, silver: 0.40, bronze: 0.50 }, // 大きく勝っている人
    },

    // ステータス（計画・設備・構造・材料）：1〜max の段階。キャラごとの初期値は CHARACTERS の stats
    //   科目マスに止まると studyOdds の確率で 落単（上がらない）／+1／+2。研究棟は全部+1（確実）
    //   効果は「1の時の値」→「maxの時の値」を直線でつなぐ
    stats: {
      max: 10,
      studyOdds: { fail: 0.25, plus1: 0.5, plus2: 0.25 }, // 科目マス：1/4で落単・2/4で+1・1/4で+2（合計1）
      // 計画：サイコロのブレ幅（狙った合計のまわり、この幅の中から均等に出る。11で完全ランダム、0でブレなし）
      //   table があれば段階ごとの値をそのまま使う（左から計画1,2,…,10）
      plan:   { at1: 7.5, atMax: 0, table: [7.5, 7.0, 6.0, 5.5, 5.0, 4.5, 3.5, 2.5, 1.5, 0] },
      equip:  { at1: 0.7, atMax: 1.6 },   // 設備：スキルゲージの溜まりやすさ（倍）
      struct: { at1: 0, atMax: 0.8 },     // 構造：自分のマスの通行料が高くなる（0.8＝構造10で1.8倍）
      mat:    { at1: 0, atMax: 0.4 },     // 材料：強いカードの出やすさ（金の出やすさ×(1+値)、銅×(1-値/2)）
    },
    genjitsukaOncePerLap: true, // さこう「具現化」は1周に1回だけ発動

    // 安全弁：1回の行動で処理するステップ数の上限（無限ループ防止）
    maxStepsPerAction: 2000,
  };

  // ---------- 演出時間（ミリ秒） ----------
  const TIMING = {
    step: 260,         // コマ1マス
    land: 220,         // 着地の間
    splash: 3000,      // スキル/イベント画像
    quakeSplash: 2500, // 地震画像
    quakeShake: 2000,  // 破壊対象の揺れ
    diceSpin: 1000,    // CPUのサイコロ回転
    diceDecel: 600,    // 人間のサイコロ減速
    diceToss: 1000,    // ゲージを止めた後、サイコロが跳ね上がって落ちるまで
    gaugeSpeed: 0.0162, // ゲージの速さ（1フレームに回る割合。狙って止められる速さ）
    afterDice: 600,   // 出目表示からコマが動くまで
    cpuThink: 1000,    // CPUのターン開始までの間
    cpuChoice: 500,    // CPUが選択肢を選ぶまでの間
    flash: 1200,       // 屋根イベントの発光
  };

  // ---------- 色 ----------
  const COLOR_HEX = { brown: '#8B6347', lightblue: '#5DAEF0', pink: '#D44E9E', orange: '#E8832A', red: '#E03B3B', yellow: '#D4B800', green: '#2E9E55' };
  const COLOR_NAME = { brown: '茶', lightblue: '水色', pink: 'ピンク', orange: 'オレンジ', red: '赤', yellow: '黄', green: '緑' };

  // ---------- ボード（24マス＝1辺5マス＋角4つ、id=並び順）。各辺は「不動産2・科目マス・不動産2」。税金マスはなし ----------
  //   マス名は名城大・名古屋ゆかりの場所（暫定）。安い順に：大学の近所 → 八事・平針 → 学食・油そば → 大須 → 栄 → 金山・名駅 → 名城公園・名古屋城。色はすべて2マス
  const BOARD = [
    { id: 0, type: 'start', name: 'START', sub: '+500M' },
    { id: 1, type: 'prop', name: '塩釜口', color: 'brown', prices: [60, 40, 60, 120], rent: [2, 10, 30, 90] },
    { id: 2, type: 'prop', name: '植田', color: 'brown', prices: [60, 40, 60, 120], rent: [4, 20, 60, 180] },
    { id: 3, type: 'study', stat: 'plan', name: '計画', sub: '単位で+1' },
    { id: 4, type: 'tourist', name: '照葉樹林', price: 150 },
    { id: 5, type: 'prop', name: '八事', color: 'lightblue', prices: [100, 60, 80, 160], rent: [6, 30, 90, 270] },
    { id: 6, type: 'island', name: '設計課題', sub: '1回休み' },
    { id: 7, type: 'prop', name: '平針', color: 'lightblue', prices: [120, 70, 90, 180], rent: [8, 40, 100, 300] },
    { id: 8, type: 'prop', name: '学食', color: 'pink', prices: [140, 80, 100, 200], rent: [10, 50, 150, 450] },
    { id: 9, type: 'study', stat: 'equip', name: '設備', sub: '単位で+1' },
    { id: 10, type: 'prop', name: '油そば', color: 'pink', prices: [160, 90, 120, 220], rent: [12, 60, 180, 500] },
    { id: 11, type: 'tourist', name: '東山動植物園', price: 150 },
    { id: 12, type: 'lab', name: '研究棟', sub: '全ステータス+1' },
    { id: 13, type: 'prop', name: '上前津', color: 'orange', prices: [180, 100, 140, 260], rent: [14, 70, 200, 550] },
    { id: 14, type: 'prop', name: '大須商店街', color: 'orange', prices: [180, 100, 140, 260], rent: [14, 70, 200, 550] },
    { id: 15, type: 'study', stat: 'struct', name: '構造', sub: '単位で+1' },
    { id: 16, type: 'tourist', name: 'テレビ塔', price: 150 },
    { id: 17, type: 'prop', name: '栄', color: 'red', prices: [220, 120, 160, 300], rent: [18, 90, 250, 700] },
    { id: 18, type: 'travel', name: '敷地調査', sub: '移動先選択' },
    { id: 19, type: 'prop', name: '金山', color: 'red', prices: [220, 120, 160, 300], rent: [18, 90, 250, 700] },
    { id: 20, type: 'tourist', name: 'ナゴヤドーム', price: 150 },
    { id: 21, type: 'study', stat: 'mat', name: '材料', sub: '単位で+1' },
    { id: 22, type: 'prop', name: '名城公園', color: 'green', prices: [300, 160, 220, 400], rent: [26, 130, 390, 900] },
    { id: 23, type: 'prop', name: '名古屋城', color: 'green', prices: [300, 160, 220, 400], rent: [26, 130, 390, 900] },
  ];
  // rent: [未建築(独占時×2), 住宅, 公共施設, ランドマーク]。ランドマークは rent[3]×2
  const CORNERS = [0, 6, 12, 18];
  const ISLAND_ID = 6;
  const LINES = { bottom: [1, 2, 4, 5], left: [7, 8, 10, 11], top: [13, 14, 16, 17], right: [19, 20, 22, 23] };
  const LINE_NAMES = { bottom: 'ボトム辺', left: '左辺', top: 'トップ辺', right: '右辺' };
  // 購入金額の倍率：BALANCE.priceMul（2＝元の2倍）。物件の価格・観光地の価格すべてに掛ける（売却・買収も連動）
  BOARD.forEach((d) => { const m = BALANCE.priceMul || 1; if (d.prices) d.prices = d.prices.map((x) => x * m); if (d.price) d.price *= m; });
  const TOURIST_IDS = [4, 11, 16, 20];
  const LEVEL_NAMES = ['なし', '住宅', '公共施設', 'ランドマーク'];

  // ---------- キャラクター ----------
  // stats：ステータスの初期値（1〜10）。plan=計画 / equip=設備 / struct=構造 / mat=材料
  const CHARACTERS = {
    'さこう': {
      color: '#2E9E55', img: ASSET + 'char_sakou.jpg', pin: ASSET + 'pin_sakou.webp', skillImg: ASSET + 'skill_sakou_s.png',
      stats: { plan: 3, equip: 4, struct: 3, mat: 5 },
      skill: { id: 'genjitsuka', title: '具現化', desc: '1周の間スタンバイ。所持金が0以下になったらその支払いを帳消しにし、全員から50%を奪い、建物・観光地のあるマスからランダムに3マスを建物ごと自分のものにする（自分のマスが選ばれることもある）', stealRate: 0.5, takeCells: 3, threshold: 0, gaugeRate: 0.25 },
    },
    'さだ': {
      color: '#378ADD', img: ASSET + 'char_sada.jpg', pin: ASSET + 'pin_sada.webp', skillImg: ASSET + 'skill_sada_s.png',
      stats: { plan: 4, equip: 4, struct: 7, mat: 3 },
      skill: { id: 'zettaireido', title: '絶対零度', desc: '相手1人に3つのくじを順に引く。①15% 物件をすべて強制売却（代金は相手へ） ②30% 所持金を0に ③60% さだ以外の全員が400Mをさだに払い「スチノリハウスに捕まった!!」を手札に加える', outcomes: { sell: 0.15, zero: 0.30, stinori: 0.60 }, sellRate: 1.0, stinoriPay: 400, gaugeRate: 1.1 },
    },
    'すぎうら': {
      color: '#E24B4A', img: ASSET + 'char_sugiura.jpg', pin: ASSET + 'pin_sugiura.webp', skillImg: ASSET + 'skill_sugiura_s.png',
      stats: { plan: 5, equip: 6, struct: 3, mat: 4 },
      skill: { id: 'gamer', title: 'ゲーマーの意地', desc: '4つから選ぶ。①3回連続移動（通行料なし）②1周の間 追い越し略奪 ③1周の間 狙い通りの目 ④1周の間 なんでも買収', moves: 3, stealRate: 0.2, gaugeRate: 2.0,
        choices: [
          { id: 'combo', label: '3回連続移動', icon: '🏃', desc: 'このターン3回続けて動ける。通行料なし' },
          { id: 'steal', label: '追い越し略奪', icon: '💰', desc: '1周する間、追い越した相手の所持金20%を奪う' },
          { id: 'steady', label: '狙い通りの目', icon: '🎯', desc: '1周する間、サイコロのブレなし' },
          { id: 'mega', label: 'なんでも買収', icon: '🏰', desc: '1周する間、他人のどんなマスでも通行料なし・購入金額のみで買える' },
        ] },
    },
    'おくだ': {
      color: '#D4B800', img: ASSET + 'char_okuda.jpg', pin: ASSET + 'pin_okuda.webp', skillImg: ASSET + 'skill_okuda_s.png',
      stats: { plan: 6, equip: 4, struct: 5, mat: 4 },
      skill: { id: 'tabidachi', title: '突然の旅立ち', desc: '銀行から旅費+1000Mをもらい、角以外の好きなマスへワープ。ターンの最初に使えば、そのあとサイコロも振れる', bankGain: 1000, gaugeRate: 0.325 },
    },
  };
  const CHAR_ORDER = ['さこう', 'さだ', 'すぎうら', 'おくだ'];
  // ステータスの名前と説明（画面・ルールブック用）
  const STAT_DEFS = [
    { key: 'plan', name: '計画', icon: '📐', desc: 'サイコロが狙い通りに出やすくなる' },
    { key: 'equip', name: '設備', icon: '🔌', desc: 'スキルゲージが溜まりやすくなる' },
    { key: 'struct', name: '構造', icon: '🏗', desc: '自分のマスの通行料が高くなる' },
    { key: 'mat', name: '材料', icon: '🧱', desc: '強いイベントカードが出やすくなる' },
  ];

  // ---------- キャラのアニメ（assets/anim/ の横長コマ画像。tools/build_sprites.py で作成） ----------
  // 状態: idle=待機（ループ） / move=移動（ループ） / happy=喜ぶ / sad=悲しむ（最後のコマで止まる）
  const SPRITES = {
    'さこう': {
      idle: { src: ASSET + 'anim/sakou_idle.webp', n: 4, w: 178, h: 192, ms: 1600, loop: true },
      move: { src: ASSET + 'anim/sakou_move.webp', n: 4, w: 179, h: 192, ms: 520, loop: true },
      happy: { src: ASSET + 'anim/sakou_happy.webp', n: 4, w: 179, h: 192, ms: 900, loop: false },
      sad: { src: ASSET + 'anim/sakou_sad.webp', n: 4, w: 178, h: 192, ms: 1000, loop: false },
    },
    'さだ': {
      idle: { src: ASSET + 'anim/sada_idle.webp', n: 4, w: 172, h: 192, ms: 1600, loop: true },
      move: { src: ASSET + 'anim/sada_move.webp', n: 4, w: 173, h: 192, ms: 520, loop: true },
      happy: { src: ASSET + 'anim/sada_happy.webp', n: 4, w: 173, h: 192, ms: 900, loop: false },
      sad: { src: ASSET + 'anim/sada_sad.webp', n: 4, w: 172, h: 192, ms: 1000, loop: false },
    },
    'すぎうら': {
      idle: { src: ASSET + 'anim/sugiura_idle.webp', n: 4, w: 181, h: 192, ms: 1600, loop: true },
      move: { src: ASSET + 'anim/sugiura_move.webp', n: 4, w: 181, h: 192, ms: 520, loop: true },
      happy: { src: ASSET + 'anim/sugiura_happy.webp', n: 4, w: 181, h: 192, ms: 900, loop: false },
      sad: { src: ASSET + 'anim/sugiura_sad.webp', n: 4, w: 181, h: 192, ms: 1000, loop: false },
    },
    'おくだ': {
      idle: { src: ASSET + 'anim/okuda_idle.webp', n: 28, w: 171, h: 192, ms: 3360, loop: true },
      move: { src: ASSET + 'anim/okuda_move.webp', n: 28, w: 171, h: 192, ms: 1680, loop: true },
      happy: { src: ASSET + 'anim/okuda_happy.webp', n: 28, w: 171, h: 192, ms: 1400, loop: false },
      sad: { src: ASSET + 'anim/okuda_sad.webp', n: 28, w: 171, h: 192, ms: 1600, loop: false },
    },
  };


  // ---------- チャンスイベント ----------
  const EVENTS = [
    { id: 'travel', rank: 'gold', desc: 'さだが所持金の30%を払い、自分とさだで好きなマスへ旅行。さだはそこで通行料を払う', name: '完全週休二日制旅行', icon: '🏖️', img: ASSET + 'event_travel.jpg?v=2', victim: 'さだ', costRate: 0.3 },
    { id: 'glass', rank: 'bronze', desc: '照葉樹林が自分のものになる。おくだが所持金の30%を払う', name: '照葉樹林グラスを破壊', icon: '🥃', img: ASSET + 'event_glass.jpg?v=2', victim: 'おくだ', costRate: 0.3, cellName: '照葉樹林' },
    { id: 'roof', rank: 'bronze', desc: '屋根の色を選ぶ。黒＝所持金が消滅／グレー＝建物がすべて消滅', name: '屋根の色は黒orグレー', icon: '🏚️', img: ASSET + 'event_roof.jpg?v=2' },
    { id: 'typhoon', rank: 'silver', desc: '1周する間、通り越した（同じマスを通った）相手から、所持金とスキルゲージの1/4を奪って自分のものにする', name: '富の台風18号', icon: '🌀', img: ASSET + 'event_typhoon.jpg?v=2', stealRate: 0.25, gaugeRate: 0.25 },
    { id: 'tossatu', rank: 'bronze', desc: 'すぎうらがその場で1回休み', name: '盗撮ダメ絶対', icon: '📷', img: ASSET + 'event_tossatu.jpg?v=2', victim: 'すぎうら' },
    { id: 'gekirin', rank: 'gold', desc: '建物のある相手のマス（物件・観光地）を1つ選んで壊す。そのあと購入でき（代金は銀行へ）、買い直したマスは通行料がずっと2倍（重ねると4倍・8倍…）', name: '設計課題のげきりん', icon: '🐻', img: ASSET + 'event_gekirin.jpg?v=2' },
    { id: 'summer', rank: 'silver', desc: '持っているだけで効く（使うことはできない）。1回休みになりそうな時、自動で発動して1回休みをなかったことにする（発動したらカードはなくなる）', name: 'あの夏は終わらない', icon: '☀️', img: ASSET + 'event_summer.jpg?v=3', passive: true },
    // ↓ 追加カード（画像は assets/event_*.jpg）
    { id: 'kasaihoken', rank: 'silver', desc: '持っているだけで効く（使うことはできない）。自分の建物が壊されそうな時（げきりん・上から失礼します・屋根グレー）、自動で発動して守る。守った時にさこうへ所持金の15%を払う（発動したらカードはなくなる）', name: '火災保険募集人の営業', icon: '🧯', img: ASSET + 'event_kasaihoken.jpg?v=2', payee: 'さこう', costRate: 0.15, passive: true },
    { id: 'mousugutsuku', rank: 'bronze', desc: 'さだは、すぎうらに追いつかれるまでそのマスで待機。追いついた時、すぎうらはさだに所持金の30%を払う', name: 'もうすぐ着く', icon: '🛏', img: ASSET + 'event_mousugutsuku.jpg?v=2', waiter: 'さだ', catcher: 'すぎうら', payRate: 0.3 },
    { id: 'pandorobou', rank: 'silver', desc: '相手の手札を見て、1枚もらう', name: 'お前のパンは俺のもの', icon: '🍞', img: ASSET + 'event_pandorobou.jpg?v=2' },
    { id: 'oosimaka', rank: 'gold', desc: 'スキルゲージが溜まっているプレイヤーを選び、その人のスキルを使う', name: '6vおおしまか', icon: '💜', img: ASSET + 'event_oosimaka.jpg?v=2' },
    { id: 'ransuu', rank: 'silver', desc: '1周する間、サイコロのブレがなくなる。ゲージで狙った目がそのまま出る', name: '乱数の支配者', icon: '🎲', img: ASSET + 'event_ransuu.jpg?v=2', spreadMul: 0 },
    { id: 'uekarashitsurei', rank: 'silver', desc: '不動産を1つ選び、焼滅させる', name: '上から失礼します', icon: '🪂', img: ASSET + 'event_uekarashitsurei.jpg?v=2' },
    { id: 'fumine', rank: 'gold', desc: '持っているだけで効く（使うことはできない）。総資産の半分を超えるお金を一度に失いそうになった時、自動で発動してその損をなかったことにし、さらに+1000M（発動したらカードはなくなる）', name: 'ふみねの加護', icon: '😇', img: ASSET + 'event_fumine.jpg?v=2', passive: true, lossFrac: 0.5, bonus: 1000 },
    { id: 'shuudendash', rank: 'silver', desc: '1〜5マス先の好きなマスへ移動して、そのマスの処理をする（このターンはサイコロを振らない）。次のターンは休み', name: '終電ダッシュ', icon: '🚃', img: ASSET + 'event_shuudendash.jpg?v=2', range: 5 },
    { id: 'stinori', rank: 'bronze', desc: '自分がスチノリハウスに捕まり1回休み', name: 'スチノリハウスに捕まった!!', icon: '🏠', img: ASSET + 'event_stinori.jpg?v=2' },
    { id: 'daienjou', rank: 'silver', desc: '自分の建物を1つ選ぶ。一度燃えて同じ建物に作り直され、そのマスの通行料がずっと2倍（重ねると4倍・8倍…）', name: '大炎上', icon: '🔥', img: ASSET + 'event_daienjou.jpg?v=3' },
    { id: 'puruta', rank: 'silver', desc: '持っているだけで効く（使うことはできない）。他の人がゾロ目で動いている時、自分のいるマスを通ろうとしたら巨体で通せんぼ。その人はそのマスで止まり、ゾロ目の振り直しもなし（発動したらカードはなくなる）', name: 'プルタ参戦', icon: '🧍', img: ASSET + 'event_puruta.jpg?v=1', passive: true },
  ];

  // ---------- チャンスマス（本家ゲットリッチのチャンスカード風） ----------
  // 止まると、この中から1つがランダムで起きる。weight＝出やすさ（大きいほど出る。0で出ない）
  // id は効果の種類（rules/engine.js の H.chance）。名前・説明・数字・出やすさは自由に変えてOK
  //   tone：演出の色（good=得 / bad=損 / skill=相手に仕掛ける / info=その他）
  const CHANCES = [
    { id: 'angel', name: '天使の加護', icon: '😇', desc: '次に払う通行料1回が無料', weight: 1, tone: 'good' },
    { id: 'coupon', name: '半額クーポン', icon: '🎟', desc: '次に払う通行料1回が半額', weight: 1, tone: 'good' },
    { id: 'worldcup', name: 'ワールドカップ開催', icon: '🏆', desc: '自分の物件1つの通行料が、次に誰かが止まるまで2倍', weight: 1, tone: 'good' },
    { id: 'travel', name: '世界旅行', icon: '🌍', desc: '好きなマス（買えるマス）へ移動する', weight: 1, tone: 'good' },
    { id: 'bonus', name: '臨時ボーナス', icon: '🎁', desc: '+300M', amount: 300, weight: 1, tone: 'good' },
    { id: 'swap', name: '都市交換', icon: '🔄', desc: '自分の物件1つと相手の物件1つを交換（ランドマークは対象外）', weight: 1, tone: 'skill' },
    { id: 'forceSell', name: '強制売却', icon: '💥', desc: '相手の物件1つを売却させる（ランドマークは対象外。売却額は持ち主へ）', weight: 1, tone: 'skill' },
    { id: 'sand', name: '黄砂', icon: '🌪', desc: '相手の物件1つの通行料が、次に誰かが止まるまで半額', weight: 1, tone: 'skill' },
    { id: 'buyLand', name: '土地買い付け', icon: '🏗', desc: '空いている物件・観光地を1つ選んで、その場で購入できる（物件は住宅付き）', weight: 1, tone: 'good' },
    { id: 'island', name: '強制送還', icon: '🏝', desc: '設計課題へ送られ1回休み', weight: 1, tone: 'bad' },
    { id: 'donate', name: '寄付', icon: '💸', desc: '所持金の10%を他の全員に分配', rate: 0.1, weight: 1, tone: 'bad' },
  ];

  const IMAGES = { quake: ASSET + 'quake.jpg', roof: ASSET + 'event_roof.jpg?v=2', background: ASSET + 'background.webp', title: ASSET + 'title_s.png?v=1' };
  // 四隅の特別なマスの絵（マスの種類 → 画像。背景が透明な切り抜き）
  const CORNER_IMG = { start: ASSET + 'masu_start_s.png?v=2', lab: ASSET + 'masu_kenkyuutou_s.png', island: ASSET + 'masu_sekkeikadai_s.png', travel: ASSET + 'masu_shikichichousa_s.png' };

  // ---------- キャラの演技（view/actors.js） ----------
  const ACTOR = {
    tokenH: 58,        // 盤上のコマの高さ(px)
    footShift: 0.32,   // 足元をマスの中心からどれだけ下げるか（コマの高さに対する割合）
    avaH: 78,          // パネルの立ち絵の高さ(px)
    hopMs: 150,        // 1マスのジャンプ時間（テンポ重視で0.15秒）
    hopHeight: 13,     // ジャンプの高さ(px)
    spotScale: 1.28,   // 手番の人の拡大率
    chars: {
      // mode: sheet=4コマ（止め絵＋まばたき） / strip=多コマ（そのまま再生）
      // hopFrames: 1ジャンプの間に使う移動コマの順番
      'さこう': { mode: 'sheet', idleBase: 0, blink: 2, hopFrames: [0, 1, 2, 3] },
      'さだ': { mode: 'sheet', idleBase: 0, blink: 2, hopFrames: [0, 1, 2, 3] },
      'すぎうら': { mode: 'sheet', idleBase: 0, blink: 2, hopFrames: [0, 1, 2, 3] },
      'おくだ': { mode: 'strip', hopFrames: [0, 1, 2, 3, 4, 5, 6, 7] },
    },
  };

  const CONFIG = {
    BALANCE, TIMING, COLOR_HEX, COLOR_NAME, BOARD, CORNERS, ISLAND_ID, LINES, LINE_NAMES,
    TOURIST_IDS, LEVEL_NAMES, CHARACTERS, CHAR_ORDER, STAT_DEFS, EVENTS, CHANCES, IMAGES, CORNER_IMG, SPRITES, ACTOR,
  };
  root.GR = root.GR || {};
  root.GR.CONFIG = CONFIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
