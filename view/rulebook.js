// =====================================================================
// ゲットリッチ復活 v2 — ルールブック
// 数字やカードの中身は data/config.js から読み込むので、設定を変えても自動で最新になる
// =====================================================================
(function (root) {
  const GR = (root.GR = root.GR || {});
  const K = () => GR.CONFIG;
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function sections() {
    const C = K(), B = C.BALANCE, W = Object.assign({ colors: 3, lineMiss: 1, tourists: 3 }, B.win || {});
    const tax = C.BOARD.filter((d) => d.type === 'tax').map((d) => `${d.name}（${d.sub}）`).join('・');
    const tours = C.TOURIST_IDS.map((id) => C.BOARD[id].name).join('・');
    const lv = B.lapForLevel || { 1: 1, 2: 2, 3: 3 };
    const S = B.stats;
    const OVF = { fireOldest: '<b>一番古いカードが自動で発動</b>して、新しいカードが手札に入る', fireNew: '<b>新しいカードがその場で自動発動</b>する（手札はそのまま）', dropOldest: '<b>一番古いカードが捨てられ</b>、新しいカードが手札に入る', block: '新しいカードは<b>もらえない</b>' }[B.gacha.overflow || 'fireOldest'];
    return [
      { id: 'goal', icon: '🏆', title: 'ゲームの目的', html: `
        <p>名城大学 建築学科の4人が、<b>設計課題の模型づくり</b>で競うボードゲーム。盤面は名古屋の街。マス（敷地）を手に入れ、周回を重ねて白模型（住宅 → 公共施設 → ランドマーク）を建てていこう。</p>
        <p><b>${B.maxTurns}ターン</b>（講評会の日）が来た時に、<b>総資産（所持金＋物件の価値）が一番多い人</b>の勝ち。</p>
        <p>そのほかに、次の<b>独占</b>を達成するとその場で勝利！</p>
        <ul>
          <li>🟦 <b>ライン独占</b>：盤面の1辺の物件・観光地を${W.lineMiss ? `<b>あと${W.lineMiss}つ欠けていてもOK</b>で` : '<b>すべて</b>'}自分のものにする</li>
          <li>🗺 <b>観光地独占</b>：観光地（${esc(tours)}）を${W.tourists >= C.TOURIST_IDS.length ? '<b>すべて</b>' : `<b>${W.tourists}か所</b>`}持つ</li>
          <li>🎨 <b>トリプル独占</b>：同じ色の物件を<b>${W.colors}色</b>ぶん全部そろえる</li>
          <li>👑 ほかの全員が破産したら、生き残った人の勝ち</li>
        </ul>
        <p class="rb-tip">あと1つで独占の時は、パネルに「🔥リーチ」が出ます。自分の番には、取れば勝ちになるマスが光ります。</p>` },
      { id: 'turn', icon: '🎲', title: '1ターンの流れ', html: `
        <ol>
          <li><b>スキルかカードを使う（使わなくてもOK）</b><br>スキルゲージが満タンなら「✨スキル発動」、手札があればカードが盤面の左下に出ます。<b>使えるのはどちらか1つ</b>だけ。</li>
          <li><b>サイコロを振る</b><br>サイコロのまわりを光の玉が回っています。<b>盤面の真ん中をタップして、指を離した瞬間</b>に止まります（パソコンはスペースキーでも可）。12時の位置から時計回りに、<b>小さい目 → 大きい目</b>が出やすくなります。</li>
          <li><b>コマが進んで、止まったマスの処理</b><br>物件を買う・通行料を払う・科目マスで単位を取るなど。</li>
        </ol>
        <ul>
          <li>🎯 <b>ゾロ目</b>が出たら、もう一度振れる（${B.doublesToJail}回連続だと設計課題行き）</li>
          <li>🏁 <b>スタートを通過</b>すると +${B.salary}M と、<b>イベントカード1枚</b>（ぴったり止まると手札が上限まで埋まる）</li>
        </ul>` },
      { id: 'cells', icon: '🗺', title: 'マスの種類', html: `
        <table class="rb-table">
          <tr><th>🏠 物件</th><td>空き地なら購入できる。建てられる建物は周回数で増える（${lv[1] ? '1周目：住宅' : ''}／2周目〜：公共施設／3周目〜：ランドマーク）。建物が大きいほど通行料が高い。</td></tr>
          <tr><th>🗺 観光地</th><td>買うと、止まった人から通行料 ${B.touristToll}M。観光地独占の対象。</td></tr>
          <tr><th>📚 科目マス</th><td>計画・設備・構造・材料の4つ。止まると<b>1/4で落単</b>（上がらない）、<b>2/4で+1</b>、<b>1/4で+2</b>（優で単位取得）。</td></tr>
          ${tax ? `<tr><th>💸 税金</th><td>${esc(tax)} を支払う。</td></tr>` : ''}
          <tr><th>📐 設計課題</th><td>おくだが資料づくりに追われるマス。止まると1回休み。</td></tr>
          ${C.BOARD.some((d) => d.type === 'quake') ? '<tr><th>🌋 地震</th><td>好きな建物を1つ壊せる。</td></tr>' : ''}
          <tr><th>🏛 研究棟</th><td>四隅の特別なマス。止まると<b>全ステータスが+1</b>（落単なし。上限${S.max}）。</td></tr>
          <tr><th>🗺 敷地調査</th><td>好きなマスへ移動できる。</td></tr>
          <tr><th>🏁 スタート</th><td>通過で +${B.salary}M＆カード1枚。<b>ぴったり止まると手札が上限まで埋まる</b>。</td></tr>
        </table>` },
      { id: 'money', icon: '💰', title: '通行料・買収・売却', html: `
        <ul>
          <li>他の人の物件に止まったら<b>通行料</b>を払う。払ったあと、その物件を<b>買収</b>できる（価格は投資額の${B.acquireRate}倍）。<b>ランドマークは買収できない</b>。</li>
          <li>同じ色の物件を全部持つと、その色の通行料が<b>2倍</b>（マスに金色の「×2」）。</li>
          <li>お金が足りなくなったら、物件を<b>売却</b>（投資額の${Math.round(B.sellRate * 100)}%）。売る物がなければ<b>破産</b>。</li>
        </ul>` },
      { id: 'skill', icon: '✨', title: 'スキル', html: `
        <p>キャラごとに必殺スキルがあります。<b>スキルゲージを溜めて、満タンになったら自分のターンの最初に使う</b>だけです。</p>
        <ul>
          <li>📈 <b>スキルゲージ</b>：お金を払ったり建物を失ったりすると、<b>総資産（所持金＋物件の価値）の何割を失ったか</b>だけ溜まる（例：総資産2000Mで200M払う → 約+${Math.round(10 * B.skillGauge.rate)}%。不動産の購入は除く）。お金持ちほど溜まりにくく、<b>ピンチほど・終盤ほど一気に溜まる</b>（最終ターンは1ターン目の${Math.round((B.skillGauge.late || 1) / (B.skillGauge.early || 1) * 10) / 10}倍）。キャラによって少し溜まりやすさが違い、ステータス「設備」が高いほど溜まりやすい。満タンなら、自分のターンの最初にボタンで使える。</li>
          <li>💹 <b>人に払う・奪われるお金は「所持金の◯%」</b>：お金持ちほどたくさん取られる。スタートの給料など銀行からもらうお金と、通行料は定額。</li>
        </ul>
        <div class="rb-chars">${C.CHAR_ORDER.map((n) => { const ch = C.CHARACTERS[n]; return `<div class="rb-char"><img src="${ch.img}" alt=""><div><b>${esc(n)}</b>：✨${esc(ch.skill.title)}<br><span>${esc(ch.skill.desc)}</span></div></div>`; }).join('')}</div>` },
      { id: 'cards', icon: '🎴', title: 'イベントカード', html: `
        <p>スタートを通過するたびに1枚もらえる（ぴったり止まると上限まで補充）。手札は${B.gacha.handMax}枚までで、<b>使わないと減らない</b>。いっぱいの時に新しいカードが来ると、${OVF}。自分のターンの最初に1枚使える（スキルとどちらか1つ）。<b>自分の手札は自分にしか見えません</b>。カードは強い順に<b>🥇金・🥈銀・🥉銅</b>の3ランク。<b>総資産が他の人より少ないほど金</b>が、<b>多いほど銅</b>が出やすくなります。パネルのカードをタップすると説明が見られます。捨てることはできません。</p>
        <div class="rb-cards">${C.EVENTS.slice().sort((a, b) => ['gold', 'silver', 'bronze'].indexOf(a.rank) - ['gold', 'silver', 'bronze'].indexOf(b.rank)).map((e) => `<div class="rb-card"><img src="${e.img}" alt=""><div><b>${{ gold: '🥇', silver: '🥈', bronze: '🥉' }[e.rank] || ''}${e.icon} ${esc(e.name)}</b><br><span>${esc(e.desc)}</span></div></div>`).join('')}</div>` },
      { id: 'stats', icon: '📚', title: 'ステータス', html: `
        <p>4人とも、建築学科の4科目に<b>得意・不得意</b>があります。ステータスは1〜${S.max}の${S.max}段階で、ゲーム中に上がっていきます（下がることはありません）。</p>
        <table class="rb-table">${C.STAT_DEFS.map((sd) => `<tr><th>${sd.icon} ${sd.name}</th><td>${sd.desc}</td></tr>`).join('')}</table>
        <ul>
          <li>📚 <b>科目マス</b>（計画・設備・構造・材料）に止まると、1/4で落単（上がらない）・2/4でその科目が+1・1/4で+2。</li>
          <li>🏛 <b>研究棟</b>に止まると、全部+1（確実）。</li>
          <li>🎲 計画が低いうちはサイコロがブレやすく、<b>計画${S.max}になるとブレなし</b>（狙った目がそのまま出る）。</li>
        </ul>
        <table class="rb-table rb-stats"><tr><th></th>${C.STAT_DEFS.map((sd) => `<th>${sd.name}</th>`).join('')}</tr>${C.CHAR_ORDER.map((n) => `<tr><th>${esc(n)}</th>${C.STAT_DEFS.map((sd) => `<td>${C.CHARACTERS[n].stats[sd.key]}</td>`).join('')}</tr>`).join('')}</table>
        <p class="rb-tip">ステータスは、四隅のパネルをタップした詳細画面で見られます。</p>` },
      { id: 'tips', icon: '💡', title: '画面の見かた・コツ', html: `
        <ul>
          <li>四隅のパネル：所持金・総資産・順位・スキルゲージ・手札。</li>
          <li>マスの内側の黄色いバッジ：そのマスの通行料の倍率（👑＝色の独占で×2／🔥＝大炎上・げきりんで×2ずつ）。×4以上は赤いバッジ。</li>
          <li>物件をタップすると、価格や通行料が見られる。</li>
          <li>序盤は大きい目で盤面を回って物件を買い集め、中盤からはリーチになるマスを狙うのがおすすめ。</li>
          <li>右上の「速度」で演出の速さを変えられる。</li>
        </ul>` },
    ];
  }

  let ov = null;
  function open(startId) {
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'rules-ov';
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    }
    const secs = sections();
    ov.innerHTML = `<div id="rules-box">
      <div class="rb-head"><div class="rb-title">📖 ルールブック</div><button class="rb-close" aria-label="閉じる">✕</button></div>
      <div class="rb-tabs">${secs.map((s) => `<button data-go="${s.id}">${s.icon} ${s.title}</button>`).join('')}</div>
      <div class="rb-body">${secs.map((s) => `<section id="rb-${s.id}"><h3>${s.icon} ${s.title}</h3>${s.html}</section>`).join('')}</div>
    </div>`;
    ov.querySelector('.rb-close').onclick = close;
    const body = ov.querySelector('.rb-body');
    ov.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { const t = ov.querySelector('#rb-' + b.dataset.go); if (t) body.scrollTo({ top: t.offsetTop - body.offsetTop - 6, behavior: 'smooth' }); }));
    if (GR.fx && GR.fx.jpify) { ov.querySelector('#rules-box')._jp = false; GR.fx.jpify(ov.querySelector('#rules-box')); }
    ov.classList.add('show');
    if (startId) { const t = ov.querySelector('#rb-' + startId); if (t) body.scrollTop = t.offsetTop - body.offsetTop - 6; }
  }
  function close() { if (ov) ov.classList.remove('show'); }
  GR.rulebook = { open, close };
})(typeof globalThis !== 'undefined' ? globalThis : this);
