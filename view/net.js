// =====================================================================
// ゲットリッチ復活 v2 — 友達対戦の通信（部屋を作る人＝親 が進行役）
//   親：ルールの計算・CPUの操作をすべて受け持ち、結果（盤面と演出）を全員に配る
//   子：自分の番の操作を親に送り、届いた結果を再生するだけ
//   通信は PeerJS（スマホどうしを直接つなぐ）。テスト用に ?net=bc で同じブラウザ内（BroadcastChannel）でも動く
// =====================================================================
(function (root) {
  const GR = (root.GR = root.GR || {});
  const PREFIX = 'getrichers-v1-';
  const params = new URLSearchParams(location.search);
  const useBC = params.get('net') === 'bc';

  // このタブのID（読み込み直しても同じ人だと分かるように保存。タブごとに別）
  function clientId() {
    let id = null;
    try { id = sessionStorage.getItem('gr_client_id'); } catch (e) { /* 保存できない端末 */ }
    if (!id) { id = 'c' + Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem('gr_client_id', id); } catch (e) { /* 無視 */ } }
    return id;
  }
  function newCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字（0/O, 1/I）は使わない
    let s = ''; for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }

  // ---------- 通信路（PeerJS / BroadcastChannel を同じ形で扱う） ----------
  // host(code, onConn, onReady, onError) / join(code, onOpen, onData, onClose, onError)
  //   conn: { id, send(obj), close(), on(event, fn) }  event = 'data' | 'close'
  function bcHost(code, onConn, onReady) {
    const ch = new BroadcastChannel('gr-' + code), conns = {};
    ch.onmessage = (ev) => {
      const m = ev.data; if (!m || m.to !== 'host') return;
      if (m.kind === 'hello') {
        const h = { data: [], close: [] };
        const conn = { id: m.from, send: (obj) => ch.postMessage({ to: m.from, kind: 'data', data: obj }), close: () => {}, on: (e, fn) => h[e].push(fn), _h: h };
        conns[m.from] = conn; onConn(conn); ch.postMessage({ to: m.from, kind: 'welcome' });
      } else if (m.kind === 'data' && conns[m.from]) conns[m.from]._h.data.forEach((f) => f(m.data));
      else if (m.kind === 'bye' && conns[m.from]) { conns[m.from]._h.close.forEach((f) => f()); delete conns[m.from]; }
    };
    setTimeout(onReady, 0);
    return { destroy: () => ch.close() };
  }
  function bcJoin(code, onOpen, onData, onClose) {
    const ch = new BroadcastChannel('gr-' + code), me = 'p' + Math.random().toString(36).slice(2, 8);
    ch.onmessage = (ev) => { const m = ev.data; if (!m || m.to !== me) return; if (m.kind === 'welcome') onOpen(); else if (m.kind === 'data') onData(m.data); };
    ch.postMessage({ to: 'host', from: me, kind: 'hello' });
    addEventListener('beforeunload', () => ch.postMessage({ to: 'host', from: me, kind: 'bye' }));
    return { send: (obj) => ch.postMessage({ to: 'host', from: me, kind: 'data', data: obj }), destroy: () => ch.close() };
  }
  function peerHost(code, onConn, onReady, onError) {
    const peer = new root.Peer(PREFIX + code, { debug: 1 });
    peer.on('open', () => onReady());
    peer.on('error', (err) => onError(err && err.type === 'unavailable-id' ? 'taken' : (err && err.type) || 'error'));
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* 無視 */ } });
    peer.on('connection', (c) => {
      const h = { data: [], close: [] };
      const conn = { id: c.peer, send: (obj) => { if (c.open) c.send(obj); }, close: () => c.close(), on: (e, fn) => h[e].push(fn) };
      c.on('open', () => onConn(conn));
      c.on('data', (d) => h.data.forEach((f) => f(d)));
      c.on('close', () => h.close.forEach((f) => f()));
      c.on('error', () => h.close.forEach((f) => f()));
    });
    return { destroy: () => peer.destroy() };
  }
  function peerJoin(code, onOpen, onData, onClose, onError) {
    const peer = new root.Peer({ debug: 1 });
    let c = null;
    peer.on('open', () => {
      c = peer.connect(PREFIX + code, { reliable: true });
      c.on('open', onOpen);
      c.on('data', onData);
      c.on('close', onClose);
      c.on('error', () => onClose());
    });
    peer.on('error', (err) => onError(err && err.type === 'peer-unavailable' ? 'nohost' : (err && err.type) || 'error'));
    return { send: (obj) => { if (c && c.open) c.send(obj); }, destroy: () => peer.destroy() };
  }
  const T = {
    host: (...a) => (useBC ? bcHost(...a) : peerHost(...a)),
    join: (...a) => (useBC ? bcJoin(...a) : peerJoin(...a)),
    ready: () => useBC || typeof root.Peer === 'function',
  };

  // ---------- 部屋（ロビー）の管理 ----------
  //   lobby: { code, members: [{ cid, name(=キャラ名 or ''), host, online }] }
  const N = {
    mode: null, code: null, cid: clientId(), seat: -1, seats: {}, lobby: null,
    _t: null, _conns: {}, handlers: {},
    roomFromUrl: () => (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null,
    inviteUrl(code) { const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('room', code); if (useBC) u.searchParams.set('net', 'bc'); return u.toString(); },
    available: () => T.ready(),
    on(ev, fn) { N.handlers[ev] = fn; },
    emit(ev, ...a) { if (N.handlers[ev]) N.handlers[ev](...a); },

    // 親：部屋を作る
    host(onReady) {
      N.mode = 'host'; N.code = newCode();
      N.lobby = { code: N.code, phase: 'lobby', members: [{ cid: N.cid, name: '', host: true, online: true }] };
      N._t = T.host(N.code, (conn) => {
        conn.on('data', (m) => N._hostRecv(conn, m));
        conn.on('close', () => {
          const cid = Object.keys(N._conns).find((k) => N._conns[k] === conn);
          if (cid) { delete N._conns[cid]; const mb = N.lobby.members.find((x) => x.cid === cid); if (mb) mb.online = false; N.emit('memberLeft', cid); N._sendLobby(); }
        });
      }, () => onReady && onReady(N.code), (err) => {
        if (err === 'taken') { N._t && N._t.destroy(); N.host(onReady); return; } // 部屋番号がかぶったら作り直す
        N.emit('error', err);
      });
    },
    _hostRecv(conn, m) {
      if (!m || !m.t) return;
      if (m.t === 'hello') {
        N._conns[m.cid] = conn;
        let mb = N.lobby.members.find((x) => x.cid === m.cid);
        if (!mb) { mb = { cid: m.cid, name: '', host: false, online: true }; N.lobby.members.push(mb); } else mb.online = true;
        N._sendLobby();
        N.emit('memberJoined', m.cid, mb.name);
      } else if (m.t === 'pick') {
        N.pick(m.cid, m.name);
      } else if (m.t === 'act') {
        N.emit('remoteAct', m.cid, m.action);
      }
    },
    // キャラを選ぶ（同じキャラは1人だけ）
    pick(cid, name) {
      if (N.mode === 'client') { N._t.send({ t: 'pick', cid, name }); return; }
      if (N.lobby.phase !== 'lobby') return;
      if (name && N.lobby.members.some((x) => x.cid !== cid && x.name === name)) return; // 取られている
      const mb = N.lobby.members.find((x) => x.cid === cid); if (!mb) return;
      mb.name = name || '';
      N._sendLobby();
    },
    _sendLobby() { N.lobby.members = N.lobby.members.filter((x) => x.online || x.name); Object.values(N._conns).forEach((c) => c.send({ t: 'lobby', lobby: N.lobby })); N.emit('lobby', N.lobby); },
    // 親：全員に送る（ゲームの進行・ロビー）
    broadcast(msg) { Object.values(N._conns).forEach((c) => c.send(msg)); },
    sendTo(cid, msg) { const c = N._conns[cid]; if (c) c.send(msg); },
    setPhase(phase) { N.lobby.phase = phase; N._sendLobby(); },

    // 子：部屋に入る
    join(code, onOpen) {
      N.mode = 'client'; N.code = code;
      N._t = T.join(code, () => { N._t.send({ t: 'hello', cid: N.cid }); onOpen && onOpen(); }, (m) => {
        if (!m || !m.t) return;
        if (m.t === 'lobby') { N.lobby = m.lobby; N.emit('lobby', m.lobby); }
        else N.emit(m.t, m);
      }, () => N.emit('hostLost'), (err) => N.emit('error', err));
    },
    sendAct(action) { if (N.mode === 'client') N._t.send({ t: 'act', cid: N.cid, action }); },
  };
  GR.net = N;
})(typeof globalThis !== 'undefined' ? globalThis : this);
