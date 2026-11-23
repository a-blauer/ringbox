/* RingBox scanner: reads a card's title band and collector number (e.g. "1R89") with
   on-device OCR (Tesseract, bundled), then fuzzy-matches against the card database. */
'use strict';
window.Scanner = (() => {
  const R = window.RB;
  const { $, $$, esc, card, IMG, norm, codeKey, fullName } = R;
  const abs = p => new URL(p, location.href).href;
  let workerP = null, stream = null, track = null, video = null, on = false, busy = false, torch = false, timer = null;
  let stable = { id: null, n: 0 }, lastAdded = null, blank = 0, lastCands = [], root = null, status = '';
  let titles = null, codeP = null, caps = {}, cams = [], peak = 0, focusT = null;

  /* ---------- OCR ---------- */
  function loadScript(src) { return new Promise((res, rej) => { if (window.Tesseract) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load OCR engine')); document.head.appendChild(s); }); }
  function getWorker() {
    if (!workerP) workerP = (async () => {
      setStatus('Loading text reader… (first time only)');
      await loadScript('vendor/tess/tesseract.min.js');
      const w = await Tesseract.createWorker('eng', 1, { workerPath: abs('vendor/tess/worker.min.js'), corePath: abs('vendor/tess/core'), langPath: abs('vendor/tess/lang'), gzip: true });
      await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      setStatus('');
      return w;
    })().catch(e => { workerP = null; throw e; });
    return workerP;
  }
  function getCodeWorker() { // second reader just for the collector number, so both bands are read at once
    if (!codeP) codeP = (async () => {
      await getWorker();
      const w = await Tesseract.createWorker('eng', 1, { workerPath: abs('vendor/tess/worker.min.js'), corePath: abs('vendor/tess/core'), langPath: abs('vendor/tess/lang'), gzip: true });
      await w.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '0123456789CURPSA+ ' });
      return w;
    })().catch(e => { codeP = null; throw e; });
    return codeP;
  }
  // focus check: variance of the Laplacian over the title band, at low resolution
  const sharpCv = document.createElement('canvas');
  function sharpness(src, r) {
    const W = 240, H = 44; sharpCv.width = W; sharpCv.height = H;
    const g = sharpCv.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, r.x + r.w * 0.04, r.y + r.h * 0.015, r.w * 0.92, r.h * 0.16, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data, y = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) y[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    let s = 0, s2 = 0, n = 0;
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) { const k = j * W + i, l = 4 * y[k] - y[k - 1] - y[k + 1] - y[k - W] - y[k + W]; s += l; s2 += l * l; n++; }
    return s2 / n - (s / n) ** 2;
  }
  // draw a region of a source onto a canvas, grayscale + auto-invert + contrast stretch
  function prep(src, sx, sy, sw, sh, outW = 1100) {
    const scale = outW / sw, cv = document.createElement('canvas');
    cv.width = Math.round(sw * scale); cv.height = Math.max(8, Math.round(sh * scale));
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    const im = g.getImageData(0, 0, cv.width, cv.height), d = im.data, n = d.length / 4;
    const hist = new Uint32Array(256); let sum = 0;
    for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = y; hist[y]++; sum += y; }
    let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.04) { lo = i; break; } }
    acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.04) { hi = i; break; } }
    const inv = sum / n < 115, span = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) { let y = Math.max(0, Math.min(255, (d[i] - lo) * 255 / span)); if (inv) y = 255 - y; d[i] = d[i + 1] = d[i + 2] = y; }
    g.putImageData(im, 0, 0);
    return cv;
  }
  async function readCard(src, rect) { // rect = card area in source pixels
    const [w, cw2] = await Promise.all([getWorker(), getCodeWorker()]);
    const { x, y, w: cw, h: ch } = rect;
    // generous bands so a card that's a little off-centre or tilted still gets read
    const band = (y0, y1) => { const sy = Math.max(0, y + ch * y0), ey = Math.min(src.videoHeight || src.naturalHeight || 1e9, y + ch * y1); const sx = Math.max(0, x - cw * 0.02); return [sx, sy, Math.min((src.videoWidth || src.naturalWidth || 1e9) - sx, cw * 1.04), Math.max(4, ey - sy)]; };
    const tCv = prep(src, ...band(-0.03, 0.2), 900);
    const cCv = prep(src, ...band(0.84, 1.03), 1100);
    const [t, c] = await Promise.all([w.recognize(tCv), cw2.recognize(cCv)]);
    return { title: t.data.text || '', code: c.data.text || '' };
  }

  /* ---------- matching ---------- */
  function lev(a, b) {
    if (a === b) return 0; const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) { cur[0] = i; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [prev, cur] = [cur, prev]; }
    return prev[n];
  }
  const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);
  function partial(line, target) { // best similarity of target against any run of words in line
    if (!target || !line) return 0;
    const ws = line.split(' '); let best = sim(line, target);
    for (let i = 0; i < ws.length; i++) { let s = ''; for (let j = i; j < ws.length; j++) { s = s ? s + ' ' + ws[j] : ws[j]; if (s.length > target.length * 1.5) break; if (s.length >= target.length * 0.6) best = Math.max(best, sim(s, target)); } }
    return best;
  }
  function buildTitles() {
    const m = new Map();
    for (const c of R.DB.cards) { if (!R.isPhysical(c) || R.DB.byId.get(c.id) !== c) continue; const k = c._t; if (k.length < 2) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(c); }
    titles = [...m].map(([t, cs]) => ({ t, cs }));
  }
  function codesIn(text) {
    const up = text.toUpperCase().replace(/[O]/g, '0').replace(/[IL|!]/g, '1').replace(/[^0-9A-Z+\s]/g, ' ');
    const out = new Set(); const re = /(\d{1,2})\s?([CURPS])\s?\+?\s?(\d{1,3})/g; let m;
    while ((m = re.exec(up))) { const k = codeKey(m[1] + m[2] + m[3]); if (R.DB.byCode.has(k)) out.add(R.DB.byCode.get(k)); }
    if (!out.size) { const re2 = /(\d{1,2})\s?[A-Z]\+?\s?(\d{1,3})/g; while ((m = re2.exec(up))) { const id = R.DB.bySetNum.get(+m[1] + '_' + +m[2]); if (id) out.add(id); } return [...out].map(id => [id, 40, 'number?']); }
    return [...out].map(id => [id, 70, 'number']);
  }
  function match(titleText, codeText) {
    if (!titles) buildTitles();
    const score = new Map(); const add = (c, s, why) => { const e = score.get(c.id) || { c, s: 0, why: [] }; e.s += s; e.why.push(why); score.set(c.id, e); };
    for (const [id, w, why] of codesIn(codeText + '\n' + titleText)) add(card(id), w, why);
    const lines = titleText.split(/\n/).map(norm).filter(l => l.replace(/ /g, '').length >= 3);
    if (lines.length) {
      for (const { t, cs } of titles) {
        if (t.length < 3) continue;
        let best = 0; for (const l of lines) { if (l.length < t.length * 0.5) continue; best = Math.max(best, partial(l, t)); }
        if (best < 0.72) continue;
        for (const c of cs) {
          let sub = 0; if (c._st) for (const l of lines) sub = Math.max(sub, partial(l, c._st));
          add(c, best * 55 + (sub > 0.65 ? sub * 22 : 0), `title ${Math.round(best * 100)}%`);
        }
      }
    }
    return [...score.values()].sort((a, b) => b.s - a.s || a.c.s - b.c.s).slice(0, 6);
  }
  const confident = cands => cands.length && cands[0].s >= 50 && (cands.length < 2 || cands[0].s - cands[1].s >= 12);

  /* ---------- camera ---------- */
  function cardRect() { // overlay frame → source pixels
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return null;
    const el = video.getBoundingClientRect(), fr = $('.frame', root).getBoundingClientRect();
    const sc = Math.max(el.width / vw, el.height / vh), ox = (el.width - vw * sc) / 2, oy = (el.height - vh * sc) / 2;
    return { x: (fr.left - el.left - ox) / sc, y: (fr.top - el.top - oy) / sc, w: fr.width / sc, h: fr.height / sc };
  }
  const openCam = deviceId => navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  // iPhones with several lenses expose a virtual "Dual Wide" / "Triple" camera that swaps to the
  // close-focus (macro) lens on its own, like the Camera app. Prefer it; otherwise the main back camera.
  function rankCam(d) { const l = d.label.toLowerCase(); if (/front|user|facetime|selfie/.test(l)) return -1; if (/triple/.test(l)) return 5; if (/dual wide/.test(l)) return 4; if (/dual/.test(l)) return 3; if (/ultra|tele|depth|infrared|ir /.test(l)) return 1; if (/back|rear|environment|camera2 0/.test(l)) return 2; return 1.5; }
  async function start(deviceId) {
    if (!navigator.mediaDevices?.getUserMedia) { setStatus('This browser has no camera access. Use “Scan a photo” instead.'); return; }
    const p = R.S.prefs;
    try {
      stream = await openCam(deviceId || p.camId);
    } catch (e) {
      if (e.name === 'OverconstrainedError' || e.name === 'NotFoundError') { p.camId = ''; try { stream = await openCam(); } catch (e2) { e = e2; } }
      if (!stream) { setStatus(e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your browser settings, or scan a photo.' : 'Could not open the camera: ' + e.message); return; }
    }
    try { // labels are only visible after permission: now pick the best lens if we didn't get it
      cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput' && rankCam(d) >= 0).sort((a, b) => rankCam(b) - rankCam(a));
      const cur = stream.getVideoTracks()[0].getSettings().deviceId;
      if (!deviceId && !p.camId && cams[0] && cams[0].deviceId && cams[0].deviceId !== cur && rankCam(cams[0]) >= 3) { stream.getTracks().forEach(t => t.stop()); stream = await openCam(cams[0].deviceId); }
    } catch { }
    track = stream.getVideoTracks()[0];
    caps = track.getCapabilities?.() || {};
    try { if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { }
    if (caps.zoom && p.zoom) try { await track.applyConstraints({ advanced: [{ zoom: Math.min(caps.zoom.max, Math.max(caps.zoom.min, p.zoom)) }] }); } catch { }
    video.srcObject = stream; await video.play().catch(() => { });
    on = true; peak = 0; $('.idle', root).hidden = true; $('#camBtn', root).textContent = 'Stop camera';
    renderCamControls();
    Promise.all([getWorker(), getCodeWorker()]).then(loop).catch(e => setStatus(e.message));
  }
  function renderCamControls() {
    const box = $('#camctl', root); if (!box) return;
    const p = R.S.prefs, st = track?.getSettings?.() || {};
    const curLabel = (cams.find(c => c.deviceId === st.deviceId) || {}).label || 'Camera';
    const zoomOk = caps.zoom && caps.zoom.max > caps.zoom.min;
    const focusOk = caps.focusDistance && caps.focusDistance.max > caps.focusDistance.min && caps.focusMode?.includes('manual');
    box.innerHTML = `
      ${cams.length > 1 ? `<div class="ctl"><label class="lbl" for="camSel">Lens</label><select id="camSel">${cams.map(c => `<option value="${esc(c.deviceId)}" ${c.deviceId === st.deviceId ? 'selected' : ''}>${esc(c.label || 'Camera')}</option>`).join('')}</select></div>` : ''}
      <div class="ctl"><label class="lbl" for="frameSz">Card size in view <span class="dim">— smaller lets you hold the phone farther back, where it focuses</span></label><input type="range" id="frameSz" min="38" max="85" step="1" value="${p.frame || 58}"></div>
      ${zoomOk ? `<div class="ctl"><label class="lbl" for="zoomR">Zoom <output id="zoomV">${(st.zoom || caps.zoom.min).toFixed(1)}×</output></label><input type="range" id="zoomR" min="${caps.zoom.min}" max="${Math.min(caps.zoom.max, 5)}" step="${caps.zoom.step || 0.1}" value="${st.zoom || caps.zoom.min}"></div>` : ''}
      ${focusOk ? `<div class="ctl"><label class="lbl" for="focR">Manual focus <span class="dim">(tap the picture to go back to auto)</span></label><input type="range" id="focR" min="${caps.focusDistance.min}" max="${caps.focusDistance.max}" step="${caps.focusDistance.step || 0.01}" value="${st.focusDistance ?? caps.focusDistance.min}"></div>` : ''}
      <p class="small dim" style="margin:0">${esc(curLabel)} · tap the picture to refocus${zoomOk ? '' : ' · if it stays blurry, shrink the card size and move the phone back'}</p>`;
    $('#torch', root).hidden = !caps.torch;
    const cs = $('#camSel', box); if (cs) cs.onchange = e => { p.camId = e.target.value; R.save(); stopStream(); start(e.target.value); };
    $('#frameSz', box).oninput = e => { p.frame = +e.target.value; R.save(); applyFrame(); };
    const zr = $('#zoomR', box); if (zr) zr.oninput = e => { const z = +e.target.value; $('#zoomV', box).textContent = z.toFixed(1) + '×'; p.zoom = z; R.save(); track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => { }); };
    const fr = $('#focR', box); if (fr) fr.oninput = e => track.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: +e.target.value }] }).catch(() => { });
  }
  function applyFrame() { const f = root && $('.frame', root); if (f) f.style.width = (R.S.prefs.frame || 58) + '%'; peak = 0; }
  async function tapFocus(ev) { // tap-to-focus where supported (Android Chrome); a nudge to refocus elsewhere
    if (!track) return;
    const vf = $('.viewfinder', root).getBoundingClientRect(), x = (ev.clientX - vf.left) / vf.width, y = (ev.clientY - vf.top) / vf.height;
    const ring = $('.focus-ring', root); ring.style.left = x * 100 + '%'; ring.style.top = y * 100 + '%'; ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go');
    const modes = caps.focusMode || [];
    try {
      const c = {}; if (caps.pointsOfInterest || 'pointsOfInterest' in (track.getSettings() || {})) c.pointsOfInterest = [{ x, y }];
      if (modes.includes('single-shot')) c.focusMode = 'single-shot'; else if (modes.includes('continuous')) c.focusMode = 'continuous';
      if (modes.includes('manual') && !c.focusMode) c.focusMode = 'manual';
      if (c.focusMode === 'continuous' && modes.includes('manual')) { await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] }); }
      await track.applyConstraints({ advanced: [c] });
      clearTimeout(focusT); if (c.focusMode === 'single-shot' && modes.includes('continuous')) focusT = setTimeout(() => track && track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => { }), 2500);
      const fr = $('#focR', root); if (fr) fr.value = track.getSettings().focusDistance ?? fr.value;
    } catch { }
    peak = 0;
  }
  function stopStream() { on = false; clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; track = null; torch = false; }
  function stop() {
    stopStream(); const cc = root && $('#camctl', root); if (cc) cc.innerHTML = '';
    if (root && $('.idle', root)) { $('.idle', root).hidden = false; $('#camBtn', root).textContent = 'Start camera'; }
  }
  async function loop() {
    if (!on) return;
    if (!busy && video.readyState >= 2) {
      busy = true;
      try {
        const r = cardRect();
        if (r) {
          const sh = sharpness(video, r); peak = Math.max(sh, peak * 0.96);
          const q = peak ? sh / peak : 0; const m = $('#focusM', root); if (m) m.style.width = Math.round(Math.min(1, q) * 100) + '%';
          if (q < 0.55 || sh < 25) setStatus(sh < 25 ? 'Line the card up inside the frame' : 'Focusing… hold steady (tap to refocus)');
          else { const txt = await readCard(video, r); handle(match(txt.title, txt.code), txt, true); }
        }
      } catch (e) { console.warn(e); }
      busy = false;
    }
    timer = setTimeout(loop, 60);
  }
  function handle(cands, txt, live) {
    lastCands = cands; renderCands(txt);
    const fr = $('.frame', root);
    if (!confident(cands)) { if (++blank >= 2) { lastAdded = null; stable = { id: null, n: 0 }; } fr && fr.classList.remove('hit'); setStatus(cands.length ? 'Not sure — tap the right card below' : live ? 'Line the card up inside the frame' : 'No card recognized in that photo'); return; }
    blank = 0; const top = cands[0].c;
    stable = stable.id === top.id ? { id: top.id, n: stable.n + 1 } : { id: top.id, n: 1 };
    fr && fr.classList.add('hit');
    setStatus(`${top.t}${top.st ? ', ' + top.st : ''} · ${top.ci}`);
    const auto = R.S.prefs.autoAdd;
    if (auto && (!live || stable.n >= 2 || cands[0].s >= 100) && lastAdded !== top.id) { addToSession(top.id); lastAdded = top.id; }
  }

  /* ---------- session ---------- */
  function addToSession(id, n = 1) {
    const foil = !!R.S.prefs.scanFoil; const s = R.S.session;
    const e = s.find(x => x.id === id && !!x.f === foil); if (e) e.n += n; else s.unshift({ id, f: foil, n });
    R.save(); navigator.vibrate?.(35); R.toast(`+ ${card(id).t}`); renderSession();
  }
  function renderSession() {
    const box = $('#sess', root); if (!box) return;
    const s = R.S.session, total = s.reduce((a, x) => a + x.n, 0);
    const bs = R.S.binders;
    box.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><div><span class="session-total">${total}</span> <span class="muted">card${total === 1 ? '' : 's'} scanned</span></div>${total ? '<button class="btn sm" id="sclr">Clear</button>' : ''}</div>
      ${total ? `<div class="list">${s.map((x, i) => { const c = card(x.id); return `<div class="drow"><span class="qty"><button data-si="${i}" data-sd="-1" aria-label="Remove one">−</button><b>${x.n}</b><button data-si="${i}" data-sd="1" aria-label="Add one">+</button></span><img class="thumb" alt="" src="${esc(IMG(c.im))}" data-card="${c.id}" onerror="this.style.visibility='hidden'"><div class="name" data-card="${c.id}"><div class="t">${esc(c.t)}</div><div class="sub">${esc(c.st || c.cu || '')} · ${esc(c.ci)}${x.f ? ' · ★ foil' : ''}</div></div><span></span></div>`; }).join('')}</div>
      <div class="row nowrap" style="margin-top:12px"><select id="sb" class="grow">${bs.map(b => `<option value="${b.id}" ${R.S.prefs.scanBinder === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select><button class="btn primary" id="scommit">Add ${total} to binder</button></div>`
      : '<p class="small muted">Recognized cards collect here. When you\'re done, add them all to a binder in one tap.</p>'}`;
    $$('button[data-si]', box).forEach(b => b.onclick = () => { const x = s[+b.dataset.si]; x.n += +b.dataset.sd; if (x.n <= 0) s.splice(+b.dataset.si, 1); R.save(); renderSession(); });
    const clr = $('#sclr', box); if (clr) clr.onclick = () => { R.S.session = []; lastAdded = null; R.save(); renderSession(); };
    const sb = $('#sb', box); if (sb) sb.onchange = e => { R.S.prefs.scanBinder = e.target.value; R.save(); };
    const cm = $('#scommit', box); if (cm) cm.onclick = () => {
      const bid = $('#sb', box).value; const b = R.binder(bid);
      for (const x of s) R.addTo(bid, x.id, x.n, x.f);
      R.toast(`Added ${total} cards to ${b.name}`); R.S.session = []; lastAdded = null; R.save(); renderSession();
    };
  }
  function renderCands(txt) {
    const box = $('#cands', root); if (!box) return;
    box.innerHTML = lastCands.length ? lastCands.slice(0, 4).map(({ c, s, why }) => `<div class="cand"><img alt="" src="${esc(IMG(c.im))}" data-card="${c.id}" onerror="this.style.visibility='hidden'"><div data-card="${c.id}" style="cursor:pointer"><b>${esc(c.t)}</b>${c.st ? `<span class="muted">, ${esc(c.st)}</span>` : ''}<div class="conf">${esc(c.ci)} · ${esc(R.DB.setBy.get(c.s)?.name || '')} · ${esc(why.join(' + '))}</div></div><button class="btn sm primary" data-add="${c.id}">Add</button></div>`).join('') : '';
    $$('button[data-add]', box).forEach(b => b.onclick = () => { addToSession(b.dataset.add); lastAdded = b.dataset.add; });
    const dbg = $('#ocr', root); if (dbg && txt) dbg.textContent = `title: ${txt.title.trim().replace(/\s+/g, ' ')}\nnumber: ${txt.code.trim().replace(/\s+/g, ' ')}`;
  }
  function setStatus(t) { status = t; const el = root && $('#stat', root); if (el) el.textContent = t; }

  async function scanPhoto(file) {
    setStatus('Reading photo…');
    const img = new Image(); img.src = URL.createObjectURL(file); await img.decode();
    try {
      const W = img.naturalWidth, H = img.naturalHeight;
      // assume the card fills most of the photo; centre a 63:88 box
      let h = H * 0.96, w = h * 63 / 88; if (w > W * 0.96) { w = W * 0.96; h = w * 88 / 63; }
      const rect = { x: (W - w) / 2, y: (H - h) / 2, w, h };
      const txt = await readCard(img, rect);
      const wk = await getWorker(); const full = await wk.recognize(prep(img, 0, 0, W, H, 1600));
      txt.title += '\n' + full.data.text; txt.code += '\n' + full.data.text;
      handle(match(txt.title, txt.code), txt, false);
    } catch (e) { setStatus('Could not read that photo: ' + e.message); }
    URL.revokeObjectURL(img.src);
  }

  function mount(main) {
    root = main;
    const p = R.S.prefs;
    main.innerHTML = `<div class="scanner">
      <div>
        <div class="viewfinder"><video playsinline muted></video><div class="frame" style="width:${p.frame || 58}%"><div class="band t"></div><div class="band c"></div></div><div class="focus-ring"></div>
          <div class="vf-btns"><button id="torch" hidden aria-label="Flashlight"><svg viewBox="0 0 24 24"><path d="M9 3h6l-1 6h3l-7 12 1-8H8z"/></svg></button></div>
          <div class="idle"><div><p class="t">Point your camera at a card</p><p class="small" style="margin:0 0 14px;opacity:.8">Fit the card inside the frame. RingBox reads the title and the collector number at the bottom (like 1R89).</p></div></div>
          <div class="hud"><span id="stat">${esc(status)}</span><span class="fmeter" title="Focus"><i id="focusM"></i></span></div></div>
        <div id="camctl" class="camctl"></div>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="camBtn">Start camera</button><label class="btn"><input type="file" id="photo" accept="image/*" capture="environment" hidden>Scan a photo</label>
          <span class="grow"></span><button class="chip ${p.autoAdd ? 'on' : ''}" id="auto">Auto-add</button><button class="chip ${p.scanFoil ? 'on' : ''}" id="foil">★ Foil</button></div>
        <div class="cands" id="cands" style="margin-top:10px"></div>
        <details style="margin-top:8px"><summary class="small dim">What the reader saw</summary><div class="ocr-debug" id="ocr"></div></details>
        <div class="row" style="margin-top:8px"><button class="btn sm" id="manual">Find a card by name instead</button></div>
      </div>
      <div class="panel" id="sess"></div>
    </div>`;
    video = $('video', main);
    $('.viewfinder', main).addEventListener('click', e => { if (!e.target.closest('button') && on) tapFocus(e); });
    $('#camBtn', main).onclick = () => on ? stop() : start();
    $('#photo', main).onchange = e => { const f = e.target.files[0]; if (f) scanPhoto(f); e.target.value = ''; };
    $('#auto', main).onclick = e => { p.autoAdd = !p.autoAdd; R.save(); e.target.classList.toggle('on', p.autoAdd); };
    $('#foil', main).onclick = e => { p.scanFoil = !p.scanFoil; R.save(); e.target.classList.toggle('on', p.scanFoil); };
    $('#torch', main).onclick = async e => { if (!track) return; torch = !torch; try { await track.applyConstraints({ advanced: [{ torch }] }); e.currentTarget.classList.toggle('on', torch); } catch { } };
    $('#manual', main).onclick = () => {
      R.openSheet(`<div class="sheet-h"><h2>Add by name or number</h2><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><input type="search" id="mq" placeholder="Title or number, e.g. Gimli or 1R13" autocomplete="off"><div id="mres" class="cands" style="margin-top:10px"></div>`, s => {
        const q = $('#mq', s); setTimeout(() => q.focus(), 50);
        q.oninput = () => {
          const v = norm(q.value), k = codeKey(q.value); const byCode = R.DB.byCode.get(k);
          const res = (byCode ? [card(byCode)] : []).concat(v.length < 2 ? [] : R.DB.cards.filter(c => R.isPhysical(c) && c._n.includes(v)).slice(0, 25));
          $('#mres', s).innerHTML = res.map(c => `<div class="cand"><img alt="" src="${esc(IMG(c.im))}" onerror="this.style.visibility='hidden'"><div><b>${esc(c.t)}</b>${c.st ? `<span class="muted">, ${esc(c.st)}</span>` : ''}<div class="conf">${esc(c.ci)} · ${esc(R.DB.setBy.get(c.s)?.name || '')}</div></div><button class="btn sm primary" data-madd="${c.id}">Add</button></div>`).join('');
          $$('button[data-madd]', s).forEach(b => b.onclick = () => addToSession(b.dataset.madd));
        };
      });
    };
    renderSession(); renderCands();
    if (window.isSecureContext === false) setStatus('The camera needs the app opened over https.');
  }
  return { mount, stop, match, _readCard: readCard, _prep: prep, _sharp: sharpness };
})();
