// =====================================================================
// ゲットリッチ復活 v2 — 盤面の「図面」デザイン部品
// 4人とも建築学科出身なので、盤面を青焼き図面に見立てる。
//   GR.blueprint.sheet()        ボード内側の図面（方眼・図面枠・通り芯・寸法線・表題欄・方位記号・スケールバー）
//   GR.blueprint.icon(name)     マス用の線画アイコン（白線）
//   GR.blueprint.building(lv, ownerColor)  白模型の建物（持ち主の色は敷地板）
//   GR.blueprint.spec(def)      物件マスの容積率表記
// =====================================================================
(function (root) {
  const GR = (root.GR = root.GR || {});
  const BS = 480, CR = 60;
  const NS = () => { const c = GR.CONFIG.CORNERS; return c[1] - c[0] - 1; }; // 1辺のマス数
  const LINE = 'rgba(214,232,255,.9)';

  // ---------- ボード内側の図面 ----------
  function sheet() {
    const x0 = CR, x1 = BS - CR, w = x1 - x0;
    const p = [];
    p.push(`<defs>
      <pattern id="bp-grid-s" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M9 0H0V9" fill="none" stroke="rgba(190,215,255,.07)" stroke-width=".5"/></pattern>
      <pattern id="bp-grid-l" width="45" height="45" patternUnits="userSpaceOnUse" x="${x0}" y="${x0}"><rect width="45" height="45" fill="url(#bp-grid-s)"/><path d="M45 0H0V45" fill="none" stroke="rgba(190,215,255,.13)" stroke-width=".7"/></pattern>
      <radialGradient id="bp-paper" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#1d4a93"/><stop offset=".7" stop-color="#143a7c"/><stop offset="1" stop-color="#0d2a5e"/></radialGradient>
    </defs>`);
    // 青焼きの紙と方眼
    p.push(`<rect x="${x0}" y="${x0}" width="${w}" height="${w}" fill="url(#bp-paper)"/>`);
    p.push(`<rect x="${x0}" y="${x0}" width="${w}" height="${w}" fill="url(#bp-grid-l)"/>`);
    // 図面枠（太線＋細線の二重線）
    p.push(`<rect x="${x0 + 5}" y="${x0 + 5}" width="${w - 10}" height="${w - 10}" fill="none" stroke="${LINE}" stroke-width="1.4"/>`);
    p.push(`<rect x="${x0 + 8}" y="${x0 + 8}" width="${w - 16}" height="${w - 16}" fill="none" stroke="${LINE}" stroke-width=".4"/>`);
    // 通り芯（一点鎖線）と記号
    const n = NS(), CW = w / n;
    const centers = Array.from({ length: n }, (_, k) => x0 + k * CW + CW / 2); // 各マスの中心
    const chain = 'stroke-dasharray="12 2.5 1.5 2.5"';
    centers.forEach((c, i) => {
      p.push(`<line x1="${c}" y1="${x0 + 22}" x2="${c}" y2="${x1 - 22}" stroke="rgba(255,150,150,.38)" stroke-width=".6" ${chain}/>`);
      p.push(`<line x1="${x0 + 22}" y1="${c}" x2="${x1 - 22}" y2="${c}" stroke="rgba(255,150,150,.38)" stroke-width=".6" ${chain}/>`);
      p.push(`<circle cx="${c}" cy="${x1 - 16}" r="5" fill="#143a7c" stroke="${LINE}" stroke-width=".6"/><text x="${c}" y="${x1 - 14.2}" class="bp-t" font-size="5" text-anchor="middle">X${i + 1}</text>`);
      p.push(`<circle cx="${x0 + 16}" cy="${c}" r="5" fill="#143a7c" stroke="${LINE}" stroke-width=".6"/><text x="${x0 + 16}" y="${c + 1.8}" class="bp-t" font-size="5" text-anchor="middle">Y${n - i}</text>`);
    });
    // 寸法線（上辺）
    const dy = x0 + 18;
    p.push(`<line x1="${centers[0]}" y1="${dy}" x2="${centers[n - 1]}" y2="${dy}" stroke="${LINE}" stroke-width=".45"/>`);
    centers.forEach((c, i) => {
      p.push(`<line x1="${c - 2}" y1="${dy + 2}" x2="${c + 2}" y2="${dy - 2}" stroke="${LINE}" stroke-width=".7"/>`);
      if (i < n - 1) p.push(`<text x="${c + CW / 2}" y="${dy - 2}" class="bp-t" font-size="4.2" text-anchor="middle">4,500</text>`);
    });
    p.push(`<text x="${(centers[0] + centers[n - 1]) / 2}" y="${dy + 7}" class="bp-t" font-size="4.2" text-anchor="middle" opacity=".8">${((n - 1) * 4500).toLocaleString()}</text>`);
    // 方位記号（左上）
    const nx = x0 + 44, ny = x0 + 46;
    p.push(`<g transform="translate(${nx},${ny})"><circle r="11" fill="none" stroke="${LINE}" stroke-width=".7"/><path d="M0 -14 L4 4 L0 1 L-4 4 Z" fill="${LINE}"/><text y="-16" class="bp-t" font-size="6" text-anchor="middle" font-weight="700">N</text></g>`);
    // 表題欄（右下＝STARTの内側）
    const tx = x1 - 108, ty = x1 - 84, tw = 96, th = 50;
    p.push(`<g class="bp-title"><rect x="${tx}" y="${ty}" width="${tw}" height="${th}" fill="rgba(10,30,70,.75)" stroke="${LINE}" stroke-width=".8"/>`);
    [10, 20, 30, 40].forEach((r) => p.push(`<line x1="${tx}" y1="${ty + r}" x2="${tx + tw}" y2="${ty + r}" stroke="${LINE}" stroke-width=".35"/>`));
    p.push(`<line x1="${tx + 24}" y1="${ty}" x2="${tx + 24}" y2="${ty + th}" stroke="${LINE}" stroke-width=".35"/>`);
    const rows = [['工事名', 'ゲットリッチ新築工事'], ['図面名', '配置図'], ['縮尺', '1/500'], ['図番', 'A-01'], ['設計', 'さこう・さだ・すぎうら・おくだ']];
    rows.forEach(([k, v], i) => {
      p.push(`<text x="${tx + 3}" y="${ty + 7 + i * 10}" class="bp-t" font-size="4.6">${k}</text>`);
      p.push(`<text x="${tx + 27}" y="${ty + 7 + i * 10}" class="bp-t" font-size="${v.length > 12 ? 4 : 4.8}" font-weight="700">${v}</text>`);
    });
    p.push(`</g>`);
    // スケールバー（表題欄の上）
    const sx = tx, sy = ty - 12;
    [0, 1, 2, 3].forEach((k) => p.push(`<rect x="${sx + k * 12}" y="${sy}" width="12" height="3" fill="${k % 2 ? 'none' : LINE}" stroke="${LINE}" stroke-width=".4"/>`));
    ['0', '5', '10', '15', '20m'].forEach((t, k) => p.push(`<text x="${sx + k * 12}" y="${sy - 1.5}" class="bp-t" font-size="3.8" text-anchor="middle">${t}</text>`));
    // 敷地境界線（ボード内側をぐるっと一点鎖線）
    p.push(`<rect x="${x0 + 1.5}" y="${x0 + 1.5}" width="${w - 3}" height="${w - 3}" fill="none" stroke="rgba(255,120,120,.55)" stroke-width=".7" ${chain}/>`);
    return `<svg class="bp-sheet" viewBox="0 0 ${BS} ${BS}" width="${BS}" height="${BS}" xmlns="http://www.w3.org/2000/svg">${p.join('')}</svg>`;
  }

  // ---------- マスの線画アイコン（白線） ----------
  const S = (body, vb = 24) => `<svg viewBox="0 0 ${vb} ${vb}" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const ICONS = {
    // 着工：地縄張りの杭と旗
    start: S('<path d="M6 21V4"/><path d="M6 4h10l-2.5 3L16 10H6"/><path d="M3 21h18" stroke-dasharray="2 2"/>'),
    // スチノリ地獄：スチレンのりのチューブ
    island: S('<path d="M4 15l9-9 5 5-9 9z"/><path d="M13 6l2-2 5 5-2 2"/><path d="M6 13l5 5"/><path d="M19 20c0-1 1-2 1-3"/>'),
    // 地震：地震計の波形
    quake: S('<path d="M2 12h4l2-6 3 12 3-9 2 5 2-2h4"/>'),
    // 敷地調査（好きなマスへ移動）：飛行機と点線の航路
    travel: S('<path d="M3 17c4-1 8-4 11-8" stroke-dasharray="1.5 2.5"/><path d="M14 9l6-5 1 1-4 6 2 4-1 1-3-3-3 2v2l-1 1-1-3-3-1 1-1h2z" stroke-width="1.3"/>'),
    // チャンス：付箋の「？」
    chance: S('<path d="M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2"/><circle cx="12" cy="18" r=".6" fill="currentColor"/>'),
    // 科目マス：開いた教科書
    study: S('<path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z"/><path d="M12 6v13"/>'),
    // 税：収入印紙
    tax: S('<rect x="5" y="4" width="14" height="16" rx="1" stroke-dasharray="1.5 1.5"/><path d="M9 9h6M9 12h6M12 12v5"/>'),
    // 物件：立面図（窓のある建物）
    prop: S('<path d="M5 21V8l7-4 7 4v13"/><path d="M3 21h18"/><path d="M9 11h2M13 11h2M9 15h2M13 15h2"/><path d="M11 21v-3h2v3"/>'),
    // 観光地（名建築）
    '照葉樹林': S('<path d="M12 21v-6"/><path d="M12 3c-4 0-7 3-7 7 0 3 3 5 7 5s7-2 7-5c0-4-3-7-7-7z"/><path d="M8 21h8"/>'),
    // 研究棟：本と星（カードを選べる）
    lab: S('<path d="M4 20V9l8-5 8 5v11"/><path d="M2 20h20"/><path d="M9 20v-6h6v6"/><path d="M12 7.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z" fill="currentColor" stroke="none"/>'),
    // 東山動植物園：木と動物の足あと
    '東山動植物園': S('<path d="M7 21v-5"/><path d="M7 4c-3 0-5 2.5-5 5.5S4.5 15 7 15s5-2.5 5-5.5S10 4 7 4z"/><circle cx="17" cy="15" r="2.2"/><circle cx="14.5" cy="11" r="1"/><circle cx="17" cy="10" r="1"/><circle cx="19.5" cy="11" r="1"/>'),
    'ピラミッド': S('<path d="M2 20L12 4l10 16z"/><path d="M12 4l3 16M7 12h10M5 16h14"/>'),
    // テレビ塔：鉄塔
    'テレビ塔': S('<path d="M12 2v3"/><path d="M9 21l2-16h2l2 16"/><path d="M7 21h10"/><path d="M9.8 10h4.4M9.2 15h5.6"/><path d="M8 12h8"/>'),
    '自由の女神': S('<path d="M12 21v-9"/><path d="M9 21h6"/><path d="M10 12h4l-1-4h-2z"/><path d="M14 8l3-5"/><path d="M16 2l2 1-1 2"/>'),
    // ナゴヤドーム：ドーム屋根
    'ナゴヤドーム': S('<path d="M2 19c0-6 4.5-10 10-10s10 4 10 10"/><path d="M2 19h20"/><path d="M7 19c0-4 2-7 5-7s5 3 5 7" opacity=".7"/><path d="M12 9V6"/>'),
    'オーロラ': S('<path d="M2 8c3-3 5 3 8 0s5 3 8 0 3-1 4 0"/><path d="M2 13c3-3 5 3 8 0s5 3 8 0 3-1 4 0" opacity=".7"/><path d="M3 20l3-3 3 3 4-4 4 4 4-3"/>'),
  };
  function icon(name) { return ICONS[name] || null; }

  // ---------- 白模型の建物（スチレンボード風）。持ち主の色は敷地板と旗 ----------
  function shade(hex, amt) {
    let c = hex.replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const n = parseInt(c, 16);
    const ch = [(n >> 16) + amt, ((n >> 8) & 0xff) + amt, (n & 0xff) + amt].map((v) => Math.max(0, Math.min(255, v)));
    return '#' + ch.map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  const W1 = '#ffffff', W2 = '#e6e9ef', W3 = '#c4cad6', EDGE = '#9aa3b5';
  function plate(c, cx, cy, rx) {
    // 持ち主の色の敷地板（ひし形の板）
    return `<polygon points="${cx},${cy - rx / 2} ${cx + rx},${cy} ${cx},${cy + rx / 2} ${cx - rx},${cy}" fill="${c}" stroke="${shade(c, -60)}" stroke-width=".6"/>
      <polygon points="${cx - rx},${cy} ${cx},${cy + rx / 2} ${cx},${cy + rx / 2 + 2} ${cx - rx},${cy + 2}" fill="${shade(c, -50)}"/>
      <polygon points="${cx + rx},${cy} ${cx},${cy + rx / 2} ${cx},${cy + rx / 2 + 2} ${cx + rx},${cy + 2}" fill="${shade(c, -30)}"/>`;
  }
  const BLD = {
    // 住宅：切妻屋根の小さな家
    1: (c) => `<svg width="30" height="30" viewBox="0 0 30 30">${plate(c, 15, 24, 13)}
      <polygon points="15,4 24,9 15,14 6,9" fill="${W2}" stroke="${EDGE}" stroke-width=".4"/>
      <polygon points="6,9 15,14 15,25 6,20" fill="${W3}" stroke="${EDGE}" stroke-width=".4"/>
      <polygon points="24,9 15,14 15,25 24,20" fill="${W1}" stroke="${EDGE}" stroke-width=".4"/>
      <path d="M17 16.5l2.5-1.3v3l-2.5 1.3z M20.5 14.7l2-1v3l-2 1z" fill="none" stroke="${EDGE}" stroke-width=".5"/>
      <path d="M17 24v-3.2l2-1v3.2" fill="none" stroke="${EDGE}" stroke-width=".5"/></svg>`,
    // 公共施設：横に広い2階建て（列柱の玄関・帯窓・屋上の旗）。旗だけ持ち主の色
    2: (c) => `<svg width="36" height="40" viewBox="0 0 36 40">${plate(c, 18, 31, 16)}
      <polygon points="18,8 32,15 18,22 4,15" fill="${W1}" stroke="${EDGE}" stroke-width=".4"/>
      <polygon points="4,15 18,22 18,31 4,24" fill="${W3}" stroke="${EDGE}" stroke-width=".4"/>
      <polygon points="32,15 18,22 18,31 32,24" fill="${W1}" stroke="${EDGE}" stroke-width=".4"/>
      <polygon points="18,9.6 29,15 18,20.4 7,15" fill="none" stroke="${W2}" stroke-width=".6"/>
      <path d="M18 25.5 L32 18.5 M18 28.3 L32 21.3" stroke="${EDGE}" stroke-width=".45"/>
      ${[0, 1, 2, 3, 4].map((k) => `<path d="M${20.5 + k * 2.6} ${21 - k * 1.3} v6.6" stroke="${W2}" stroke-width=".45"/>`).join('')}
      <path d="M5.5 17.6 L16.5 23.1" stroke="${W1}" stroke-width="1.1"/>
      ${[0, 1, 2, 3].map((k) => { const x = 7 + k * 3, y = 18.6 + k * 1.5; return `<path d="M${x} ${y} v6.4" stroke="${W1}" stroke-width="1"/>`; }).join('')}
      <path d="M25 11.5 V3" stroke="${W1}" stroke-width=".8" stroke-linecap="round"/><path d="M25 3 h6 l-1.6 1.6 1.6 1.6 h-6 z" fill="${c}" stroke="${W1}" stroke-width=".4"/></svg>`,
    // ランドマーク：塔＋金の尖塔（ここだけ金色のアクセント）
    3: (c) => `<svg width="32" height="46" viewBox="0 0 32 46">${plate(c, 16, 40, 14)}
      <polygon points="16,0 18,8 14,8" fill="#ffd23f" stroke="#b38600" stroke-width=".4"/>
      <polygon points="16,8 22,11 16,14 10,11" fill="${W1}" stroke="${EDGE}" stroke-width=".4"/>
      <polygon points="10,11 16,14 16,41 10,38" fill="${W3}" stroke="${EDGE}" stroke-width=".4"/>
      <polygon points="22,11 16,14 16,41 22,38" fill="${W1}" stroke="${EDGE}" stroke-width=".4"/>
      ${[0, 1, 2, 3, 4, 5].map((k) => `<path d="M16 ${18 + k * 4} L22 ${15 + k * 4}" stroke="${EDGE}" stroke-width=".4"/>`).join('')}
      <polygon points="6,30 16,35 26,30 16,25" fill="none" stroke="${W2}" stroke-width=".5"/>
      <path d="M16 41V14" stroke="#ffd23f" stroke-width=".5" opacity=".8"/></svg>`,
  };
  function building(lv, color) { return BLD[Math.min(3, Math.max(1, lv))](color); }
  // 観光地は「旗竿」＋持ち主の色の敷地板
  function flag(color) {
    return `<svg width="22" height="24" viewBox="0 0 22 24">${plate(color, 11, 19, 9)}<path d="M8 19V3" stroke="${W1}" stroke-width="1.2" stroke-linecap="round"/><path d="M8 3h9l-2.5 3L17 9H8z" fill="${color}" stroke="${W1}" stroke-width=".6"/></svg>`;
  }

  // ---------- 物件マスの容積率（値段が高いほど大きな容積率） ----------
  function spec(d) {
    if (d.type !== 'prop') return '';
    const p = d.prices[0];
    const far = p >= 300 ? 600 : p >= 260 ? 500 : p >= 220 ? 400 : p >= 180 ? 300 : p >= 140 ? 200 : p >= 100 ? 150 : 100;
    return `容積${far}%`;
  }

  // ---------- 研究棟（四隅の特別なマス）：名城大学 理工学部の研究棟を正面から見た姿 ----------
  //   左：低いガラスの玄関棟／角：レンガ色の塔に「MEIJO UNIVERSITY」／中央：グレーの縦ルーバーと1階のアーチ3つ／右：窓が並ぶレンガ色の壁
  function lab() {
    let o = '';
    const G = 74; // 地面の高さ
    // 地面と植栽の帯
    o += `<rect x="0" y="${G}" width="140" height="6" rx="2" fill="#1e4fa8" stroke="#ffd23f" stroke-width="1"/>`;
    // 左：低いガラスの玄関棟
    o += `<rect x="4" y="${G - 16}" width="16" height="16" fill="#cfd5df" stroke="#8d96a8" stroke-width=".6"/><rect x="6" y="${G - 13}" width="12" height="11" fill="#5d7fa8"/>`;
    // 角のレンガ色の塔（いちばん高い）
    o += `<rect x="20" y="${G - 58}" width="16" height="58" fill="#a8705a" stroke="#7a4c3b" stroke-width=".6"/>`;
    o += `<rect x="20" y="${G - 60}" width="16" height="3" fill="#c08670"/>`;
    o += `<text x="28" y="${G - 52}" font-size="2.7" font-weight="800" fill="#fff5e6" text-anchor="middle" font-family="sans-serif">MEIJO</text><text x="28" y="${G - 48.5}" font-size="2.2" font-weight="700" fill="#fff5e6" text-anchor="middle" font-family="sans-serif">UNIVERSITY</text>`;
    for (let f = 0; f < 5; f++) o += `<rect x="24" y="${G - 44 + f * 8.5}" width="8" height="4.5" fill="#6f8fb8"/>`;
    // 中央：グレーの縦ルーバー
    o += `<rect x="36" y="${G - 54}" width="46" height="54" fill="#5b6270" stroke="#3e434d" stroke-width=".6"/>`;
    for (let x = 38; x < 82; x += 2.4) o += `<line x1="${x}" y1="${G - 53}" x2="${x}" y2="${G - 16}" stroke="#9aa3b3" stroke-width=".8"/>`;
    // 1階：明るい壁にアーチ3つ
    o += `<rect x="36" y="${G - 16}" width="46" height="16" fill="#e3e6ec"/>`;
    for (let k = 0; k < 3; k++) { const x = 41 + k * 13.5; o += `<path d="M${x} ${G} V${G - 8} A5 5 0 0 1 ${x + 10} ${G - 8} V${G} Z" fill="#3c5a86" stroke="#fff" stroke-width=".6"/>`; }
    // 右：窓が並ぶレンガ色の壁（5階）
    o += `<rect x="82" y="${G - 54}" width="54" height="54" fill="#b9826b" stroke="#7a4c3b" stroke-width=".6"/>`;
    for (let f = 0; f < 5; f++) for (let c = 0; c < 7; c++) o += `<rect x="${84.5 + c * 7.3}" y="${G - 50 + f * 10}" width="4.6" height="6.4" fill="${f === 4 ? '#4d6f9c' : '#6f8fb8'}"/>`;
    for (let c = 0; c <= 7; c++) o += `<line x1="${83.4 + c * 7.3}" y1="${G - 53}" x2="${83.4 + c * 7.3}" y2="${G}" stroke="#d9a58e" stroke-width=".5"/>`;
    // 屋上のライン
    o += `<rect x="36" y="${G - 56}" width="100" height="2.2" fill="#d6dae3"/>`;
    // 手前の植栽
    [10, 88, 100, 112, 124].forEach((x) => { o += `<circle cx="${x}" cy="${G - 2}" r="4" fill="#3f9e4f"/><circle cx="${x + 1.5}" cy="${G - 4}" r="2.2" fill="#6cc16f"/>`; });
    return `<svg class="lab-svg" viewBox="0 0 140 82" width="140" height="82">${o}</svg>`;
  }
  // ---------- 設計課題（四隅）：資料を作るおくだの机（パソコン・図面・模型・スタンド） ----------
  function desk() {
    return `<svg class="desk-svg" viewBox="0 0 100 46" width="100" height="46">
      <rect x="4" y="22" width="92" height="6" rx="1.5" fill="#d9b48a" stroke="#8a6440" stroke-width=".6"/>
      <rect x="10" y="28" width="5" height="18" fill="#8a6440"/><rect x="85" y="28" width="5" height="18" fill="#8a6440"/>
      <!-- ノートパソコン -->
      <rect x="40" y="6" width="26" height="16" rx="1.5" fill="#2b2f3a" stroke="#c9cdd6" stroke-width=".8"/><rect x="42.5" y="8.5" width="21" height="11" fill="#6fb2ff"/>
      <path d="M45 11h10M45 14h14M45 17h8" stroke="#ffffff" stroke-width=".9"/>
      <rect x="36" y="21" width="34" height="2.2" rx="1" fill="#c9cdd6"/>
      <!-- 図面の束 -->
      <rect x="8" y="15" width="24" height="7" fill="#ffffff" stroke="#8aa0c8" stroke-width=".5" transform="rotate(-6 20 18)"/>
      <path d="M11 17l18-2M11 19.5l14-1.5" stroke="#3c6fd0" stroke-width=".6"/>
      <!-- 白模型 -->
      <rect x="72" y="12" width="9" height="10" fill="#ffffff" stroke="#9aa3b5" stroke-width=".5"/><rect x="81" y="15" width="7" height="7" fill="#e6e9ef" stroke="#9aa3b5" stroke-width=".5"/>
      <!-- 飛ぶ資料 -->
      <rect x="22" y="1" width="9" height="7" fill="#fff" stroke="#8aa0c8" stroke-width=".4" transform="rotate(-18 26 4)"><animateTransform attributeName="transform" type="rotate" values="-18 26 4;-8 26 4;-18 26 4" dur="1.6s" repeatCount="indefinite"/></rect>
      <rect x="70" y="0" width="8" height="6" fill="#fff" stroke="#8aa0c8" stroke-width=".4" transform="rotate(14 74 3)"><animateTransform attributeName="transform" type="rotate" values="14 74 3;4 74 3;14 74 3" dur="1.9s" repeatCount="indefinite"/></rect>
    </svg>`;
  }
  // ---------- 敷地調査（四隅）：4人で車に乗って出かける ----------
  function car() {
    return `<svg class="car-svg" viewBox="0 0 120 56" width="120" height="56">
      <path d="M6 40 Q6 30 14 28 L30 14 Q33 11 38 11 H86 Q92 11 96 15 L108 28 Q114 30 114 40 V44 H6 Z" fill="#2f6fd0" stroke="#ffd23f" stroke-width="1.4"/>
      <path d="M33 16 H58 V28 H22 Z" fill="#bfe3ff" opacity=".9"/><path d="M61 16 H86 Q89 16 91 18 L101 28 H61 Z" fill="#bfe3ff" opacity=".9"/>
      <rect x="6" y="34" width="108" height="3" fill="#ffffff" opacity=".85"/>
      <circle cx="30" cy="45" r="8" fill="#22252d"/><circle cx="30" cy="45" r="3.4" fill="#c9cdd6"/>
      <circle cx="90" cy="45" r="8" fill="#22252d"/><circle cx="90" cy="45" r="3.4" fill="#c9cdd6"/>
      <circle cx="111" cy="33" r="2" fill="#ffe680"/>
      <path d="M2 50 q8 -4 16 0" stroke="#ffffff" stroke-width="1.2" fill="none" opacity=".6"><animate attributeName="opacity" values=".6;0;.6" dur="0.9s" repeatCount="indefinite"/></path>
    </svg>`;
  }
  GR.blueprint = { sheet, icon, building, flag, spec, lab, desk, car };
})(typeof globalThis !== 'undefined' ? globalThis : this);
