/* CamWatch – live stack-camera monitoring for the Environmental Intelligence Platform (concept demo)
   The feed is analysed frame by frame in the browser as it streams. Nothing is recorded:
   each frame is discarded after analysis, and only a single snapshot is kept when an alert fires.
   Sources: a remote "stack camera" (stackcam.html on a phone or laptop, connected by a pairing code),
   this device's own camera, or a shared window (for example a Teams video). */
(function () {
  if (window.CamWatch) return;
  const RELAY = 'https://rspcb-relay.pgpsm11023.workers.dev';
  const PREFIX = 'rspcb-eip-cam-';
  const PEERJS = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
  const W = 160; // analysis width in pixels
  const TYPES = {
    covered: { label: 'Camera covered', desc: 'The lens is blocked or the view is obscured.', icon: '◼' },
    flame: { label: 'Flame or flaring', desc: 'A bright flame-coloured area is visible in the frame.', icon: '▲' },
    moved: { label: 'Camera moved', desc: 'The camera is no longer pointing at its usual view.', icon: '↻' },
    frozen: { label: 'Feed frozen', desc: 'The picture has stopped changing, as if the feed is stuck or replaced.', icon: '❚❚' },
    lost: { label: 'Feed lost', desc: 'The camera stopped sending video.', icon: '✕' },
    mismatch: { label: 'Visible plume, OCEMS reads low', desc: 'A plume is visible above the stack while OCEMS reports low particulate levels.', icon: '≠', x: 1 },
    nodata: { label: 'Plume visible, OCEMS offline', desc: 'The plant appears to be running while OCEMS is sending no data.', icon: '∅', x: 1 },
  };
  const CHECKS = [['covered', 'Lens view'], ['frozen', 'Live picture'], ['moved', 'Camera position'], ['flame', 'Flame or flaring'], ['mismatch', 'Camera vs OCEMS']];
  const LIM = 50; // illustrative PM limit, mg/Nm3
  const DEF = { hold: 5, detAbs: 2.5, detRel: 0.3, dark: 16, frozen: 0.12, moved: 0.75, flame: 0.0015, clear: 3, cooldown: 20, xStd: 5, xSat: 0.3, xGain: 1.5, xPlume: 25, xHold: 10, xLow: 0.6, xRef: 18 };
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v } catch (e) { return d } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} };
  const T = Object.assign({}, DEF, load('cwTune', {}));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtT = d => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const say = m => { if (window.toast) window.toast(m) };

  /* ---------- styles ---------- */
  const css = `
.cw .cw-grid{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:16px}
@media(max-width:980px){.cw .cw-grid{grid-template-columns:1fr}}
.cw-vwrap{position:relative;background:#0f1a15;border-radius:10px;overflow:hidden;aspect-ratio:16/9}
.cw-vwrap video{width:100%;height:100%;object-fit:contain;display:block;background:#0f1a15}
.cw-idle{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#d7e3dc;text-align:center;padding:16px}
.cw-idle .ic{font-size:30px;opacity:.7}
.cw-pair{display:flex;gap:18px;align-items:center;text-align:left;max-width:560px}
.cw-qr{background:#fff;border-radius:10px;padding:8px;flex:none;width:138px;height:138px;display:grid;place-items:center}
.cw-qr svg,.cw-qr img{width:122px;height:122px;display:block}
.cw-ptxt{display:flex;flex-direction:column;gap:6px}
.cw-ptxt .s{max-width:none}
.cw-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#f0a020;margin-right:7px;animation:cwp 1.4s infinite}
@keyframes cwp{50%{opacity:.25}}
@media(max-width:620px){.cw-pair{flex-direction:column;text-align:center;gap:10px}.cw-qr{width:118px;height:118px}.cw-qr svg,.cw-qr img{width:102px;height:102px}.cw-idle .cw-links,.cw-idle .cw-code{display:none}}
.cw-idle .t{font-size:15px;font-weight:600}
.cw-idle .s{font-size:12.5px;opacity:.75;max-width:420px}
.cw-code{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center}
.cw-code input{width:120px;padding:9px 10px;border-radius:8px;border:1px solid #42594d;background:#16261e;color:#fff;font-size:18px;letter-spacing:3px;text-align:center}
.cw-btn{border:1px solid #cfd9d3;background:#fff;color:#1c2a23;border-radius:8px;padding:8px 12px;font:inherit;font-size:13px;cursor:pointer}
.cw-btn.pri{background:#0b6b3a;border-color:#0b6b3a;color:#fff}
.cw-idle .cw-btn{background:#1d3328;border-color:#42594d;color:#e6efe9}
.cw-idle .cw-btn.pri{background:#0b7a42;border-color:#0b7a42;color:#fff}
.cw-links{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;font-size:12.5px}
.cw-links a{color:#9fd4b4;text-decoration:underline;cursor:pointer}
.cw-pill{position:absolute;left:10px;top:10px;font-size:12.5px;font-weight:600;border-radius:14px;padding:5px 11px;display:none;align-items:center;gap:7px;backdrop-filter:blur(4px)}
.cw-pill i{width:8px;height:8px;border-radius:50%;display:inline-block}
.cw-pill.ok{background:rgba(227,244,232,.92);color:#13703b}.cw-pill.ok i{background:#1f9d55}
.cw-pill.warn{background:rgba(255,241,214,.95);color:#8a5200}.cw-pill.warn i{background:#f0a020}
.cw-pill.bad{background:rgba(253,232,230,.96);color:#b42318}.cw-pill.bad i{background:#d7263d}
.cw-pill.learn{background:rgba(229,238,252,.95);color:#1d4fa8}.cw-pill.learn i{background:#2f6fd6}
.cw-osd{position:absolute;right:10px;bottom:8px;font:600 12px ui-monospace,Consolas,monospace;color:#fff;text-shadow:0 1px 2px #000;display:none}
.cw-live{position:absolute;right:10px;top:10px;font:700 11px Inter,sans-serif;color:#fff;background:#d7263d;border-radius:4px;padding:2px 6px;display:none;letter-spacing:.5px}
.cw-vwrap.on .cw-pill,.cw-vwrap.on .cw-osd,.cw-vwrap.on .cw-live{display:flex}
.cw-vwrap.on .cw-idle{display:none}
.cw-vwrap::after{content:'';position:absolute;inset:0;border:3px solid transparent;border-radius:10px;pointer-events:none;transition:border-color .2s}
.cw-vwrap.alert::after{border-color:#d7263d}
.cw-side h3{font-size:13.5px;margin:0 0 8px;font-weight:600}
.cw-chk{display:flex;align-items:center;gap:9px;padding:6px 0;border-bottom:1px solid #eef2ef;font-size:13px}
.cw-chk:last-child{border-bottom:0}
.cw-chk i{width:9px;height:9px;border-radius:50%;background:#c4cec8;flex:none}
.cw-chk.ok i{background:#1f9d55}.cw-chk.warn i{background:#f0a020}.cw-chk.bad i{background:#d7263d}
.cw-chk span{flex:1}.cw-chk small{color:#6a7a70;font-size:12px}
.cw-inc{display:flex;flex-direction:column;gap:8px;max-height:330px;overflow:auto;margin-top:4px}
.cw-incard{display:flex;gap:10px;border:1px solid #e6ece8;border-radius:10px;padding:8px;background:#fbfcfb}
.cw-incard img{width:96px;height:54px;object-fit:cover;border-radius:6px;flex:none;background:#0f1a15}
.cw-incard .h{font-weight:600;font-size:13px;color:#b42318}
.cw-incard.cleared .h{color:#55665c}
.cw-incard .m{font-size:12px;color:#6a7a70;margin-top:2px}
.cw-incard .a{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
.cw-incard .a .cw-btn{padding:4px 8px;font-size:12px}
.cw-tag{display:inline-block;font-size:11px;font-weight:600;border-radius:9px;padding:1px 7px;margin-left:4px}
.cw-tag.g{background:#e3f4e8;color:#13703b}.cw-tag.y{background:#fff1d6;color:#8a5200}.cw-tag.r{background:#fde8e6;color:#b42318}.cw-tag.n{background:#eef1ef;color:#55665c}
.cw-foot{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}
.cw-note{font-size:12px;color:#6a7a70;margin-top:10px}
.cw-tune{margin-top:12px;border-top:1px dashed #d5ded8;padding-top:10px;font-size:12.5px}
.cw-tune table{width:100%;border-collapse:collapse}
.cw-tune td{padding:4px 6px;border-bottom:1px solid #eef2ef}
.cw-tune input{width:72px;padding:3px 5px;border:1px solid #cfd9d3;border-radius:6px;font:inherit}
.cw-tune b.on{color:#b42318}
.cw-roic{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.cw-roic.draw{pointer-events:auto;cursor:crosshair}
.cw-x{margin-top:16px;border-top:1px solid #e6ece8;padding-top:14px}
.cw-xh{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.cw-xh h3{font-size:14px;margin:0;font-weight:600}
.cw-xgrid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px}
@media(max-width:980px){.cw-xgrid{grid-template-columns:1fr}}
.cw-xc{width:100%;height:170px;display:block;background:#fbfcfb;border:1px solid #e6ece8;border-radius:8px}
.cw-xleg{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#55665c;margin-top:6px}
.cw-xleg i{display:inline-block;width:12px;height:3px;border-radius:2px;margin-right:5px;vertical-align:middle}
.cw-xrow{display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid #eef2ef}
.cw-xrow b{font-weight:600}
.cw-xlab{display:block;font-size:12.5px;color:#6a7a70;margin-top:10px}
.cw-xlab select{display:block;width:100%;margin-top:4px;padding:6px 8px;border:1px solid #cfd9d3;border-radius:7px;font:inherit;font-size:13px;color:#1c2a23;background:#fff}
.cw-xmsg{font-size:12.5px;margin-top:10px;line-height:1.45;color:#55665c}
.cw-xmsg b{color:#b42318}
`;
  function injectCss() { if (document.getElementById('cw-css')) return; const s = document.createElement('style'); s.id = 'cw-css'; s.textContent = css; document.head.appendChild(s) }

  /* ---------- helpers ---------- */
  function loadPeer(i) {
    i = i || 0;
    if (window.Peer) return Promise.resolve();
    const srcs = [PEERJS, 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'];
    if (i >= srcs.length) return Promise.reject(new Error('Could not load the connection library. Check the internet connection.'));
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = srcs[i]; const t = setTimeout(no, 12000); s.onload = () => { clearTimeout(t); window.Peer ? ok() : no() }; s.onerror = () => { clearTimeout(t); no() }; document.head.appendChild(s) }).catch(() => loadPeer(i + 1));
  }
  let iceCache = null;
  async function iceServers() {
    if (iceCache) return iceCache;
    try {
      const r = await fetch(RELAY + '/turn', { cache: 'no-store' });
      const d = await r.json();
      if (d && d.iceServers) { iceCache = d.iceServers; return iceCache }
    } catch (e) {}
    return [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  }
  function peerOpts(ice) { return Object.assign({ debug: 1, config: { iceServers: ice } }, load('cwSig', {})) }
  let actx = null;
  function chime() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime;
      [[880, 0], [660, 0.18]].forEach(([f, d]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.35);
        o.connect(g).connect(actx.destination); o.start(t + d); o.stop(t + d + 0.4);
      });
    } catch (e) {}
  }

  /* ---------- controller (one live camera at a time) ---------- */
  const C = { el: null, unit: null, stream: null, peer: null, call: null, src: null, timer: null, osd: null, inc: [], st: {}, ref: null, prev: null, lastVT: -1, lastVTat: 0, learnT: 0, metrics: {}, email: null };

  function build(unit) {
    injectCss();
    const el = document.createElement('div');
    el.className = 'card mt cw';
    el.innerHTML = `
    <div class="card-h"><h2>Stack camera · live</h2><span class="hint">Stack 1 · final outlet · not recorded</span></div>
    <div class="cw-grid">
      <div>
        <div class="cw-vwrap">
          <video playsinline muted autoplay></video>
          <div class="cw-idle">
            <div class="cw-pair">
              <div class="cw-qr" title="Scan with the phone that will act as the stack camera"></div>
              <div class="cw-ptxt">
                <div class="t">Connect the stack camera</div>
                <div class="s">Scan with the phone, then tap <b>Start camera</b>.</div>
                <div class="s cw-pairst"><span class="cw-dot"></span>Waiting for the camera · code <b class="cw-pcode"></b></div>
              </div>
            </div>
            <div class="cw-code"><input class="cw-codein" inputmode="numeric" maxlength="8" placeholder="Code" aria-label="Pairing code"><button class="cw-btn pri cw-go">Connect with code</button></div>
            <div class="cw-links"><a class="cw-own">Use this device's camera</a><a class="cw-share">Use a shared window</a></div>
            <div class="s cw-msg" style="min-height:16px"></div>
          </div>
          <div class="cw-pill ok"><i></i><span>Monitoring · OK</span></div>
          <div class="cw-live">LIVE</div>
          <div class="cw-osd"></div>
          <canvas class="cw-roic"></canvas>
        </div>
        <div class="cw-foot">
          <button class="cw-btn cw-reset" disabled>Reset normal view</button>
          <button class="cw-btn pri cw-recon" hidden>Reconnect</button>
          <button class="cw-btn cw-stop" disabled>Disconnect</button>
          <button class="cw-btn cw-tunebtn">Tuning</button>
          <span class="cw-note cw-src" style="margin:0"></span>
        </div>
        <div class="cw-tune" hidden></div>
      </div>
      <div class="cw-side">
        <h3>Automatic checks</h3>
        <div class="cw-checks">${CHECKS.map(([k, l]) => `<div class="cw-chk" data-k="${k}"><i></i><span>${l}</span><small>Waiting for feed</small></div>`).join('')}</div>
        <h3 style="margin-top:14px">Alerts <span class="cw-mailst"></span></h3>
        <div class="cw-inc"><div class="cw-note" style="margin:0">No alerts yet · raised after ${T.hold} s</div></div>
        <div class="cw-note">Alerts go to the RO by email with a snapshot.</div>
      </div>
    </div>
    <div class="cw-x" hidden>
      <div class="cw-xh"><h3>Camera vs OCEMS cross-check</h3><span class="cw-tag y">OCEMS values are illustrative until live data access</span></div>
      <div class="cw-xgrid">
        <div><canvas class="cw-xc"></canvas>
          <div class="cw-xleg"><span><i style="background:#8a5a2b"></i>Plume index from camera (0–100)</span><span><i style="background:#0b7a42"></i>OCEMS particulate, mg/Nm³ (illustrative)</span><span><i style="background:#d7263d;height:2px"></i>Limit ${LIM} mg/Nm³</span></div></div>
        <div class="cw-xside">
          <div class="cw-xrow"><span>Plume index</span><b class="cw-xp">–</b></div>
          <div class="cw-xrow"><span>Plume type</span><b class="cw-xpt">–</b></div>
          <div class="cw-xrow"><span>OCEMS particulate</span><b class="cw-xo">–</b></div>
          <label class="cw-xlab">Illustrative OCEMS behaviour
            <select class="cw-xs"><option value="low">Reports low (suspicious)</option><option value="track">Tracks the plume (consistent)</option><option value="off">Sends no data</option></select></label>
          <div class="cw-xmsg"></div>
          <div class="cw-foot" style="margin-top:8px"><button class="cw-btn cw-roib">Mark plume area</button></div>
        </div>
      </div>
    </div>`;
    const q = s => el.querySelector(s);
    q('.cw-codein').value = load('cwCode', '');
    q('.cw-go').onclick = () => { stopPairing(); connectRemote(q('.cw-codein').value.trim()) };
    q('.cw-codein').onkeydown = e => { if (e.key === 'Enter') connectRemote(q('.cw-codein').value.trim()) };
    q('.cw-own').onclick = () => { stopPairing(); connectLocal('camera') };
    q('.cw-share').onclick = () => { stopPairing(); connectLocal('screen') };
    q('.cw-stop').onclick = () => { stop(true); startPairing() };
    q('.cw-recon').onclick = () => { if (C.kind === 'remote') connectRemote(C.code); else connectLocal(C.kind) };
    q('.cw-reset').onclick = () => { C.ref = null; C.learnT = performance.now(); C.rref = null; C.rrefWant = true; say('Learning the normal view again') };
    q('.cw-roib').onclick = () => roiMode(true);
    q('.cw-xs').value = load('cwXs', 'low'); C.xs = q('.cw-xs').value;
    q('.cw-xs').onchange = e => { C.xs = e.target.value; save('cwXs', C.xs) };
    C.roi = load('cwRoi', null);
    q('.cw-tunebtn').onclick = () => { const t = q('.cw-tune'); t.hidden = !t.hidden; if (!t.hidden) tuneUI() };
    C.el = el; C.unit = unit;
    roiWire();
    emailStatus();
    C.pair = load('cwPair', '') || String(Math.floor(1000 + Math.random() * 9000)); save('cwPair', C.pair);
    q('.cw-pcode').textContent = C.pair;
    drawQR();
    startPairing();
    return el;
  }
  const q = s => C.el && C.el.querySelector(s);
  function msg(t) { const m = q('.cw-msg'); if (m) m.textContent = t || '' }

  async function emailStatus() {
    try { const r = await fetch(RELAY + '/health', { cache: 'no-store' }); const d = await r.json(); C.email = !!d.email; C.turn = !!d.turn } catch (e) { C.email = false }
    const s = q('.cw-mailst'); if (s) s.innerHTML = C.email ? '<span class="cw-tag g">Email alerts on</span>' : '<span class="cw-tag n">Email not set up</span>';
  }

  /* ---------- QR pairing: the laptop picks the code, the phone opens stackcam.html?code=XXXX ---------- */
  function camUrl() { const u = new URL('stackcam.html', location.href); u.search = '?code=' + C.pair; return u.href }
  function loadQRLib() {
    if (window.qrcode) return Promise.resolve();
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s) });
  }
  async function drawQR() {
    const box = q('.cw-qr'); if (!box) return;
    try { await loadQRLib(); const qr = qrcode(0, 'M'); qr.addData(camUrl()); qr.make(); box.innerHTML = qr.createSvgTag(4, 0) }
    catch (e) { box.innerHTML = '<div style="color:#1c2a23;font-size:11px;text-align:center">QR unavailable.<br>Open stackcam.html on the phone.</div>' }
  }
  function stopPairing() {
    C.pairing = false; clearInterval(C.pairTimer); C.pairTimer = null;
    if (C.pairPeer && C.pairPeer !== C.peer) { try { C.pairPeer.destroy() } catch (e) {} }
    C.pairPeer = null;
  }
  async function startPairing() {
    if (C.pairing || C.stream) return;
    C.pairing = true; C.pairStart = Date.now();
    const st = q('.cw-pairst'); if (st) st.innerHTML = '<span class="cw-dot"></span>Waiting for the camera · code <b class="cw-pcode">' + C.pair + '</b>';
    try { await loadPeer() } catch (e) { C.pairing = false; return }
    const ice = await iceServers();
    if (!C.pairing) return;
    const peer = new Peer(undefined, peerOpts(ice)); C.pairPeer = peer;
    peer.on('error', () => {});
    peer.on('call', call => {
      if (C.stream) { try { call.close() } catch (e) {} return }
      C.call = call; call.answer();
      call.on('stream', st2 => {
        if (C.stream) return;
        clearInterval(C.pairTimer); C.pairing = false; C.peer = peer; C.pairPeer = null;
        C.kind = 'remote'; C.code = C.pair;
        start(st2, 'Stack camera · scanned code ' + C.pair); watchPc(call);
      });
      call.on('close', () => feedLost()); call.on('error', () => feedLost());
    });
    peer.on('open', () => {
      const ping = () => {
        if (!C.pairing || C.stream) return;
        if (Date.now() - C.pairStart > 15 * 60e3) { stopPairing(); const s2 = q('.cw-pairst'); if (s2) { s2.innerHTML = 'Pairing paused. <a style="color:#9fd4b4;text-decoration:underline;cursor:pointer">Resume</a>'; s2.querySelector('a').onclick = startPairing } return }
        try { const c = peer.connect(PREFIX + C.pair, { reliable: true }); c.on('open', () => c.send({ hello: 'control-room' })) } catch (e) {}
      };
      ping(); C.pairTimer = setInterval(ping, 4000);
    });
  }
  async function connectRemote(code) {
    code = (code || '').replace(/\s+/g, '').toUpperCase();
    if (!code) { msg('Enter the code shown on the stack camera.'); return }
    save('cwCode', code); stop(false); C.kind = 'remote'; C.code = code; msg('Connecting…');
    try {
      await loadPeer();
      const ice = await iceServers();
      const peer = new Peer(undefined, peerOpts(ice)); C.peer = peer;
      let done = false;
      const fail = t => { if (done) return; done = true; msg(t); try { peer.destroy() } catch (e) {} C.peer = null };
      const to = setTimeout(() => fail('No video yet. Check the code, and that the camera page is open and connected to the internet.'), 20000);
      peer.on('error', e => { clearTimeout(to); fail(e && e.type === 'peer-unavailable' ? 'No camera is waiting with that code. Check the code on the camera page.' : 'Connection problem: ' + (e && (e.type || e.message) || 'unknown')) });
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        conn.on('open', () => { msg('Camera found. Starting the feed…'); conn.send({ hello: 'control-room', unit: C.unit && C.unit.id }) });
      });
      peer.on('call', call => {
        C.call = call; call.answer();
        call.on('stream', s => { if (done) return; done = true; clearTimeout(to); start(s, 'Stack camera · code ' + code); watchPc(call) });
        call.on('close', () => feedLost());
        call.on('error', () => feedLost());
      });
    } catch (e) { msg(e.message || 'Could not connect') }
  }
  function watchPc(call) {
    const pc = call.peerConnection; if (!pc) return;
    pc.addEventListener('iceconnectionstatechange', () => { if (['failed', 'disconnected', 'closed'].includes(pc.iceConnectionState)) feedLost() });
  }
  async function connectLocal(kind) {
    stop(false); C.kind = kind; msg('Waiting for permission…');
    try {
      const s = kind === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })
        : await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      start(s, kind === 'screen' ? 'Shared window' : "This device's camera");
    } catch (e) { msg(kind === 'screen' ? 'Window sharing was not allowed.' : 'Camera access was not allowed.') }
  }

  function start(stream, label) {
    C.stream = stream; C.src = label; xReset(); q('.cw-x').hidden = false;
    const v = q('video'); v.srcObject = stream; v.play().catch(() => {});
    q('.cw-vwrap').classList.add('on'); q('.cw-stop').disabled = false; q('.cw-reset').disabled = false;
    q('.cw-src').textContent = 'Source: ' + label;
    msg('');
    stream.getVideoTracks().forEach(t => { t.onended = () => feedLost(); t.onmute = () => { C.muted = performance.now() }; t.onunmute = () => { C.muted = 0 } });
    C.ref = null; C.prev = null; C.st = {}; C.lost = 0; C.muted = 0; C.learnT = performance.now(); C.lastVTat = performance.now(); C.lastVT = -1;
    clearInterval(C.timer); C.timer = setInterval(tick, 200);
    clearInterval(C.osd); C.osd = setInterval(() => { const o = q('.cw-osd'); if (o) o.textContent = `CAM 1 · ${C.unit ? C.unit.id : ''} · ${fmtT(new Date())}` }, 1000);
    say('Stack camera connected. Monitoring started.');
  }
  function feedLost() {
    if (!C.stream || C.lost) return;
    C.lost = performance.now();
  }
  function stop(user) {
    clearInterval(C.timer); clearInterval(C.osd); C.timer = null;
    if (C.stream) C.stream.getTracks().forEach(t => t.stop());
    try { C.call && C.call.close() } catch (e) {}
    try { C.peer && C.peer.destroy() } catch (e) {}
    C.stream = null; C.call = null; C.peer = null; C.lost = 0;
    if (!C.el) return;
    const v = q('video'); if (v) v.srcObject = null;
    q('.cw-x').hidden = true;
    q('.cw-vwrap').classList.remove('on', 'alert'); q('.cw-recon').hidden = true; q('.cw-stop').disabled = true; q('.cw-reset').disabled = true; q('.cw-src').textContent = '';
    C.el.querySelectorAll('.cw-chk').forEach(c => { c.className = 'cw-chk'; c.querySelector('small').textContent = 'Waiting for feed' });
    if (user) say('Camera disconnected');
  }

  /* ---------- analysis ---------- */
  const cv = document.createElement('canvas'); let cx = null;
  function frameStats(v) {
    const vw = v.videoWidth, vh = v.videoHeight; if (!vw || !vh) return null;
    const w = W, h = Math.max(30, Math.round(W * vh / vw));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; cx = null }
    cx = cx || cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(v, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data, n = w * h, g = new Float32Array(n);
    let sum = 0, fl = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = d[p], gg = d[p + 1], b = d[p + 2];
      const y = 0.299 * r + 0.587 * gg + 0.114 * b; g[i] = y; sum += y;
      if (r >= 200 && gg >= 95 && b <= 150 && r - b >= 80 && r >= gg) fl++;
    }
    const mean = sum / n;
    let det = 0, dn = 0;
    for (let yy = 0; yy < h - 1; yy++) for (let xx = 0; xx < w - 1; xx++) { const i = yy * w + xx; det += Math.abs(g[i] - g[i + 1]) + Math.abs(g[i] - g[i + w]); dn++ }
    det /= dn;
    let diff = 0; if (C.prev && C.prev.length === n) { for (let i = 0; i < n; i++) diff += Math.abs(g[i] - C.prev[i]); diff /= n } else diff = 99;
    C.prev = g;
    // small normalised view for "camera moved"
    const sw = 32, sh = Math.max(8, Math.round(32 * h / w)), z = new Float32Array(sw * sh);
    for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) { let s = 0, c = 0; const x0 = Math.floor(i * w / sw), x1 = Math.floor((i + 1) * w / sw), y0 = Math.floor(j * h / sh), y1 = Math.floor((j + 1) * h / sh); for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += g[yy * w + xx]; c++ } z[j * sw + i] = s / c }
    let zm = 0; for (const a of z) zm += a; zm /= z.length; let zs = 0; for (const a of z) zs += (a - zm) ** 2; zs = Math.sqrt(zs / z.length) || 1;
    for (let i = 0; i < z.length; i++) z[i] = (z[i] - zm) / zs;
    return { mean, det, diff, flame: fl / n, z };
  }
  function tick() {
    const v = q('video'); if (!v || !C.stream) return;
    const now = performance.now();
    if (v.currentTime !== C.lastVT) { C.lastVT = v.currentTime; C.lastVTat = now }
    const stalled = now - C.lastVTat > 1500;
    const m = frameStats(v);
    const lost = !!C.lost || (C.muted && now - C.muted > 2000);
    const cond = { covered: false, frozen: false, moved: false, flame: false, lost };
    let learning = false;
    if (m && !lost) {
      const refDet = C.ref ? C.ref.det : null;
      cond.covered = m.mean < T.dark || m.det < Math.max(T.detAbs, refDet ? refDet * T.detRel : 0);
      cond.frozen = !cond.covered && (stalled || m.diff < T.frozen);
      if (!C.ref) {
        learning = true;
        if (!cond.covered && !cond.frozen && now - C.learnT > 2000) C.ref = { z: m.z, det: m.det, flame: m.flame };
      } else {
        let md = 0; if (C.ref.z.length === m.z.length) { for (let i = 0; i < m.z.length; i++) md += Math.abs(m.z[i] - C.ref.z[i]); md /= m.z.length }
        m.view = md;
        cond.flame = !cond.covered && (m.flame - C.ref.flame) > T.flame;
        // a hand holding a lighter changes the view too, so flame takes priority over "moved"
        cond.moved = !cond.covered && !cond.flame && !(C.st.flame && C.st.flame.since) && md > T.moved;
      }
    } else if (!m && !lost) { cond.frozen = stalled }
    C.metrics = m || {};
    const healthy = m && !lost && !cond.covered && !cond.frozen && !cond.moved;
    const pl = healthy ? plumeStats(v) : null;
    xUpdate(pl, now, healthy);
    cond.mismatch = healthy && C.xs !== 'off' && C.pE >= T.xPlume && C.oc != null && C.oc < T.xLow * LIM;
    cond.nodata = healthy && C.xs === 'off' && C.pE >= T.xPlume;
    for (const k of Object.keys(TYPES)) step(k, cond[k], now);
    render(now, learning);
    if (C.tuneOpen) tuneValues();
  }
  function step(k, on, now) {
    const s = C.st[k] || (C.st[k] = { e: 0, since: 0, offSince: 0, open: null, lastClose: -1e9 });
    s.e = 0.65 * s.e + 0.35 * (on ? 1 : 0);
    const active = s.since ? s.e > 0.3 : s.e > 0.6;
    if (active) { if (!s.since) s.since = now; s.offSince = 0 }
    else { s.since = 0; if (!s.offSince) s.offSince = now }
    const hold = TYPES[k].x ? T.xHold : T.hold;
    if (active && !s.open && now - s.since >= hold * 1000 && now - s.lastClose > T.cooldown * 1000) raise(k, s, now);
    if (s.open && !active && now - s.offSince >= T.clear * 1000) { clearInc(s.open, now); s.open = null; s.lastClose = now }
  }
  function render(now, learning) {
    const pill = q('.cw-pill'), wrap = q('.cw-vwrap');
    const order = ['lost', 'covered', 'frozen', 'moved', 'flame', 'mismatch', 'nodata'];
    const open = order.find(k => C.st[k] && C.st[k].open);
    const pend = order.find(k => C.st[k] && C.st[k].since && !C.st[k].open);
    let cls = 'ok', txt = 'Monitoring · OK';
    if (open) { cls = 'bad'; txt = TYPES[open].label + ' · alert raised' }
    else if (pend) { const hd = TYPES[pend].x ? T.xHold : T.hold, sec = Math.min(hd, Math.floor((now - C.st[pend].since) / 1000)); cls = 'warn'; txt = `${TYPES[pend].label}? ${sec}s of ${hd}s` }
    else if (learning) { cls = 'learn'; txt = 'Learning the normal view…' }
    pill.className = 'cw-pill ' + cls; pill.querySelector('span').textContent = txt;
    q('.cw-recon').hidden = !(C.st.lost && C.st.lost.open);
    wrap.classList.toggle('alert', !!open);
    C.el.querySelectorAll('.cw-chk').forEach(c => {
      const k = c.dataset.k, sm = c.querySelector('small');
      const s = k === 'mismatch' ? ((C.st.mismatch && (C.st.mismatch.open || C.st.mismatch.since)) ? C.st.mismatch : (C.st.nodata || {})) : (C.st[k] || {});
      const lost = C.st.lost && C.st.lost.open;
      if (lost) { c.className = 'cw-chk bad'; sm.textContent = 'No video'; return }
      if (s.open) { c.className = 'cw-chk bad'; sm.textContent = 'Alert raised' }
      else if (s.since) { c.className = 'cw-chk warn'; sm.textContent = 'Checking…' }
      else if (learning && (k === 'moved' || k === 'flame')) { c.className = 'cw-chk'; sm.textContent = 'Learning' }
      else { c.className = 'cw-chk ok'; sm.textContent = 'Normal' }
    });
  }

  /* ---------- camera vs OCEMS cross-check ---------- */
  // Plume index: share of pixels in the marked area above the stack that are grey-ish (low colour)
  // and moving over the last ~2 seconds. Clear sky or a static background scores near 0.
  const rc = document.createElement('canvas'); let rx = null;
  function plumeStats(v) {
    const roi = C.roi || { x: 0.3, y: 0.05, w: 0.4, h: 0.45 };
    const vw = v.videoWidth, vh = v.videoHeight; if (!vw || !vh) return null;
    const sx = roi.x * vw, sy = roi.y * vh, sw = Math.max(4, roi.w * vw), sh = Math.max(4, roi.h * vh);
    const w = 80, h = Math.max(8, Math.min(120, Math.round(80 * sh / sw)));
    if (rc.width !== w || rc.height !== h) { rc.width = w; rc.height = h; rx = null; C.rbuf = []; C.rref = null }
    rx = rx || rc.getContext('2d', { willReadFrequently: true });
    rx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
    const d = rx.getImageData(0, 0, w, h).data, n = w * h, L = new Float32Array(n), S = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) { const r = d[p], g = d[p + 1], b = d[p + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); L[i] = 0.299 * r + 0.587 * g + 0.114 * b; S[i] = mx ? (mx - mn) / mx : 0 }
    C.rbuf = C.rbuf || []; C.rbuf.push(L); if (C.rbuf.length > 10) C.rbuf.shift();
    // clear-view reference for this area: averaged over the first frames after the area is marked
    if (C.rrefWant) { C.rrefAcc = C.rrefAcc || { s: new Float32Array(n), k: 0 }; if (C.rrefAcc.s.length !== n) C.rrefAcc = { s: new Float32Array(n), k: 0 }; for (let i = 0; i < n; i++) C.rrefAcc.s[i] += L[i]; if (++C.rrefAcc.k >= 5) { C.rref = C.rrefAcc.s.map(v => v / 5); C.rrefWant = false; C.rrefAcc = null } }
    if (C.rbuf.length < 5) return { idx: 0, type: '' };
    const ref = C.rref && C.rref.length === n ? C.rref : null;
    const k = C.rbuf.length; let cnt = 0, lum = 0;
    for (let i = 0; i < n; i++) {
      let m = 0; for (let j = 0; j < k; j++) m += C.rbuf[j][i]; m /= k;
      let vv = 0; for (let j = 0; j < k; j++) { const e = C.rbuf[j][i] - m; vv += e * e }
      if (S[i] < T.xSat && (Math.sqrt(vv / k) > T.xStd || (ref && Math.abs(ref[i] - L[i]) > T.xRef))) { cnt++; lum += L[i] }
    }
    const idx = Math.min(100, (cnt / n) * 100 * T.xGain), ml = cnt ? lum / cnt : 0;
    return { idx, type: cnt < n * 0.02 ? '' : ml < 110 ? 'dark smoke' : ml > 175 ? 'white plume, could be steam' : 'grey plume' };
  }
  function xReset() { C.xh = []; C.pE = 0; C.pType = ''; C.oc = null; C.xLast = 0; C.rbuf = []; C.rref = null; C.rrefWant = true; C.xT0 = performance.now() }
  function xUpdate(pl, now, healthy) {
    if (pl) { C.pE = 0.8 * (C.pE || 0) + 0.2 * pl.idx; C.pType = pl.type }
    else if (!healthy) C.pE = 0.9 * (C.pE || 0);
    if (now - (C.xLast || 0) < 1000) return;
    C.xLast = now;
    const t = (now - C.xT0) / 1000, nz = (Math.random() - 0.5) * 2.4;
    C.oc = C.xs === 'off' ? null : C.xs === 'track' ? Math.max(4, 10 + 1.2 * C.pE + nz) : Math.max(4, 16 + 3 * Math.sin(t / 17) + nz);
    const flag = !!((C.st.mismatch && C.st.mismatch.open) || (C.st.nodata && C.st.nodata.open));
    C.xh.push({ p: C.pE, o: C.oc, f: flag }); if (C.xh.length > 180) C.xh.shift();
    const set = (c, v) => { const e = q(c); if (e) e.textContent = v };
    set('.cw-xp', healthy ? Math.round(C.pE) + ' / 100' : 'paused');
    set('.cw-xpt', healthy ? (C.pType || (C.pE < 8 ? 'no visible plume' : 'faint plume')) : 'camera check failing');
    set('.cw-xo', C.oc == null ? 'no data' : C.oc.toFixed(1) + ' mg/Nm³');
    const msgEl = q('.cw-xmsg');
    if (msgEl) {
      const rule = `Rule: plume index ${T.xPlume}+ for ${T.xHold} s while OCEMS is below ${Math.round(T.xLow * 100)}% of the limit, or sends no data. In production the hold would be about 10 minutes.`;
      const sm = C.st.mismatch || {}, sn = C.st.nodata || {};
      msgEl.innerHTML = (sm.open || sn.open) ? `<b>${TYPES[sm.open ? 'mismatch' : 'nodata'].label}.</b> The camera and OCEMS disagree. ${rule}` : (sm.since || sn.since) ? `<b style="color:#8a5200">Checking:</b> the camera shows a plume but OCEMS does not reflect it. ${rule}` : rule;
    }
    drawChart();
    drawRoi();
  }
  function drawChart() {
    const c = q('.cw-xc'); if (!c || c.offsetParent === null) return;
    const dpr = window.devicePixelRatio || 1, W2 = c.clientWidth, H2 = c.clientHeight;
    if (c.width !== Math.round(W2 * dpr)) { c.width = Math.round(W2 * dpr); c.height = Math.round(H2 * dpr) }
    const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W2, H2);
    const L = 34, Rr = 40, Tt = 10, B = 20, pw = W2 - L - Rr, ph = H2 - Tt - B, N = 180;
    const X = i => L + pw * (i + (N - C.xh.length)) / (N - 1), Y = v => Tt + ph * (1 - Math.min(100, Math.max(0, v)) / 100);
    x.font = '11px Inter,system-ui,sans-serif'; x.fillStyle = '#8a998f'; x.strokeStyle = '#eef2ef'; x.lineWidth = 1;
    [0, 25, 50, 75, 100].forEach(v => { x.beginPath(); x.moveTo(L, Y(v)); x.lineTo(L + pw, Y(v)); x.stroke(); x.textAlign = 'right'; x.fillText(v, L - 6, Y(v) + 4); x.textAlign = 'left'; x.fillText(v, L + pw + 6, Y(v) + 4) });
    x.textAlign = 'left'; x.fillText('3 min ago', L, H2 - 5); x.textAlign = 'right'; x.fillText('now', L + pw, H2 - 5);
    C.xh.forEach((h, i) => { if (h.f) { x.fillStyle = 'rgba(215,38,61,.10)'; x.fillRect(X(i) - pw / N / 2, Tt, pw / N + 1, ph) } });
    x.strokeStyle = '#d7263d'; x.setLineDash([5, 4]); x.beginPath(); x.moveTo(L, Y(LIM)); x.lineTo(L + pw, Y(LIM)); x.stroke(); x.setLineDash([]);
    const line = (key, col) => { x.strokeStyle = col; x.lineWidth = 2; x.beginPath(); let pen = false; C.xh.forEach((h, i) => { const v = h[key]; if (v == null) { pen = false; return } pen ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)); pen = true }); x.stroke() };
    line('p', '#8a5a2b'); line('o', '#0b7a42');
  }
  // marked plume area, drawn over the video
  function vidRect() {
    const v = q('video'), r = v.getBoundingClientRect(), ar = (v.videoWidth || 16) / (v.videoHeight || 9);
    let w = r.width, h = r.width / ar; if (h > r.height) { h = r.height; w = h * ar }
    return { x: (r.width - w) / 2, y: (r.height - h) / 2, w, h, r };
  }
  function drawRoi(tmp) {
    const c = q('.cw-roic'); if (!c) return;
    const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr) }
    const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, r.width, r.height);
    const roi = tmp || C.roi || (C.stream ? { x: 0.3, y: 0.05, w: 0.4, h: 0.45, def: 1 } : null); if (!roi || !C.stream) return;
    const vr = vidRect();
    const bx = vr.x + roi.x * vr.w, by = vr.y + roi.y * vr.h, bw = roi.w * vr.w, bh = roi.h * vr.h;
    x.strokeStyle = '#ffd400'; x.lineWidth = 2; x.setLineDash([7, 5]); x.strokeRect(bx, by, bw, bh); x.setLineDash([]);
    x.font = '600 11px Inter,system-ui,sans-serif'; const lab = roi.def ? 'Plume area (default)' : 'Plume area';
    const tw = x.measureText(lab).width + 10; x.fillStyle = '#ffd400'; x.fillRect(bx, Math.max(0, by - 18), tw, 18); x.fillStyle = '#1c2a23'; x.fillText(lab, bx + 5, Math.max(0, by - 18) + 13);
  }
  function roiMode(on) {
    const c = q('.cw-roic'); if (!c) return;
    c.classList.toggle('draw', on); C.roiDraw = on;
    if (on) say('Drag a box over the area just above the stack outlet');
  }
  function roiWire() {
    const c = q('.cw-roic'); let st = null;
    const pt = e => { const vr = vidRect(), r = c.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left - vr.x) / vr.w)), y: Math.min(1, Math.max(0, (e.clientY - r.top - vr.y) / vr.h)) } };
    c.addEventListener('pointerdown', e => { if (!C.roiDraw) return; st = pt(e); c.setPointerCapture(e.pointerId); e.preventDefault() });
    c.addEventListener('pointermove', e => { if (!st) return; const p = pt(e); drawRoi({ x: Math.min(st.x, p.x), y: Math.min(st.y, p.y), w: Math.abs(p.x - st.x), h: Math.abs(p.y - st.y) }) });
    c.addEventListener('pointerup', e => { if (!st) return; const p = pt(e); const roi = { x: Math.min(st.x, p.x), y: Math.min(st.y, p.y), w: Math.abs(p.x - st.x), h: Math.abs(p.y - st.y) }; st = null; roiMode(false);
      if (roi.w > 0.03 && roi.h > 0.03) { C.roi = roi; save('cwRoi', roi); C.rbuf = []; C.rref = null; C.rrefWant = true; say('Plume area saved. Its current look is taken as the clear view.') } drawRoi() });
  }

  /* ---------- incidents ---------- */
  function snapshot() {
    const v = q('video'); if (!v || !v.videoWidth) return '';
    const c = document.createElement('canvas'); const w = 480, h = Math.round(w * v.videoHeight / v.videoWidth);
    c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(v, 0, 0, w, h);
    if (C.roi) { x.strokeStyle = '#ffd400'; x.setLineDash([6, 4]); x.lineWidth = 2; x.strokeRect(C.roi.x * w, C.roi.y * h, C.roi.w * w, C.roi.h * h); x.setLineDash([]) }
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, h - 22, w, 22); x.fillStyle = '#fff'; x.font = '600 12px monospace';
    x.fillText(`CAM 1 · ${C.unit ? C.unit.id : ''} · ${new Date().toLocaleString('en-IN')}`, 8, h - 7);
    return c.toDataURL('image/jpeg', 0.72);
  }
  function raise(k, s, now) {
    const t = TYPES[k], d = new Date();
    let desc = t.desc;
    if (k === 'mismatch') desc = `A plume (index ${Math.round(C.pE)} of 100, ${C.pType || 'plume'}) has been visible above the stack for ${T.xHold} seconds while OCEMS reports ${C.oc.toFixed(1)} mg/Nm³ against a limit of ${LIM}. OCEMS values in this demo are illustrative.`;
    if (k === 'nodata') desc = `A plume (index ${Math.round(C.pE)} of 100) has been visible for ${T.xHold} seconds while OCEMS is sending no data. OCEMS values in this demo are illustrative.`;
    const inc = { id: 'cw' + Date.now(), k, label: t.label, desc, at: d, held: TYPES[k].x ? T.xHold : T.hold, img: k === 'lost' ? '' : snapshot(), mail: C.email ? 'sending' : 'off', ack: false, cleared: null };
    s.open = inc; C.inc.unshift(inc); C.inc = C.inc.slice(0, 12);
    chime(); drawInc(); say(`${t.label} at ${C.unit ? C.unit.id : 'stack camera'}. Alert raised.`);
    publish(inc);
    if (C.email) sendMail(inc);
  }
  function clearInc(inc, now) { inc.cleared = new Date(); drawInc() }
  async function sendMail(inc) {
    const u = C.unit || {};
    try {
      const r = await fetch(RELAY + '/alert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit: u.id, unitName: u.name, ro: u.ro, label: inc.label, desc: inc.desc, time: inc.at.toLocaleString('en-IN'), held: inc.held + ' seconds', image: (inc.img || '').split(',')[1] || '' })
      });
      inc.mail = r.ok ? 'sent' : 'failed';
    } catch (e) { inc.mail = 'failed' }
    drawInc();
  }
  function drawInc() {
    const box = q('.cw-inc'); if (!box) return;
    if (!C.inc.length) return;
    const mt = { sending: '<span class="cw-tag y">Emailing…</span>', sent: '<span class="cw-tag g">Email sent</span>', failed: '<span class="cw-tag r">Email failed</span>', off: '' };
    box.innerHTML = C.inc.map(i => `<div class="cw-incard ${i.cleared ? 'cleared' : ''}">
      ${i.img ? `<img src="${i.img}" alt="Snapshot">` : `<div style="width:96px;height:54px;border-radius:6px;background:#0f1a15;color:#9fb3a8;display:grid;place-items:center;font-size:11px;flex:none">No video</div>`}
      <div style="min-width:0"><div class="h">${esc(i.label)}${mt[i.mail] || ''}</div>
      <div class="m">${fmtT(i.at)} · held ${i.held}s${i.cleared ? ` · cleared ${fmtT(i.cleared)}` : ' · ongoing'}</div>
      <div class="a">${i.ack ? '<span class="cw-tag g">Acknowledged</span>' : `<button class="cw-btn" data-ack="${i.id}">Acknowledge</button><button class="cw-btn" data-asg="${i.id}">Assign to RO</button>`}</div></div></div>`).join('');
    box.querySelectorAll('[data-ack]').forEach(b => b.onclick = () => { const i = C.inc.find(x => x.id === b.dataset.ack); i.ack = true; drawInc(); say('Alert acknowledged') });
    box.querySelectorAll('[data-asg]').forEach(b => b.onclick = () => { const i = C.inc.find(x => x.id === b.dataset.asg); i.ack = true; drawInc(); say(`Assigned to Regional Office ${C.unit ? C.unit.ro : ''} for a site check (demo)`) });
  }
  function publish(inc) {
    const u = C.unit || {};
    const list = load('eipCamAlerts', []);
    list.unshift({ id: inc.id, unit: u.id, unitName: u.name, ro: u.ro, label: inc.label, at: inc.at.toISOString() });
    save('eipCamAlerts', list.slice(0, 20));
  }

  /* ---------- tuning panel ---------- */
  function tuneUI() {
    C.tuneOpen = true;
    const rows = [['hold', 'Seconds a condition must hold', 1], ['dark', 'Covered if brightness below', 1], ['detAbs', 'Covered if detail below', 0.1], ['detRel', '…or below this share of normal detail', 0.05], ['frozen', 'Frozen if change between frames below', 0.01], ['moved', 'Moved if difference from normal view above', 0.05], ['flame', 'Flame if extra flame-coloured share above', 0.0005], ['cooldown', 'Seconds before the same alert can repeat', 1]];
    q('.cw-tune').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b>Tuning</b><span class="cw-note" style="margin:0">Live readings on the left, thresholds on the right. Saved on this device.</span></div>
      <table><tbody>
      <tr><td>Brightness</td><td><b data-m="mean"></b></td><td>Covered if below</td><td><input data-t="dark" type="number" step="1"></td></tr>
      <tr><td>Detail (normal)</td><td><b data-m="det"></b> <span data-m="refdet"></span></td><td>Covered if below / share of normal</td><td><input data-t="detAbs" type="number" step="0.1"> <input data-t="detRel" type="number" step="0.05"></td></tr>
      <tr><td>Change between frames</td><td><b data-m="diff"></b></td><td>Frozen if below</td><td><input data-t="frozen" type="number" step="0.01"></td></tr>
      <tr><td>Difference from normal view</td><td><b data-m="view"></b></td><td>Moved if above</td><td><input data-t="moved" type="number" step="0.05"></td></tr>
      <tr><td>Flame-coloured share</td><td><b data-m="flame"></b></td><td>Flame if extra share above</td><td><input data-t="flame" type="number" step="0.0005"></td></tr>
      <tr><td colspan="2">Hold time and repeat gap (seconds)</td><td>Hold / cooldown</td><td><input data-t="hold" type="number" step="1"> <input data-t="cooldown" type="number" step="1"></td></tr>
      <tr><td>Plume: movement / colour limit</td><td><b data-m="pidx"></b></td><td>Moving if change above / grey if colour below</td><td><input data-t="xStd" type="number" step="0.5"> <input data-t="xSat" type="number" step="0.05"></td></tr>
      <tr><td colspan="2">Cross-check: plume index and seconds to flag</td><td>Index / seconds / OCEMS share of limit</td><td><input data-t="xPlume" type="number" step="1"> <input data-t="xHold" type="number" step="1"> <input data-t="xLow" type="number" step="0.05"></td></tr>
      </tbody></table><div class="cw-foot"><button class="cw-btn cw-tdef">Restore defaults</button><button class="cw-btn cw-tclr">Clear alert history</button></div>`;
    q('.cw-tune').querySelectorAll('[data-t]').forEach(inp => { inp.value = T[inp.dataset.t]; inp.onchange = () => { const v = parseFloat(inp.value); if (!isNaN(v)) { T[inp.dataset.t] = v; save('cwTune', pick()) } } });
    q('.cw-tdef').onclick = () => { Object.assign(T, DEF); save('cwTune', {}); tuneUI() };
    q('.cw-tclr').onclick = () => { save('eipCamAlerts', []); C.inc = []; const box = q('.cw-inc'); if (box) box.innerHTML = '<div class="cw-note" style="margin:0">No alerts yet.</div>'; say('Alert history cleared, including the Command centre') };
    void rows;
  }
  const pick = () => { const o = {}; for (const k in DEF) if (T[k] !== DEF[k]) o[k] = T[k]; return o };
  function tuneValues() {
    const m = C.metrics || {}, tb = q('.cw-tune'); if (!tb || tb.hidden) { C.tuneOpen = false; return }
    const set = (k, v, on) => { const e = tb.querySelector(`[data-m="${k}"]`); if (e) { e.textContent = v; e.classList.toggle('on', !!on) } };
    set('mean', m.mean != null ? m.mean.toFixed(0) : '–', C.st.covered && C.st.covered.since);
    set('det', m.det != null ? m.det.toFixed(2) : '–', C.st.covered && C.st.covered.since);
    set('refdet', C.ref ? `(normal ${C.ref.det.toFixed(2)})` : '(learning)');
    set('diff', m.diff != null && m.diff < 90 ? m.diff.toFixed(3) : '–', C.st.frozen && C.st.frozen.since);
    set('view', m.view != null ? m.view.toFixed(2) : '–', C.st.moved && C.st.moved.since);
    set('flame', m.flame != null ? (m.flame * 100).toFixed(2) + '%' : '–', C.st.flame && C.st.flame.since);
    set('pidx', C.pE != null ? Math.round(C.pE) + ' / 100' : '–', C.pE >= T.xPlume);
  }

  /* ---------- public API ---------- */
  window.CamWatch = {
    attach(slot, unit) {
      if (!slot) return;
      if (C.el && C.unit && unit && C.unit.id !== unit.id) { stop(false); C.inc = []; C.el = null }
      if (!C.el) build(unit);
      C.unit = unit;
      slot.appendChild(C.el);
      const v = q('video'); if (v && v.srcObject) v.play().catch(() => {});
    },
    stop: () => stop(true),
    alerts: () => load('eipCamAlerts', []),
    clearAlerts: () => save('eipCamAlerts', []),
    _state: C,
  };
})();
