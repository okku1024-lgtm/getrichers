// =====================================================================
// ゲットリッチ復活 v2 — 派手な演出（画面のどこにでも重ねて出せる演出部品）
// ルールとは無関係。app.js が「いつ・どこに」を指示する。
// =====================================================================
(function (root) {
  const GR = (root.GR = root.GR || {});
  let layer = null;
  let speed = () => 1;
  const sp = (ms) => ms / speed();
  const wait = (ms) => new Promise((r) => setTimeout(r, sp(ms)));
  // ポップアップ（文字の帯）は読めるように最低2.5秒。速度×2以上でも1.6秒より短くしない
  const POP_MS = 2500, POP_MIN = 1600;
  const popDur = (ms) => Math.max(POP_MIN, sp(Math.max(ms || 0, POP_MS)));
  const TONES = {
    good: ['#3ddc84', '#d7ff5a'], bad: ['#6b5b95', '#b0a4c8'], gold: ['#ffb300', '#fff27a'],
    skill: ['#b14cff', '#ff5ac8'], info: ['#2f8fdb', '#7fe0ff'], rent: ['#ff3d3d', '#ffb36b'], late: ['#ff3d3d', '#ffd23f'],
  };

  function init(getSpeed) {
    if (getSpeed) speed = getSpeed;
    layer = document.createElement('div');
    layer.id = 'fx-layer';
    document.body.appendChild(layer);
  }
  function mk(cls, html, parent) {
    const e = document.createElement('div');
    e.className = cls;
    if (html != null) e.innerHTML = html;
    (parent || layer).appendChild(e);
    return e;
  }
  function center(el) {
    if (!el) return { x: innerWidth / 2, y: innerHeight / 2 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // 日本語の改行位置を整える：文節の切れ目らしい所（ひらがな→漢字・カタカナ・数字、句読点や括弧の前後）にだけ改行の候補<wbr>を入れる
  //   CSS（.jp）で「keep-all」にすると、単語の途中では改行されなくなる。どうしても入らない時だけ途中で折り返す
  function jp(t) {
    let h = esc(t);
    h = h.replace(/([、。，．！？!?）」』】：:／・…〜])(?!$)/g, '$1<wbr>');
    h = h.replace(/(.)([（「『【])/g, (m, a, b) => a + '<wbr>' + b);
    h = h.replace(/の(?=[ぁ-ゖ])/g, 'の<wbr>'); // 「〇〇の」のあとは、ひらがなが続いても区切ってよい
    h = h.replace(/([ぁ-ゖ])(?=[一-龠々ァ-ヴー0-9０-９A-Za-zＡ-Ｚ+＋±×%％])/g, (m, a, off, str) => {
      // 「お金」「ご褒美」の お・ご は前の語とくっつける（直前もひらがななら文節の切れ目とみなす）
      if ((a === 'お' || a === 'ご') && !/[ぁ-ゖ]/.test(str[off - 1] || '')) return a;
      return a + '<wbr>';
    });
    return h;
  }

  // 画面中央の大きな帯＋文字。dur ミリ秒で消える
  function banner({ text, sub = '', tone = 'info', img = null, face = null, dur = 1300, big = false }) {
    const [c1, c2] = TONES[tone] || TONES.info;
    const b = mk('fx-banner' + (big ? ' big' : ''));
    b.style.setProperty('--c1', c1); b.style.setProperty('--c2', c2);
    b.innerHTML = `<div class="fx-band"></div><div class="fx-banner-in">${face || (img ? `<img class="fx-face" src="${img}">` : '')}<div><div class="fx-text jp">${jp(text)}</div>${sub ? `<div class="fx-sub jp">${jp(sub)}</div>` : ''}</div></div>`;
    const band = b.querySelector('.fx-band'), inner = b.querySelector('.fx-banner-in');
    const d = popDur(dur);
    band.animate([{ transform: 'skewY(-6deg) scaleX(0)', opacity: 0 }, { transform: 'skewY(-6deg) scaleX(1)', opacity: 1, offset: 0.12 }, { transform: 'skewY(-6deg) scaleX(1)', opacity: 1, offset: 0.85 }, { transform: 'skewY(-6deg) scaleX(1.1)', opacity: 0 }], { duration: d, easing: 'ease-out' });
    inner.animate([{ transform: 'translateX(60vw) scale(1.4)', opacity: 0 }, { transform: 'translateX(0) scale(1)', opacity: 1, offset: 0.15 }, { transform: 'translateX(0) scale(1.04)', opacity: 1, offset: 0.85 }, { transform: 'translateX(-60vw) scale(0.9)', opacity: 0 }], { duration: d, easing: 'cubic-bezier(.2,.9,.3,1)' });
    return new Promise((r) => setTimeout(() => { b.remove(); r(); }, d));
  }

  // 「〇〇のターン」：キャラ画像つきの帯が横切る
  function turnBanner({ name, img, face, color, isHuman, again, sub }) {
    const b = mk('fx-turn');
    b.style.setProperty('--pc', color);
    b.innerHTML = `${face ? `<div class="fx-turn-face">${face}</div>` : `<img src="${img}">`}<div><div class="fx-turn-small">${sub ? esc(sub) : again ? 'ゾロ目でもう一度' : 'TURN'}</div><div class="fx-turn-name">${isHuman ? 'あなた' : esc(name)}のターン！</div></div>`;
    const d = Math.max(1200, sp(1800));
    b.animate([{ transform: 'translate(-120%,-50%) skewX(-12deg)' }, { transform: 'translate(-50%,-50%) skewX(-12deg)', offset: 0.15 }, { transform: 'translate(-46%,-50%) skewX(-12deg)', offset: 0.85 }, { transform: 'translate(120%,-50%) skewX(-12deg)' }], { duration: d, easing: 'cubic-bezier(.3,.9,.4,1)' });
    return new Promise((r) => setTimeout(() => { b.remove(); r(); }, d));
  }

  // 数字などがポンと出て上に消える
  function pop(x, y, text, cls = 'good', size = 1) {
    const e = mk('fx-pop ' + cls, esc(text));
    e.style.left = x + 'px'; e.style.top = y + 'px'; e.style.fontSize = 22 * size + 'px';
    e.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,-90%) scale(1.25)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%,-120%) scale(1)', opacity: 1, offset: 0.8 }, { transform: 'translate(-50%,-170%) scale(.9)', opacity: 0 }], { duration: popDur(), easing: 'ease-out' });
    setTimeout(() => e.remove(), popDur());
  }

  // コインが a から b へ弧を描いて飛ぶ
  function coins(a, b, n = 8) {
    const dur = sp(650);
    for (let i = 0; i < n; i++) {
      const c = mk('fx-coin', 'M');
      const jx = (Math.random() - 0.5) * 40, jy = (Math.random() - 0.5) * 30;
      const mx = (a.x + b.x) / 2 + jx * 2, my = Math.min(a.y, b.y) - 80 - Math.random() * 60;
      c.animate([
        { transform: `translate(${a.x + jx}px,${a.y + jy}px) scale(.6)`, opacity: 0 },
        { transform: `translate(${a.x + jx}px,${a.y + jy}px) scale(1)`, opacity: 1, offset: 0.1 },
        { transform: `translate(${mx}px,${my}px) scale(1.2) rotateY(360deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${b.x}px,${b.y}px) scale(.7) rotateY(720deg)`, opacity: 0.9 },
      ], { duration: dur, delay: sp(i * 45), easing: 'ease-in', fill: 'both' });
      setTimeout(() => c.remove(), dur + sp(i * 45) + 30);
    }
    return wait(650 + n * 45);
  }

  // 放射状にはじける粒
  function burst(x, y, colors = ['#ffd23f', '#fff', '#ff5ac8'], n = 18, dist = 90) {
    for (let i = 0; i < n; i++) {
      const p = mk('fx-spark');
      p.style.background = colors[i % colors.length];
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.3, r = dist * (0.6 + Math.random() * 0.6);
      p.animate([{ transform: `translate(${x}px,${y}px) scale(1)`, opacity: 1 }, { transform: `translate(${x + Math.cos(ang) * r}px,${y + Math.sin(ang) * r}px) scale(0)`, opacity: 0 }], { duration: sp(700 + Math.random() * 300), easing: 'cubic-bezier(.1,.8,.3,1)', fill: 'forwards' });
      setTimeout(() => p.remove(), sp(1100));
    }
  }

  // 紙吹雪
  function confetti(n = 140, dur = 3200) {
    const colors = ['#ff3d3d', '#ffd23f', '#3ddc84', '#2f8fdb', '#b14cff', '#ff5ac8', '#fff'];
    for (let i = 0; i < n; i++) {
      const c = mk('fx-confetti');
      c.style.background = colors[i % colors.length];
      const x = Math.random() * innerWidth, drift = (Math.random() - 0.5) * 200, rot = Math.random() * 1080;
      const d = sp(dur * (0.6 + Math.random() * 0.6));
      c.animate([{ transform: `translate(${x}px,-30px) rotate(0)` }, { transform: `translate(${x + drift}px,${innerHeight + 40}px) rotate(${rot}deg)` }], { duration: d, delay: sp(Math.random() * 600), easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'both' });
      setTimeout(() => c.remove(), d + sp(700));
    }
  }

  function shake(el, power = 8, dur = 450) {
    if (!el) return;
    const k = [];
    for (let i = 0; i < 8; i++) k.push({ transform: `translate(${(Math.random() - 0.5) * power * 2}px,${(Math.random() - 0.5) * power * 2}px)` });
    k.push({ transform: 'translate(0,0)' });
    el.animate(k, { duration: sp(dur) });
  }
  function flash(color = '#fff', dur = 350) {
    const f = mk('fx-flash');
    f.style.background = color;
    f.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: sp(dur), easing: 'ease-out', fill: 'forwards' });
    setTimeout(() => f.remove(), sp(dur));
  }
  // 要素をポンッと大きくして戻す
  function bounceEl(el, scale = 1.35, dur = 500) {
    if (!el) return;
    el.animate([{ transform: el.style.transform || 'none' }, { transform: `${el.style.transform || ''} scale(${scale})` }, { transform: el.style.transform || 'none' }], { duration: sp(dur), easing: 'cubic-bezier(.3,1.6,.5,1)' });
  }

  // スキル発動時の文字カットイン（画像スプラッシュの上に重ねる）
  function cutinText({ name, title, color }) {
    const b = mk('fx-cutin');
    b.style.setProperty('--pc', color);
    b.innerHTML = `<div class="fx-cutin-name">${esc(name)}</div><div class="fx-cutin-title">${esc(title)}</div>`;
    const d = popDur(2600);
    b.animate([{ transform: 'translate(-50%,0) scale(2.5)', opacity: 0 }, { transform: 'translate(-50%,0) scale(1)', opacity: 1, offset: 0.12 }, { transform: 'translate(-50%,0) scale(1.05)', opacity: 1, offset: 0.85 }, { transform: 'translate(-50%,0) scale(1.1)', opacity: 0 }], { duration: d, easing: 'ease-out' });
    setTimeout(() => b.remove(), d);
  }

  // ガチャ演出：光るカードの裏面がくるくる回り → 表に返ってイベントカードが出る
  function gacha({ name, color, img, title, icon, desc }) {
    const ov = mk('fx-gacha');
    ov.style.setProperty('--pc', color || '#b14cff');
    ov.innerHTML = `<div class="fg-rays"></div><div class="fg-head">🎴 ${esc(name)}のガチャ！</div>
      <div class="fg-card"><div class="fg-inner"><div class="fg-back"><span>?</span></div>
      <div class="fg-front"><img src="${img}" alt="${esc(title)}"></div></div></div>
`;
    const inner = ov.querySelector('.fg-inner'), card = ov.querySelector('.fg-card');
    const total = Math.max(1500, sp(1900)), flipAt = total * 0.32; // 短め（GET!の文字はなし）
    ov.animate([{ opacity: 0 }, { opacity: 1, offset: 0.06 }, { opacity: 1, offset: 0.93 }, { opacity: 0 }], { duration: total, fill: 'forwards' });
    card.animate([{ transform: 'translateY(60vh) scale(.4)' }, { transform: 'translateY(0) scale(1)', offset: 0.14 }, { transform: 'translateY(0) scale(1)' }], { duration: total, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'forwards' });
    inner.animate([{ transform: 'rotateY(0)' }, { transform: 'rotateY(720deg)', offset: flipAt / total }, { transform: 'rotateY(900deg)', offset: (flipAt + 220) / total }, { transform: 'rotateY(900deg)' }], { duration: total, easing: 'ease-in-out', fill: 'forwards' });
    setTimeout(() => { const pt = center(card); burst(pt.x, pt.y, ['#ffe14d', '#fff', '#ff5ac8', '#8fe3ff'], 30, 170); flash('#ffffff', 260); }, flipAt + 230);
    return new Promise((r) => setTimeout(() => { ov.remove(); r(); }, total));
  }

  // スタート通過でカード獲得：裏向きのカードが出て、持ち主のパネルへ飛んでいく（中身は見せない）
  function cardGet({ name, color, to }) {
    const ov = mk('fx-cardget');
    ov.style.setProperty('--pc', color || '#b14cff');
    ov.innerHTML = `<div class="fcg-card"><span>?</span></div><div class="fcg-text">🎴 ${esc(name)}がカードを1枚ゲット！</div>`;
    const card = ov.querySelector('.fcg-card'), text = ov.querySelector('.fcg-text');
    const d = Math.max(1100, sp(1300)); // 短め
    const a = center(card), b = to ? center(to) : a;
    const dx = b.x - a.x, dy = b.y - a.y;
    card.animate([
      { transform: 'translateY(40px) rotateY(0) scale(.5)', opacity: 0 },
      { transform: 'translateY(0) rotateY(360deg) scale(1.1)', opacity: 1, offset: 0.25 },
      { transform: 'translateY(0) rotateY(360deg) scale(1)', opacity: 1, offset: 0.65 },
      { transform: `translate(${dx}px,${dy}px) rotateY(360deg) scale(.25)`, opacity: 0.2 },
    ], { duration: d, easing: 'ease-in-out', fill: 'forwards' });
    text.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: d, fill: 'forwards' });
    setTimeout(() => { const pt = center(card); burst(pt.x, pt.y, ['#ffe14d', '#fff', color || '#b14cff'], 14, 80); }, d * 0.25);
    return new Promise((r) => setTimeout(() => { ov.remove(); r(); }, d));
  }

  // チャンスマス：大きなカードがポンと出て、効果を読ませる
  function chanceCard({ icon, title, desc, tone }) {
    const [c1, c2] = TONES[tone] || TONES.info;
    const ov = mk('fx-chance');
    ov.style.setProperty('--c1', c1); ov.style.setProperty('--c2', c2);
    ov.innerHTML = `<div class="fc-card"><div class="fc-top">CHANCE</div><div class="fc-icon">${esc(icon)}</div><div class="fc-name">${esc(title)}</div><div class="fc-desc">${esc(desc)}</div></div>`;
    const card = ov.querySelector('.fc-card');
    const d = popDur(2800);
    ov.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }], { duration: d, fill: 'forwards' });
    card.animate([{ transform: 'rotateY(90deg) scale(.6)' }, { transform: 'rotateY(0) scale(1.08)', offset: 0.14 }, { transform: 'rotateY(0) scale(1)', offset: 0.22 }, { transform: 'scale(1)' }], { duration: d, easing: 'cubic-bezier(.2,.9,.3,1.3)', fill: 'forwards' });
    setTimeout(() => { const pt = center(card); burst(pt.x, pt.y, [c1, c2, '#fff'], 18, 120); }, sp(300));
    return new Promise((r) => setTimeout(() => { ov.remove(); r(); }, d));
  }

  // 衝撃波の輪
  function ring(x, y, color = '#fff', size = 160) {
    const r = mk('fx-ring');
    r.style.left = x + 'px'; r.style.top = y + 'px'; r.style.borderColor = color; r.style.boxShadow = `0 0 18px ${color}, inset 0 0 12px ${color}`;
    r.animate([{ transform: 'translate(-50%,-50%) scale(.1)', opacity: 1 }, { transform: `translate(-50%,-50%) scale(${size / 20})`, opacity: 0 }], { duration: sp(600), easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' });
    setTimeout(() => r.remove(), sp(620));
  }
  // 飛行機が a から b へ弧を描いて飛ぶ（後ろに点線の飛行機雲）
  function plane(a, b, color = '#8fe3ff', ms = 1200) {
    const el = mk('fx-plane', `<svg viewBox="0 0 48 48" width="46" height="46"><path d="M44 22c0-2-2-3-4-3H30L19 4h-5l6 15H11l-4-5H3l3 9-3 9h4l4-5h9l-6 15h5l11-15h10c2 0 4-1 4-3z" fill="#fff" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/></svg>`);
    const mx = (a.x + b.x) / 2, dist = Math.hypot(b.x - a.x, b.y - a.y);
    const my = Math.min(a.y, b.y) - Math.max(80, dist * 0.35);
    const N = 24, frames = [];
    let prev = a;
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      const x = u * u * a.x + 2 * u * t * mx + t * t * b.x, y = u * u * a.y + 2 * u * t * my + t * t * b.y;
      const ang = i === 0 ? Math.atan2(my - a.y, mx - a.x) : Math.atan2(y - prev.y, x - prev.x);
      const sc = 0.6 + 0.7 * Math.sin(Math.PI * t);
      frames.push({ transform: `translate(${x}px,${y}px) translate(-50%,-50%) rotate(${(ang * 180) / Math.PI}deg) scale(${sc})`, opacity: i === 0 || i === N ? 0.2 : 1 });
      prev = { x, y };
      // 飛行機雲（点々）
      if (i % 2 === 0 && i > 0 && i < N) {
        const dot = mk('fx-trail');
        dot.style.left = x + 'px'; dot.style.top = y + 'px';
        dot.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.1 }, { opacity: 0 }], { duration: ms * 0.9, delay: (ms * t), fill: 'both' });
        setTimeout(() => dot.remove(), ms * 1.9 + 50);
      }
    }
    el.animate(frames, { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
    return new Promise((r) => setTimeout(() => { el.remove(); r(); }, ms));
  }
  // 要素の中の文章すべてに改行候補を入れる（中身が書き換わったら自動でやり直す）
  function jpifyNow(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [];
    while (w.nextNode()) { const n = w.currentNode; if (/[ぁ-ゖ一-龠ァ-ヴ]/.test(n.nodeValue) && !(n.parentNode && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentNode.nodeName))) list.push(n); }
    list.forEach((n) => {
      const parts = jp(n.nodeValue).split('<wbr>');
      if (parts.length < 2) return;
      const f = document.createDocumentFragment(), tmp = document.createElement('span');
      parts.forEach((h, i) => { if (i) f.appendChild(document.createElement('wbr')); tmp.innerHTML = h; f.appendChild(document.createTextNode(tmp.textContent)); });
      n.parentNode.replaceChild(f, n);
    });
  }
  function jpify(root) {
    if (!root || root._jp) return; root._jp = true;
    root.classList.add('jp');
    const mo = new MutationObserver(() => { mo.disconnect(); jpifyNow(root); mo.observe(root, { childList: true, subtree: true }); });
    jpifyNow(root); mo.observe(root, { childList: true, subtree: true });
  }
  GR.fx = { jp, jpify, plane, ring, init, banner, turnBanner, pop, coins, burst, confetti, shake, flash, bounceEl, cutinText, center, wait , gacha, chanceCard, cardGet };
})(typeof globalThis !== 'undefined' ? globalThis : this);
