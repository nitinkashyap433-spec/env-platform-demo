/* Live plume and opacity reading, in the browser.
   Finds smoke with a general-purpose vision model (CLIPSeg, prompted with the word "smoke"),
   then applies the same rules as the stack_smoke_monitor notebook:
   too dark -> skip; marks under 1% -> no plume; compare plume with the background just around it;
   dark smoke gets opacity = 1 - plume/background and Ringelmann = opacity x 5. */

export const CFG = { prompt: 'smoke', threshold: 0.4, minArea: 0.01, faint: 0.10, nightLevel: 60, work: 352, window: 20 };
const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js';
const MODEL = 'Xenova/clipseg-rd64-refined';
const COLOURS = { 'dark smoke': [255, 40, 40], 'white plume': [40, 120, 255], mixed: [255, 170, 0], unclear: [255, 170, 0], 'faint plume': [150, 150, 150] };
const FACTS = ["Rajasthan is India's largest state by area.", "The Thar is the world's most densely populated desert.", "The Aravallis are older than the Himalayas.", "Guru Shikhar is the Aravallis' highest peak.", "Sambhar is India's largest inland salt lake.", "The Chambal is home to most wild gharials.", "Keoladeo, Bharatpur, is a UNESCO bird sanctuary.", "Sariska was first to bring tigers back by relocation.", "The camel is Rajasthan's state animal.", "The godawan is Rajasthan's state bird.", "Khejri is Rajasthan's state tree.", "Jaipur was painted pink in 1876.", "Jaipur is a UNESCO World Heritage City.", "Jantar Mantar has the world's largest stone sundial.", "Kumbhalgarh has the world's second longest wall.", "People still live inside Jaisalmer Fort.", "The Taj Mahal's marble came from Makrana.", "Rajasthan leads India in solar power.", "Bhadla is among the world's largest solar parks.", "Rajasthan grows the most bajra in India.", "Rajasthan grows the most mustard in India.", "Mount Abu is Rajasthan's only hill station.", "Jodhpur is called the Sun City.", "Pushkar hosts one of the largest camel fairs.", "Noise counts as air pollution in Indian law."];

/* ---------------- the rules (pure functions, same as the notebook) ---------------- */
function median(arr) {
  if (!arr.length) return NaN;
  const a = Float32Array.from(arr).sort(); const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}
function dilate(src, w, h, k) {            // square k x k max filter, pixels outside the image ignored
  const r = k >> 1, tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0; for (let d = Math.max(0, x - r); d <= Math.min(w - 1, x + r) && !m; d++) m = src[y * w + d];
    tmp[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0; for (let d = Math.max(0, y - r); d <= Math.min(h - 1, y + r) && !m; d++) m = tmp[d * w + x];
    out[y * w + x] = m;
  }
  return out;
}
/* lum: Float32Array of grey levels 0-255, mask: Uint8Array 0/1, both w x h */
export function rules(lum, mask, w, h) {
  const r = { status: 'day', plume: 'none', area: 0, opacity: NaN, dark_share: NaN, ringelmann: NaN };
  const top = lum.subarray(0, Math.max(1, h >> 1) * w);
  if (median(top) < CFG.nightLevel) { r.status = 'too dark'; return r; }
  let n = 0; for (let i = 0; i < mask.length; i++) n += mask[i];
  r.area = n / mask.length;
  if (r.area < CFG.minArea) return r;
  const k = Math.max(5, Math.floor(0.04 * Math.max(w, h))) | 1;
  const near = dilate(mask, w, h, 5), wide = dilate(mask, w, h, k);
  const ring = [], px = [];
  for (let i = 0; i < mask.length; i++) { if (wide[i] && !near[i]) ring.push(lum[i]); if (mask[i]) px.push(lum[i]); }
  if (ring.length < 50) { r.plume = 'unclear'; return r; }
  const bg = median(ring);
  let nd = 0; for (const v of px) if (v < bg) nd++;
  r.dark_share = nd / px.length;
  if (r.dark_share > 0.6) {
    let s = 0; for (const v of px) if (v < bg) s += Math.min(1, Math.max(0, 1 - v / Math.max(bg, 1)));
    r.opacity = s / nd;
    if (r.opacity < CFG.faint) r.plume = 'faint plume';
    else { r.plume = 'dark smoke'; r.ringelmann = Math.floor(5 * r.opacity + 0.5); }
  } else if (r.dark_share < 0.4) {
    let s = 0, c = 0; for (const v of px) if (!(v < bg)) { s += Math.min(1, Math.max(0, (v - bg) / Math.max(255 - bg, 1))); c++; }
    r.plume = (c ? s / c : 0) < CFG.faint ? 'faint plume' : 'white plume';
  } else r.plume = 'mixed';
  return r;
}
/* verdict over recent readings: a plume must show in at least one reading in five, then the commonest kind wins */
export function verdict(rs) {
  const day = rs.filter(r => r.status === 'day');
  if (!day.length) return 'too dark, not assessed';
  const f = p => day.filter(r => p.includes(r.plume)).length / day.length;
  const kinds = { 'dark smoke': f(['dark smoke']), 'white or unclear plume': f(['white plume', 'mixed', 'unclear']), 'faint plume': f(['faint plume']) };
  if (Object.values(kinds).reduce((a, b) => a + b, 0) < 0.2) return 'no visible emission';
  return Object.entries(kinds).sort((a, b) => b[1] - a[1])[0][0];
}

