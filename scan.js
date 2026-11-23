/* RingBox scanner: reads a card's title band and collector number (e.g. "1R89") with
   on-device OCR (Tesseract, bundled), then fuzzy-matches against the card database. */
'use strict';
window.Scanner = (() => {
  const R = window.RB;
  const { $, $$, esc, card, IMG, norm, codeKey, fullName } = R;
  const abs = p => new URL(p, location.href).href;
  let workerP = null, stream = null, track = null, video = null, on = false, busy = false, torch = false, timer = null;
  let stable = { id: null, n: 0 }, lastAdded = null, blank = 0, lastCands = [], root = null, status = '';
  let titles = null;

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
    const w = await getWorker();
    const { x, y, w: cw, h: ch } = rect;
    const tCv = prep(src, x + cw * 0.04, y + ch * 0.015, cw * 0.92, ch * 0.16);
    const cCv = prep(src, x + cw * 0.02, y + ch * 0.885, cw * 0.96, ch * 0.11, 1400);
    const t = await w.recognize(tCv); const c = await w.recognize(cCv);
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
  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) { setStatus('This browser has no camera access. Use “Scan a photo” instead.'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) { setStatus(e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your browser settings, or scan a photo.' : 'Could not open the camera: ' + e.message); return; }
    track = stream.getVideoTracks()[0];
    try { const caps = track.getCapabilities?.() || {}; if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); $('#torch', root).hidden = !caps.torch; } catch { }
    video.srcObject = stream; await video.play().catch(() => { });
    on = true; $('.idle', root).hidden = true; $('#camBtn', root).textContent = 'Stop camera';
    getWorker().then(loop).catch(e => setStatus(e.message));
  }
  function stop() {
    on = false; clearTimeout(timer);
    if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; track = null; torch = false;
    if (root && $('.idle', root)) { $('.idle', root).hidden = false; $('#camBtn', root).textContent = 'Start camera'; }
  }
  async function loop() {
    if (!on) return;
    if (!busy && video.readyState >= 2) {
      busy = true;
      try {
        const r = cardRect(); if (r) { const txt = await readCard(video, r); handle(match(txt.title, txt.code), txt, true); }
      } catch (e) { console.warn(e); }
      busy = false;
    }
    timer = setTimeout(loop, 250);
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
    if (auto && (!live || stable.n >= 2) && lastAdded !== top.id) { addToSession(top.id); lastAdded = top.id; }
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
        <div class="viewfinder"><video playsinline muted></video><div class="frame"><div class="band t"></div><div class="band c"></div></div>
          <div class="vf-btns"><button id="torch" hidden aria-label="Flashlight"><svg viewBox="0 0 24 24"><path d="M9 3h6l-1 6h3l-7 12 1-8H8z"/></svg></button></div>
          <div class="idle"><div><p style="font-family:Marcellus,serif;font-size:20px;margin:0 0 6px">Point your camera at a card</p><p class="small" style="margin:0 0 14px;opacity:.8">Fit the card inside the frame. RingBox reads the title and the collector number at the bottom (like 1R89).</p></div></div>
          <div class="hud"><span id="stat">${esc(status)}</span></div></div>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="camBtn">Start camera</button><label class="btn"><input type="file" id="photo" accept="image/*" capture="environment" hidden>Scan a photo</label>
          <span class="grow"></span><button class="chip ${p.autoAdd ? 'on' : ''}" id="auto">Auto-add</button><button class="chip ${p.scanFoil ? 'on' : ''}" id="foil">★ Foil</button></div>
        <div class="cands" id="cands" style="margin-top:10px"></div>
        <details style="margin-top:8px"><summary class="small dim">What the reader saw</summary><div class="ocr-debug" id="ocr"></div></details>
        <div class="row" style="margin-top:8px"><button class="btn sm" id="manual">Find a card by name instead</button></div>
      </div>
      <div class="panel" id="sess"></div>
    </div>`;
    video = $('video', main);
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
  return { mount, stop, match, _readCard: readCard, _prep: prep };
})();