/* ---------------- the page part ---------------- */
const CSS = `
.pl-card{position:relative}
.pl-ldr{border:1px solid var(--line,#dfe7e2);border-radius:12px;background:#f4f8f5;padding:22px 16px;text-align:center}
.pl-ldr img{width:32px;height:32px;border-radius:50%;margin-bottom:6px}
.pl-ldr .t{font-weight:700;color:#14261c}
.pl-ldr .s{font-size:13px;color:#5d6b63;margin-top:4px;min-height:18px}
.pl-ldr .bar{height:4px;border-radius:4px;background:#dde8e0;margin:12px auto 6px;max-width:360px;overflow:hidden}
.pl-ldr .bar i{display:block;height:100%;width:0;background:#2f8f5b;border-radius:4px;transition:width .25s ease}
.pl-ldr .mb{font-size:11.5px;color:#8a9a90}
.pl-ldr .f{margin-top:14px;font-size:12px;color:#9fada5;min-height:34px;transition:opacity .45s ease,transform .45s ease}
.pl-ldr .f b{display:block;font-weight:600;color:#8a9a90;margin-bottom:3px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase}
.pl-ldr .f.fade{opacity:0;transform:translateY(4px)}
.pl-ldr .err{color:#8a4b00;font-size:13px;margin-top:10px}
.pl-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start}
@media (max-width:900px){.pl-grid{grid-template-columns:1fr}}
.pl-stage{position:relative;background:#0f1a14;border-radius:10px;overflow:hidden;min-height:220px;display:flex;align-items:center;justify-content:center}
.pl-stage canvas{display:block;cursor:crosshair;touch-action:none;max-width:100%}
.pl-stage .ph{color:#b9c9bf;font-size:13px;padding:30px 16px;text-align:center;line-height:1.6}
.pl-btns{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0}
.pl-side{border:1px solid var(--line,#dfe7e2);border-radius:10px;padding:12px}
.pl-type{display:inline-block;font-weight:700;font-size:15px;padding:4px 10px;border-radius:8px;background:#eef1ef;color:#3d4a42}
.pl-rg{display:flex;gap:4px;margin:10px 0 2px}
.pl-rg div{flex:1;height:26px;border-radius:5px;border:2px solid transparent;transition:border-color .3s,transform .3s}
.pl-rg div.on{border-color:#c0392b;transform:translateY(-2px)}
.pl-rgl{display:flex;gap:4px;font-size:11px;color:#8a9a90}.pl-rgl span{flex:1;text-align:center}
.pl-num{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}
.pl-num div{background:#f6f9f7;border-radius:8px;padding:8px}
.pl-num b{display:block;font-size:20px;color:#14261c;font-variant-numeric:tabular-nums}
.pl-num span{font-size:11.5px;color:#5d6b63}
.pl-ver{font-size:13px;margin:8px 0;line-height:1.5}
.pl-meta{font-size:11.5px;color:#8a9a90;font-variant-numeric:tabular-nums;margin-top:6px}
.pl-chart{width:100%;height:90px;display:block;margin-top:6px}
`;

export function mount(el) {
  if (!document.getElementById('pl-css')) { const s = document.createElement('style'); s.id = 'pl-css'; s.textContent = CSS; document.head.appendChild(s); }
  const S = { model: null, running: false, box: null, hist: [], reads: 0, lastMs: 0, rate: 0, maskCv: null, maskA: 0, view: null, disp: { op: 0, area: 0 }, tgt: { op: 0, area: 0 }, last: null, stream: null };
  el.innerHTML = `<div class="card mt pl-card"><div class="card-h"><h2>Live reading</h2><span class="small muted pl-st">Runs on this computer. Nothing is uploaded.</span></div>
   <div class="pl-body"><p class="small" style="margin:0 0 10px;line-height:1.6">Play a stack video, share a window, or point a camera at a stack. The page finds the plume and grades its darkness as the video plays. It needs a one-time download of about 115 to 140 MB. After that it opens quickly.</p>
   <button class="btn primary pl-go">Start live reading</button></div></div>`;
  const q = s => el.querySelector(s);
  q('.pl-go').onclick = () => load();
  try { if (sessionStorage.getItem('plAutoStart') === '1') { sessionStorage.removeItem('plAutoStart'); setTimeout(load, 300); } } catch (e) { }

  async function load() {
    const fi = Math.floor(Math.random() * FACTS.length);
    q('.pl-body').innerHTML = `<div class="pl-ldr"><img src="images/logo.png" alt="" onerror="this.style.display='none'"><div class="t">Getting the vision model ready</div>
      <div class="s">Loading the reading tools</div><div class="bar"><i></i></div><div class="mb">&nbsp;</div>
      <div class="f"><b>Did you know?</b>${FACTS[fi]}</div><div class="err" hidden></div></div>`;
    let k = fi + 1; const fe = q('.pl-ldr .f');
    const rot = setInterval(() => { fe.classList.add('fade'); setTimeout(() => { fe.innerHTML = '<b>Did you know?</b>' + FACTS[k++ % FACTS.length]; fe.classList.remove('fade'); }, 450); }, 3200);
    const files = {};
    const prog = p => {
      if (p.status === 'progress' && p.total) files[p.file] = [p.loaded, p.total];
      if (p.status === 'done' && files[p.file]) files[p.file][0] = files[p.file][1];
      let a = 0, b = 0; for (const [l, t] of Object.values(files)) { a += l; b += t; }
      if (b > 1e6) { q('.pl-ldr .bar i').style.width = (100 * a / b).toFixed(1) + '%'; q('.pl-ldr .mb').textContent = `${(a / 1e6).toFixed(0)} of ${(b / 1e6).toFixed(0)} MB`; q('.pl-ldr .s').textContent = 'Downloading the vision model'; }
    };
    let stage = 'loading the reading tools';
    try {
      const T = await import(/* webpackIgnore: true */ TJS);
      // Pick one path before downloading. Mixing two attempts in one page can leave the runtime broken.
      let dev = 'wasm', dtype = 'q8', forced = false;
      try { forced = localStorage.getItem('plForceWasm') === '1'; } catch (e) { }
      if (!forced && navigator.gpu) {
        try {
          const ad = await navigator.gpu.requestAdapter();
          if (ad) { dev = 'webgpu'; dtype = ad.features.has('shader-f16') ? 'q4f16' : 'q4'; }
        } catch (e) { }
      }
      stage = 'downloading the model';
      const model = await T.CLIPSegForImageSegmentation.from_pretrained(MODEL, { dtype, device: dev, progress_callback: prog });
      S.dev = dev === 'webgpu' ? 'graphics chip' : 'processor';
      q('.pl-ldr .s').textContent = 'Preparing'; q('.pl-ldr .bar i').style.width = '100%';
      stage = 'loading the text tools';
      const tok = await T.AutoTokenizer.from_pretrained(MODEL), proc = await T.AutoProcessor.from_pretrained(MODEL);
      S.T = T; S.model = model; S.proc = proc; S.text = tok([CFG.prompt], { padding: true, truncation: true });
      stage = 'a first test reading';                           // catches a model that loads but cannot run
      const probe = new T.RawImage(new Uint8ClampedArray(64 * 64 * 3).fill(180), 64, 64, 3);
      const out = await model({ ...S.text, ...(await proc(probe)) }); out.logits.dispose?.();
      clearInterval(rot); ui();
    } catch (e) {
      clearInterval(rot); console.error('plume reader failed at', stage, e);
      let forced = false; try { forced = localStorage.getItem('plForceWasm') === '1'; } catch (x) { }
      const er = q('.pl-ldr .err'); er.hidden = false;
      if (!forced && S.dev !== 'processor' && navigator.gpu) {
        // the graphics chip path failed: restart the page cleanly on the processor path
        try { localStorage.setItem('plForceWasm', '1'); sessionStorage.setItem('plAutoStart', '1'); } catch (x) { }
        er.textContent = "This computer's graphics chip could not run the model. Switching to the processor instead…";
        setTimeout(() => location.reload(), 1500);
        return;
      }
      const msg = typeof e === 'number' ? 'the model runtime stopped, code ' + e : String(e.message || e).slice(0, 120);
      er.innerHTML = `Couldn't start the vision model while ${stage} (${msg}). <button class="btn">Try again</button>`;
      er.querySelector('button').onclick = () => location.reload();
    }
  }

  function ui() {
    const shades = ['#ffffff', '#d6d6d6', '#a8a8a8', '#7a7a7a', '#4a4a4a', '#1c1c1c'];
    q('.pl-body').innerHTML = `<div class="pl-grid"><div>
      <div class="pl-stage"><div class="ph">Choose a source below. Then drag on the picture to draw a box around one stack, with open sky above it.</div><canvas hidden></canvas></div>
      <div class="pl-btns"><label class="btn">Play a video file<input type="file" accept="video/*" hidden class="pl-file"></label>
       <button class="btn pl-share">Share a window or tab</button><button class="btn pl-cam">This device's camera</button>
       <button class="btn pl-pp" hidden>Pause</button><button class="btn pl-clr" hidden>Clear box</button><button class="btn pl-stop" hidden>Stop</button></div></div>
     <div class="pl-side"><div class="small muted">Plume</div><div class="pl-type">Waiting</div>
      <div class="small muted" style="margin-top:12px">Ringelmann, dark smoke only</div>
      <div class="pl-rg">${shades.map(c => `<div style="background:${c};outline:1px solid var(--line,#dfe7e2)"></div>`).join('')}</div>
      <div class="pl-rgl">${shades.map((c, i) => `<span>${i}</span>`).join('')}</div>
      <div class="pl-num"><div><b class="pl-op">–</b><span>opacity</span></div><div><b class="pl-ar">–</b><span>plume area, share of view</span></div></div>
      <div class="pl-ver"><span class="muted small">Last ${CFG.window} readings:</span> <b class="pl-vd">–</b></div>
      <canvas class="pl-chart"></canvas><div class="small muted" style="display:flex;gap:12px"><span><span style="color:#8a9a90">━</span> area</span><span><span style="color:#c0392b">━</span> opacity</span></div>
      <div class="pl-meta">–</div></div></div>
     <p class="small muted" style="margin:10px 0 0;line-height:1.55">Readings describe how the plume looks, not mg/Nm³. White plumes can be steam or dust. Frames that are too dark are skipped.</p>`;
    const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.loop = true;
    video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none'; q('.pl-stage').appendChild(video);
    S.video = video; S.cv = q('.pl-stage canvas'); S.ctx = S.cv.getContext('2d');
    q('.pl-file').onchange = e => { const f = e.target.files[0]; if (!f) return; stopStream(); video.srcObject = null; video.src = URL.createObjectURL(f); start(); };
    q('.pl-share').onclick = async () => { try { const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); useStream(s); } catch (e) { note('Screen sharing was cancelled or is not allowed here.'); } };
    q('.pl-cam').onclick = async () => { try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); useStream(s); } catch (e) { note('No camera available, or permission was refused.'); } };
    q('.pl-pp').onclick = () => { if (video.paused) video.play(); else video.pause(); };
    q('.pl-clr').onclick = () => { S.box = null; };
    q('.pl-stop').onclick = stop;
    boxDrawing();
  }
  function note(t) { q('.pl-meta').textContent = t; }
  function stopStream() { if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; } }
  function useStream(s) { stopStream(); S.stream = s; S.video.removeAttribute('src'); S.video.srcObject = s; s.getVideoTracks()[0].onended = stop; start(); }
  function start() {
    S.hist = []; S.reads = 0; S.last = null; S.maskCv = null; S.box = null;
    S.video.play().catch(() => { });
    q('.pl-stage .ph').hidden = true; S.cv.hidden = false;
    ['.pl-pp', '.pl-clr', '.pl-stop'].forEach(s => q(s).hidden = false);
    q('.pl-type').textContent = 'Reading the first frame…'; q('.pl-type').style.cssText = '';
    if (!S.running) { S.running = true; loop(); requestAnimationFrame(paint); }
  }
  function stop() {
    S.running = false; stopStream(); S.video.pause(); S.video.removeAttribute('src'); S.video.srcObject = null;
    S.cv.hidden = true; q('.pl-stage .ph').hidden = false; ['.pl-pp', '.pl-clr', '.pl-stop'].forEach(s => q(s).hidden = true);
    q('.pl-type').textContent = 'Waiting'; q('.pl-type').style.cssText = '';
  }
  function boxDrawing() {
    let a = null;
    const pt = e => { const r = S.cv.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    S.cv.addEventListener('pointerdown', e => { a = pt(e); S.drag = [a[0], a[1], a[0], a[1]]; S.cv.setPointerCapture(e.pointerId); });
    S.cv.addEventListener('pointermove', e => { if (a) { const b = pt(e); S.drag = [a[0], a[1], b[0], b[1]]; } });
    S.cv.addEventListener('pointerup', () => {
      if (!a) return; const [x0, y0, x1, y1] = S.drag; a = null; S.drag = null;
      if (Math.abs(x1 - x0) > 0.04 && Math.abs(y1 - y0) > 0.04) { S.box = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]; S.maskCv = null; S.hist = []; }
      else if (S.video.paused) S.video.play(); else S.video.pause();
    });
  }

  /* one reading at a time, as fast as the computer allows */
  async function loop() {
    const wcv = document.createElement('canvas'), wctx = wcv.getContext('2d', { willReadFrequently: true });
    while (S.running) {
      const v = S.video;
      if (v.readyState < 2 || v.paused || !v.videoWidth) { await new Promise(r => setTimeout(r, 200)); continue; }
      const t0 = performance.now();
      const [bx0, by0, bx1, by1] = S.box || [0, 0, 1, 1];
      const sx = bx0 * v.videoWidth, sy = by0 * v.videoHeight, sw = (bx1 - bx0) * v.videoWidth, sh = (by1 - by0) * v.videoHeight;
      const sc = CFG.work / Math.max(sw, sh), w = Math.max(8, Math.round(sw * sc)), h = Math.max(8, Math.round(sh * sc));
      wcv.width = w; wcv.height = h; wctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
      const px = wctx.getImageData(0, 0, w, h).data;
      const lum = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) lum[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2];
      let mask = new Uint8Array(w * h), reading;
      const darkTop = median(lum.subarray(0, Math.max(1, h >> 1) * w)) < CFG.nightLevel;
      if (!darkTop) {
        try {
          const img = new S.T.RawImage(new Uint8ClampedArray(px), w, h, 4).rgb();
          const inp = await S.proc(img);
          const out = await S.model({ ...S.text, ...inp });
          const L = out.logits, dims = L.dims, lh = dims[dims.length - 2], lw = dims[dims.length - 1], d = await L.getData?.() ?? L.data;
          for (let y = 0; y < h; y++) {                       // bilinear resize of the 352x352 map to w x h
            const fy = Math.max(0, (y + 0.5) * lh / h - 0.5), y0 = Math.floor(fy), y1 = Math.min(lh - 1, y0 + 1), ty = fy - y0;
            for (let x = 0; x < w; x++) {
              const fx = Math.max(0, (x + 0.5) * lw / w - 0.5), x0 = Math.floor(fx), x1 = Math.min(lw - 1, x0 + 1), tx = fx - x0;
              const z = (d[y0 * lw + x0] * (1 - tx) + d[y0 * lw + x1] * tx) * (1 - ty) + (d[y1 * lw + x0] * (1 - tx) + d[y1 * lw + x1] * tx) * ty;
              mask[y * w + x] = 1 / (1 + Math.exp(-z)) > CFG.threshold ? 1 : 0;
            }
          }
          L.dispose?.(); Object.values(inp).forEach(t => t.dispose?.());
        } catch (e) { console.error(e); note('Reading failed: ' + String(e.message || e).slice(0, 80)); await new Promise(r => setTimeout(r, 1000)); continue; }
      }
      reading = rules(lum, mask, w, h);
      const ms = performance.now() - t0;
      S.reads++; S.lastMs = ms; S.rate = S.rate ? 0.8 * S.rate + 0.2 * (1000 / ms) : 1000 / ms;
      S.hist.push(reading); if (S.hist.length > 60) S.hist.shift();
      // the mask picture used by the painter
      const mc = document.createElement('canvas'); mc.width = w; mc.height = h;
      if (reading.status === 'day' && reading.plume !== 'none') {
        const c = COLOURS[reading.plume] || COLOURS.mixed, id = mc.getContext('2d').createImageData(w, h);
        for (let i = 0; i < w * h; i++) if (mask[i]) { id.data[4 * i] = c[0]; id.data[4 * i + 1] = c[1]; id.data[4 * i + 2] = c[2]; id.data[4 * i + 3] = 80; }
        mc.getContext('2d').putImageData(id, 0, 0);
      }
      S.prevMask = S.maskCv; S.maskCv = mc; S.maskT = performance.now(); S.last = reading;
      S.tgt.op = reading.plume === 'dark smoke' ? reading.opacity : 0; S.tgt.area = reading.area;
      side(reading);
      await new Promise(r => setTimeout(r, 30));
    }
  }

  function side(r) {
    const tp = q('.pl-type');
    const lbl = r.status === 'too dark' ? 'Too dark, skipped' : r.plume === 'none' ? 'No plume' : r.plume[0].toUpperCase() + r.plume.slice(1);
    const c = r.status === 'day' && COLOURS[r.plume];
    tp.textContent = lbl; tp.style.background = c ? `rgba(${c},.16)` : '#eef1ef'; tp.style.color = c ? `rgb(${c.map(x => Math.round(x * 0.7))})` : '#3d4a42';
    q('.pl-rg').querySelectorAll('div').forEach((d, i) => d.classList.toggle('on', r.plume === 'dark smoke' && i === r.ringelmann));
    q('.pl-vd').textContent = verdict(S.hist.slice(-CFG.window));
    q('.pl-meta').textContent = `Reading ${S.reads} · ${S.rate.toFixed(1)} per second · ${Math.round(S.lastMs)} ms each · on this computer's ${S.dev}`;
    chart();
  }
  function chart() {
    const c = q('.pl-chart'), W = c.clientWidth || 260, H = 90; c.width = W * 2; c.height = H * 2; const g = c.getContext('2d'); g.scale(2, 2);
    g.clearRect(0, 0, W, H); g.strokeStyle = '#e3eae5'; g.lineWidth = 1; [0, .5, 1].forEach(v => { g.beginPath(); g.moveTo(0, H - 4 - v * (H - 8)); g.lineTo(W, H - 4 - v * (H - 8)); g.stroke(); });
    const hs = S.hist, n = 60, X = i => W * (i + n - hs.length) / (n - 1), Y = v => H - 4 - Math.min(1, v) * (H - 8);
    const line = (f, col) => { g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); let on = false; hs.forEach((r, i) => { const v = f(r); if (v == null || isNaN(v)) { on = false; return; } if (!on) { g.moveTo(X(i), Y(v)); on = true; } else g.lineTo(X(i), Y(v)); }); g.stroke(); };
    line(r => r.status === 'day' ? Math.min(1, r.area * 4) : null, '#8a9a90');
    line(r => r.plume === 'dark smoke' ? r.opacity : null, '#c0392b');
  }

  /* drawing at screen rate, so the picture and numbers move smoothly between readings */
  function paint() {
    if (!S.running) return;
    const v = S.video, cv = S.cv, ctx = S.ctx;
    if (v.videoWidth) {
      const st = cv.parentNode, ar = v.videoWidth / v.videoHeight, mh = Math.max(220, window.innerHeight * 0.62);
      const W = Math.round(Math.min(st.clientWidth || 640, mh * ar)), H = Math.round(W / ar);
      if (cv.style.width !== W + 'px') { cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
      if (cv.width !== W * 2) { cv.width = W * 2; cv.height = H * 2; }
      ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.drawImage(v, 0, 0, W, H);
      const [x0, y0, x1, y1] = S.box || [0, 0, 1, 1];
      const k = Math.min(1, (performance.now() - (S.maskT || 0)) / 350);
      ctx.imageSmoothingEnabled = true; ctx.filter = `blur(${Math.max(2, W / 160)}px)`;
      if (S.prevMask && k < 1) { ctx.globalAlpha = 1 - k; ctx.drawImage(S.prevMask, x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H); }
      if (S.maskCv) { ctx.globalAlpha = k; ctx.drawImage(S.maskCv, x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H); }
      ctx.globalAlpha = 1; ctx.filter = 'none';
      const bx = S.drag || S.box;
      if (bx) { ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(Math.min(bx[0], bx[2]) * W, Math.min(bx[1], bx[3]) * H, Math.abs(bx[2] - bx[0]) * W, Math.abs(bx[3] - bx[1]) * H); ctx.setLineDash([]); }
      ctx.font = '600 12px system-ui,sans-serif'; const tag = v.paused ? 'PAUSED' : `LIVE · reading ${S.reads}`;
      const tw = ctx.measureText(tag).width; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(8, 8, tw + 26, 22);
      ctx.fillStyle = v.paused ? '#bbb' : (performance.now() % 1000 < 600 ? '#ff4d4d' : '#802626'); ctx.beginPath(); ctx.arc(18, 19, 4, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(tag, 28, 23);
      // numbers glide toward the latest reading
      S.disp.op += (S.tgt.op - S.disp.op) * 0.15; S.disp.area += (S.tgt.area - S.disp.area) * 0.15;
      const r = S.last;
      q('.pl-op').textContent = r && r.plume === 'dark smoke' ? Math.round(100 * S.disp.op) + '%' : '–';
      q('.pl-ar').textContent = r && r.status === 'day' ? (100 * S.disp.area).toFixed(1) + '%' : '–';
      q('.pl-pp').textContent = v.paused ? 'Play' : 'Pause';
    }
    requestAnimationFrame(paint);
  }
  return { stop };
}
