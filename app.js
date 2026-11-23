/* RingBox — collection, deck builder and scanner for Decipher's LOTR TCG.
   Card data: Players Council (github.com/PlayersCouncil/lotrtcg-card-data). */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const IMG = s => !s ? '' : s.replace(/^@/, 'https://cdn.lotrtcgpc.net/cards/').replace(/^#/, 'https://play.lotrtcgpc.net/gemp-lotr/images/');

const CULTURES = {
  'Dwarven': '#c4543f', 'Elven': '#7fb35a', 'Gandalf': '#c9c9c9', 'Gondor': '#7aa8d8', 'Rohan': '#3f9f8f', 'Shire': '#c8a060',
  'Isengard': '#e3c23a', 'Moria': '#c77b45', 'Ringwraith': '#6d7a8a', 'Sauron': '#d23c2a', 'Raider': '#b5643a', 'Orc': '#9a4b4b',
  'Uruk-hai': '#8c5a2b', 'Men': '#8f7aa8', 'Dunland': '#a87a4a', 'Gollum': '#5e9f86', 'The One Ring': '#e8c45c'
};
const TYPES = ['Companion', 'Ally', 'Minion', 'Event', 'Condition', 'Possession', 'Artifact', 'Follower', 'Site', 'The One Ring', 'Map'];
const RARITY = { C: 'Common', U: 'Uncommon', R: 'Rare', 'R+': 'Rare+', P: 'Promo', S: 'Starter', A: 'Absolute', N: 'Non-playable' };
const cc = c => CULTURES[c] || '#888';

/* ---------- data ---------- */
const DB = { bySetNum: new Map(), cards: [], byId: new Map(), sets: [], setBy: new Map(), formats: [], fmtBy: new Map(), group: new Map(), byCode: new Map(), titleIdx: [] };
const isPhysical = c => c.s <= 19;
const isErrata = c => c.s >= 50 && c.s <= 99;
const isVirtual = c => c.s >= 100;
const fullName = c => c.st ? `${c.t}, ${c.st}` : c.t;
const setName = s => DB.setBy.get(s)?.name || `Set ${s}`;
const codeKey = s => String(s || '').toUpperCase().replace(/[\s+]/g, '');

async function loadData() {
  const [cards, sets, formats] = await Promise.all(['data/cards.json', 'data/sets.json', 'data/formats.json'].map(u => fetch(u).then(r => r.json())));
  DB.cards = cards; DB.sets = sets; DB.formats = formats;
  for (const c of cards) DB.byId.set(c.id, c);
  for (const s of sets) DB.setBy.set(s.s, s);
  for (const f of formats) DB.fmtBy.set(f.id, f);
  // printing groups: a card, its reprints/alternates and its PC errata share ownership
  const parent = new Map();
  const find = x => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x); return x; };
  const unite = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  for (const c of cards) {
    if (!parent.has(c.id)) parent.set(c.id, c.id);
    for (const a of c.al || []) { if (!parent.has(a)) parent.set(a, a); unite(c.id, a); }
    if (c.eo) unite(c.eo, c.id);
  }
  const groups = new Map();
  for (const id of parent.keys()) { const r = find(id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(id); }
  for (const g of groups.values()) for (const id of g) DB.group.set(id, g);
  for (const c of cards) {
    c._n = norm(fullName(c)); c._t = norm(c.t); c._st = norm(c.st); c._k = norm(c.k); c._g = norm(c.gt);
    if (c.ci && !isErrata(c)) { DB.byCode.set(codeKey(c.ci), c.id); const k = c.s + '_' + c.n; if (!DB.bySetNum.has(k)) DB.bySetNum.set(k, c.id); }
  }
  for (const c of cards) if (c.al) for (const a of c.al) if (!DB.byId.has(a)) DB.byId.set(a, c); // alternate ids resolve to their card
}
const card = id => DB.byId.get(id);
const groupOf = id => DB.group.get(id) || [id];

/* ---------- storage ---------- */
const KEY = 'ringbox.v1';
const S = {
  binders: [{ id: 'main', name: 'Collection', kind: 'collection', items: {} }, { id: 'wish', name: 'Wishlist', kind: 'wish', items: {} }, { id: 'trade', name: 'For trade', kind: 'trade', items: {} }],
  decks: [], favs: [], session: [], prefs: { grid: true, errata: false, virtual: true, scanBinder: 'main', autoAdd: true, scanFoil: false, theme: '' }
};
function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d) Object.assign(S, d, { prefs: { ...S.prefs, ...(d.prefs || {}) } }); } catch (e) { console.warn(e); }
}
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save — storage full or blocked'); } }, 150); }
const binder = id => S.binders.find(b => b.id === id);
function ownedCount(id, { foilOnly = false, kind = 'collection' } = {}) {
  let n = 0; const g = groupOf(id);
  for (const b of S.binders) if (b.kind === kind) for (const x of g) { const it = b.items[x]; if (it) n += foilOnly ? (it.f || 0) : (it.q || 0) + (it.f || 0); }
  return n;
}
function exactOwned(id) { let n = 0; for (const b of S.binders) if (b.kind === 'collection') { const it = b.items[id]; if (it) n += (it.q || 0) + (it.f || 0); } return n; }
function addTo(bid, id, dq = 1, foil = false) {
  const b = binder(bid); if (!b) return;
  const it = b.items[id] || (b.items[id] = { q: 0, f: 0 });
  if (foil) it.f = Math.max(0, (it.f || 0) + dq); else it.q = Math.max(0, (it.q || 0) + dq);
  if (!it.q && !it.f) delete b.items[id];
  save();
}

/* ---------- search ---------- */
const SORTS = {
  set: (a, b) => a.s - b.s || a.n - b.n,
  name: (a, b) => a.t.localeCompare(b.t) || a.s - b.s,
  tw: (a, b) => (a.tw ?? a.si ?? 99) - (b.tw ?? b.si ?? 99) || a.t.localeCompare(b.t),
  str: (a, b) => (b.str ?? -1) - (a.str ?? -1) || a.t.localeCompare(b.t),
  culture: (a, b) => (a.cu || 'zz').localeCompare(b.cu || 'zz') || a.t.localeCompare(b.t),
};
const FIELD = { tw: 'tw', cost: 'tw', twilight: 'tw', str: 'str', strength: 'str', vit: 'vit', vitality: 'vit', res: 'res', resistance: 'res', si: 'si', site: 'si', n: 'n', num: 'n' };
function parseQuery(q) {
  const tests = []; const free = [];
  const re = /(-?)(\w+)(:|>=|<=|=|>|<)("[^"]*"|\S+)|("[^"]*"|\S+)/g; let m;
  while ((m = re.exec(q))) {
    if (m[5]) { free.push(norm(m[5].replace(/"/g, ''))); continue; }
    const neg = !!m[1], key = m[2].toLowerCase(), op = m[3], val = m[4].replace(/"/g, ''), nv = norm(val);
    let t = null;
    if (FIELD[key]) {
      const f = FIELD[key], v = parseFloat(val);
      const o = op === ':' ? '=' : op;
      t = c => { const x = c[f]; if (x == null) return false; return o === '=' ? x == v : o === '>' ? x > v : o === '<' ? x < v : o === '>=' ? x >= v : x <= v; };
    } else if (key === 't' || key === 'type') t = c => norm(c.ty).includes(nv);
    else if (key === 'cu' || key === 'c' || key === 'culture') t = c => norm(c.cu).startsWith(nv);
    else if (key === 's' || key === 'set') t = c => String(c.s) === val || norm(DB.setBy.get(c.s)?.ab) === nv;
    else if (key === 'r' || key === 'rarity') t = c => norm(c.r) === nv;
    else if (key === 'o' || key === 'text') t = c => c._g.includes(nv);
    else if (key === 'k' || key === 'kw' || key === 'race') t = c => c._k.includes(nv) || c._g.includes(nv);
    else if (key === 'side') t = c => (nv.startsWith('f') ? c.sd === 'F' : nv.startsWith('s') ? c.sd === 'S' : !c.sd);
    else if (key === 'sig' || key === 'signet') t = c => norm(c.sg).startsWith(nv);
    else if (key === 'f' || key === 'format' || key === 'legal') { const fm = DB.formats.find(f => norm(f.id).replace(/ /g, '') === nv.replace(/ /g, '') || norm(f.name).replace(/ /g, '').startsWith(nv.replace(/ /g, ''))); t = c => fm ? legality(c, fm) !== 'no' : true; }
    else if (key === 'is') t = c => nv === 'unique' ? !!c.u : nv === 'ringbearer' || nv === 'rb' ? !!c.rb : nv === 'owned' ? ownedCount(c.id) > 0 : nv === 'fav' ? S.favs.includes(c.id) : nv === 'errata' ? isErrata(c) : nv === 'virtual' ? isVirtual(c) : true;
    else { free.push(norm(m[0])); continue; }
    tests.push(neg ? c => !t(c) : t);
  }
  const words = free.filter(Boolean);
  if (words.length) tests.push(c => words.every(w => c._n.includes(w) || c._k.includes(w)));
  return tests;
}
function runSearch(q, f, sort = 'set') {
  const tests = parseQuery(q || '');
  const hasErrataQ = /is:errata/.test(q || '');
  const res = DB.cards.filter(c => {
    if (!hasErrataQ && !S.prefs.errata && isErrata(c)) return false;
    if (!S.prefs.virtual && isVirtual(c) && !/is:virtual/.test(q || '')) return false;
    if (f.side && c.sd !== f.side) return false;
    if (f.types?.length && !f.types.includes(c.ty)) return false;
    if (f.cults?.length && !f.cults.includes(c.cu || 'None')) return false;
    if (f.set !== '' && f.set != null && c.s !== +f.set) return false;
    if (f.rar?.length && !f.rar.includes(c.r)) return false;
    if (f.fmt) { const fm = DB.fmtBy.get(f.fmt); if (fm && legality(c, fm) === 'no') return false; }
    if (f.owned === 'own' && ownedCount(c.id) === 0) return false;
    if (f.owned === 'miss' && ownedCount(c.id) > 0) return false;
    if (f.fav && !S.favs.includes(c.id)) return false;
    if (f.twMin !== '' && f.twMin != null && !(c.tw >= +f.twMin)) return false;
    if (f.twMax !== '' && f.twMax != null && !(c.tw <= +f.twMax)) return false;
    return tests.every(t => t(c));
  });
  return res.sort(SORTS[sort] || SORTS.set);
}

/* ---------- legality & deck rules ---------- */
function legality(c, fm) {
  const ids = groupOf(c.id);
  if (ids.some(i => fm.x.includes(i))) return 'banned';
  const ok = ids.some(i => { const s = +i.split('_')[0]; return fm.sets.includes(s) || fm.extra.includes(i); });
  if (!ok) return 'no';
  if (ids.some(i => fm.rl.includes(i))) return 'restricted';
  return 'legal';
}
function deckCards(d) {
  const draw = Object.entries(d.draw || {}).map(([id, q]) => ({ c: card(id), q })).filter(x => x.c);
  return { draw, rb: card(d.rb), ring: card(d.ring), sites: (d.sites || []).map(card).filter(Boolean), maybe: Object.entries(d.maybe || {}).map(([id, q]) => ({ c: card(id), q })).filter(x => x.c) };
}
function validate(d) {
  const out = []; const fm = DB.fmtBy.get(d.format);
  const { draw, rb, ring, sites } = deckCards(d);
  const fp = draw.filter(x => x.c.sd === 'F').reduce((a, x) => a + x.q, 0);
  const sh = draw.filter(x => x.c.sd === 'S').reduce((a, x) => a + x.q, 0);
  const total = draw.reduce((a, x) => a + x.q, 0);
  if (!rb) out.push(['e', 'Choose a Ring-bearer (a companion who can bear the Ring).']);
  else if (!rb.rb) out.push(['e', `${rb.t} can't be your Ring-bearer.`]);
  if (!ring) out.push(['e', 'Add The One Ring.']);
  if (total < 60) out.push(['e', `Draw deck has ${total} cards — it needs at least 60.`]);
  if (fp !== sh) out.push(['e', `Free Peoples (${fp}) and Shadow (${sh}) must be equal.`]);
  const byTitle = new Map();
  for (const x of draw) byTitle.set(x.c.t, (byTitle.get(x.c.t) || 0) + x.q);
  if (rb) byTitle.set(rb.t, (byTitle.get(rb.t) || 0) + 1);
  for (const [t, n] of byTitle) if (n > 4) out.push(['e', `${n} copies of “${t}” — the Rule of 4 allows 4 cards with the same title.`]);
  // sites
  if (sites.length !== 9) out.push(['e', `Adventure deck has ${sites.length} site${sites.length === 1 ? '' : 's'} — it needs 9.`]);
  const mode = fm?.sites || 'any';
  const nums = sites.map(s => s.si);
  if (['Fellowship', 'Towers', 'King', 'multipath'].includes(mode)) {
    for (let i = 1; i <= 9; i++) { const n = nums.filter(x => x === i).length; if (n === 0 && sites.length) out.push(['w', `No site ${i}.`]); if (n > 1) out.push(['e', `${n} copies of site ${i} — one of each number.`]); }
    if (mode === 'multipath') { const blocks = new Set(sites.map(s => s.b)); if (blocks.size > 1) out.push(['e', 'Sites must all come from one site path (Fellowship, Towers or King).']); }
    else { const wrong = sites.filter(s => s.b !== mode); if (wrong.length) out.push(['e', `${wrong.length} site(s) aren't ${mode} block sites.`]); }
  } else if (mode === 'shadows') {
    const wrong = sites.filter(s => s.b !== 'Shadows'); if (wrong.length) out.push(['e', `${wrong.length} site(s) aren't Shadows-era sites.`]);
    const seen = new Set(); for (const s of sites) { if (seen.has(s.t)) out.push(['e', `Duplicate site “${s.t}”.`]); seen.add(s.t); }
  }
  // format legality
  if (fm) {
    const all = [...draw.map(x => [x.c, x.q]), ...(rb ? [[rb, 1]] : []), ...(ring ? [[ring, 1]] : []), ...sites.map(s => [s, 1])];
    for (const [c, q] of all) {
      const l = legality(c, fm);
      if (l === 'no') out.push(['e', `${fullName(c)} isn't legal in ${fm.name}.`]);
      else if (l === 'banned') out.push(['e', `${fullName(c)} is banned (X-listed) in ${fm.name}.`]);
      else if (l === 'restricted' && q > 1) out.push(['e', `${fullName(c)} is restricted to 1 copy in ${fm.name}.`]);
    }
    if (mode === 'multipath' && !draw.some(x => x.c.ty === 'Map') && sites.length) out.push(['w', `${fm.name} decks show their site path with a Map card.`]);
  }
  if (!out.some(x => x[0] === 'e')) out.unshift(['g', fm ? `Legal for ${fm.name}.` : 'Deck structure looks good.']);
  return { issues: out, fp, sh, total };
}

/* ---------- ui helpers ---------- */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200); }
function imgTag(c, cls = 'cimg', lazy = true) {
  if (!c) return '';
  return `<img class="${cls}" ${lazy ? 'loading="lazy"' : ''} alt="${esc(fullName(c))}" src="${esc(IMG(c.im))}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',innerHTML:'<b>${esc(esc(c.t))}</b><span>${esc(esc(c.ci || ''))}</span>'}))">`;
}
function tileHTML(c, opts = {}) {
  const own = opts.count != null ? opts.count : ownedCount(c.id);
  const foil = opts.foil || 0;
  return `<button class="tile" data-card="${c.id}">${imgTag(c)}${own ? `<span class="badge">${own}</span>` : ''}${foil ? `<span class="badge foil">★${foil}</span>` : ''}${opts.cap ? `<div class="cap">${esc(c.t)}</div>` : ''}</button>`;
}
function rowHTML(c, right = '') {
  return `<button class="lrow" data-card="${c.id}"><img class="thumb" loading="lazy" alt="" src="${esc(IMG(c.im))}" onerror="this.style.visibility='hidden'"><div><div class="t">${c.u ? '• ' : ''}${esc(c.t)}${c.st ? `<span class="muted">, ${esc(c.st)}</span>` : ''}</div><div class="sub"><span class="cult"><i style="background:${cc(c.cu)}"></i>${esc(c.cu || '—')}</span> · ${esc(c.ty)}${c.k ? ' · ' + esc(c.k) : ''}</div></div><div class="r">${right || `${c.tw != null ? `<span class="tw ${c.sd === 'S' ? 'sh' : ''}">${c.tw}</span>` : c.ty === 'Site' && c.si != null ? `<span class="tw site">${c.si}</span>` : ''}${codeChip(c)}`}</div></button>`;
}
function emptyHTML(title, text, icon = '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>') { return `<div class="empty"><div class="ic"><svg viewBox="0 0 24 24">${icon}</svg></div><h3>${title}</h3><p>${text}</p></div>`; }
const codeChip = c => c.ci ? `<span class="code">${c.r ? `<i class="rar ${c.r.replace('+', 'p')}"></i> ` : ''}${esc(c.ci)}</span>` : '';
function fab(label, fn) { const b = document.createElement('button'); b.id = 'fab'; b.className = 'fab'; b.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>${label ? `<span>${esc(label)}</span>` : ''}`; b.onclick = fn; document.body.appendChild(b); }
function paged(container, items, render, { grid = true, size = 60 } = {}) {
  container.innerHTML = `<div class="${grid ? 'grid' : 'list'}"></div><div class="more-sentinel"></div>`;
  const g = container.firstElementChild, sent = container.lastElementChild; let i = 0;
  const more = () => { if (i >= items.length) return; g.insertAdjacentHTML('beforeend', items.slice(i, i + size).map(render).join('')); i += size; if (i >= items.length) sent.remove(); };
  more();
  if (container._io) container._io.disconnect();
  container._io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) more(); }, { rootMargin: '600px' });
  container._io.observe(sent);
}
function setTop(title, actions = '', back = false) {
  $('#fab')?.remove();
  $('#viewTitle').textContent = title; $('#topActions').innerHTML = actions; $('#backBtn').hidden = !back;
}
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed'); } }
function formatGT(t) { return esc(t || '').replace(/(^|\n|\. )((?:Fellowship|Shadow|Maneuver|Archery|Assignment|Skirmish|Regroup|Response|Each|Fellowship or Regroup|Skirmish or Regroup)[^:.\n]{0,22}):/g, '$1<b>$2:</b>'); }

/* sheet (bottom drawer) */
function openSheet(html, onMount) {
  const w = $('#sheetWrap'), s = $('#sheet');
  s.innerHTML = `<div class="grab"></div>${html}`; w.hidden = false; s.scrollTop = 0; document.body.style.overflow = 'hidden';
  onMount && onMount(s);
}
function closeSheet() { $('#sheetWrap').hidden = true; document.body.style.overflow = ''; if (closeSheet.after) { const f = closeSheet.after; closeSheet.after = null; f(); } }
function promptSheet(title, value, onOk, label = 'Save') {
  openSheet(`<div class="sheet-h"><h2>${esc(title)}</h2></div><form id="pf" class="row nowrap"><input type="text" id="pv" value="${esc(value || '')}" autocomplete="off"><button class="btn primary">${label}</button></form>`, s => {
    const i = $('#pv', s); setTimeout(() => i.focus(), 50);
    $('#pf', s).onsubmit = e => { e.preventDefault(); const v = i.value.trim(); if (v) { closeSheet(); onOk(v); } };
  });
}
function confirmSheet(title, text, onOk, label = 'Delete') {
  openSheet(`<div class="sheet-h"><h2>${esc(title)}</h2></div><p class="muted">${esc(text)}</p><div class="row"><button class="btn danger" id="cok">${label}</button><button class="btn" data-close>Cancel</button></div>`, s => { $('#cok', s).onclick = () => { closeSheet(); onOk(); }; });
}

/* ---------- card detail ---------- */
function openCard(id, ctx = {}) {
  const c = card(id); if (!c) return;
  const er = c.ei ? card(c.ei) : null, base = c.eo ? card(c.eo) : null;
  const stats = [['Twilight', c.tw], ['Strength', c.str ?? c.sm], ['Vitality', c.vit ?? c.vm], ['Resistance', c.res ?? c.rm], ['Site', c.si ?? c.sim], ['Shadow #', c.ty === 'Site' ? c.sh : null]].filter(x => x[1] != null);
  const fmts = DB.formats.filter(f => f.active);
  const alts = groupOf(c.id).filter(i => i !== c.id && card(i) && card(i).id === i);
  const html = `
  <div class="sheet-h"><h2>${c.u ? '• ' : ''}${esc(c.t)}${c.st ? `<div class="subt">${esc(c.st)}</div>` : ''}</h2>
    <button class="icon-btn ${S.favs.includes(c.id) ? 'on' : ''}" id="favB" aria-label="Favorite"><svg viewBox="0 0 24 24"><path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" ${S.favs.includes(c.id) ? 'fill="currentColor"' : ''}/></svg></button>
    <button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
  <div class="cd">
    <div class="hero"><div class="bg" style="background-image:url('${esc(IMG(c.im))}')"></div>${imgTag(c, 'big', false)}</div>
    <div>
      <div class="meta-line"><span class="cult"><i style="background:${cc(c.cu)}"></i>${esc(c.cu || 'No culture')}</span><span>${esc(c.ty)}</span>${codeChip(c)}${c.sd ? `<span style="color:${c.sd === 'F' ? 'var(--fp)' : 'var(--sh)'}">${c.sd === 'F' ? 'Free Peoples' : 'Shadow'}</span>` : ''}${c.k ? `<span>${esc(c.k)}</span>` : ''}</div>
      <div class="stats">${stats.map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${k}</span></div>`).join('')}${c.sg ? `<div class="stat"><b style="font-size:14px;line-height:28px">${esc(c.sg)}</b><span>Signet</span></div>` : ''}${c.rb ? `<div class="stat"><b style="font-size:14px;line-height:28px">Yes</b><span>Ring-bearer</span></div>` : ''}</div>
      ${c.gt ? `<div class="gtext">${formatGT(c.gt)}</div>` : ''}
      ${c.lo ? `<div class="lore">${esc(c.lo)}</div>` : ''}
      ${er ? `<details class="panel" style="margin-top:12px;padding:12px 14px"><summary><b>PC errata</b> <span class="muted small">(used in Player's Council formats)</span></summary><div class="gtext" style="margin-top:8px">${formatGT(er.gt)}</div><p class="small"><a href="#" data-card="${er.id}">Open errata card</a></p></details>` : ''}
      ${base ? `<p class="small muted">This is the Player's Council errata of <a href="#" data-card="${base.id}">${esc(fullName(base))}</a>.</p>` : ''}
      <div class="h-sub">Details</div><dl class="kv">
        <dt>Set</dt><dd><a href="#set-${c.s}" data-close-go>${esc(setName(c.s))}</a> (${c.s})</dd>
        <dt>Card #</dt><dd>${esc(c.ci || c.id)}${c.r ? ` · ${esc(RARITY[c.r] || c.r)}` : ''}</dd>
        ${c.b ? `<dt>Block</dt><dd>${esc(c.b)}</dd>` : ''}${c.hs ? `<dt>Home site</dt><dd>${esc(c.hs.join(', '))}</dd>` : ''}${c.ar ? `<dt>Arrow</dt><dd>${esc(c.ar)}</dd>` : ''}
        ${alts.length ? `<dt>Also printed</dt><dd>${alts.map(i => `<a href="#" data-card="${i}">${esc(card(i).ci || i)}</a>`).join(', ')}</dd>` : ''}
      </dl>
      ${isPhysical(c) ? `<div class="h-sub">In your binders</div><div id="ownBox" class="own"></div>` : `<p class="small muted" style="margin-top:12px">${isVirtual(c) ? "Virtual card from the Player's Council — playable on GEMP, never printed." : "PC errata — tracks with the printed card."}</p>`}
      <div class="row" style="margin-top:14px"><button class="btn primary" id="toDeck"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Add to deck</button><button class="btn" id="cpy">Copy name</button></div>
      <div class="h-sub">Legality</div>
      <div class="legal">${fmts.map(f => { const l = legality(c, f); return `<div><span>${esc(f.name)}</span><span class="${l === 'legal' ? 'ok' : l === 'no' ? 'no' : l === 'banned' ? 'ban' : 'warn'}">${l === 'legal' ? 'Legal' : l === 'no' ? '—' : l === 'banned' ? 'Banned' : 'Restricted'}</span></div>`; }).join('')}</div>
    </div>
  </div>`;
  openSheet(html, s => {
    const renderOwn = () => {
      const box = $('#ownBox', s); if (!box) return;
      box.innerHTML = S.binders.map(b => { const it = b.items[c.id] || {}; return `<div class="own-row"><div><b>${esc(b.name)}</b><div class="small dim">${b.kind === 'collection' ? 'Collection' : b.kind === 'wish' ? 'Wishlist' : 'Trade list'}</div></div><div class="row nowrap" style="gap:6px"><span class="stepper"><button data-b="${b.id}" data-d="-1">−</button><output>${it.q || 0}</output><button data-b="${b.id}" data-d="1">+</button></span><span class="stepper" title="Foil"><button data-b="${b.id}" data-d="-1" data-f="1">−</button><output>★${it.f || 0}</output><button data-b="${b.id}" data-d="1" data-f="1">+</button></span></div></div>`; }).join('');
      $$('button[data-b]', box).forEach(btn => btn.onclick = () => { addTo(btn.dataset.b, c.id, +btn.dataset.d, !!btn.dataset.f); renderOwn(); refreshView(); });
    };
    renderOwn();
    $('#favB', s).onclick = () => { const i = S.favs.indexOf(c.id); i >= 0 ? S.favs.splice(i, 1) : S.favs.push(c.id); save(); openCard(c.id); };
    $('#cpy', s).onclick = () => copy(fullName(c));
    $('#toDeck', s).onclick = () => pickDeck(c);
    const big = $('.big', s); if (big) big.onclick = () => { const z = document.createElement('div'); z.className = 'zoom'; z.innerHTML = `<img src="${esc(IMG(c.im))}" alt="">`; z.onclick = () => z.remove(); document.body.appendChild(z); };
  });
}
function pickDeck(c, deckId) {
  const decks = S.decks;
  const slot = c.ty === 'Site' ? 'sites' : c.ty === 'The One Ring' ? 'ring' : 'draw';
  const doAdd = (d, where) => {
    if (where === 'rb') d.rb = c.id;
    else if (where === 'ring') d.ring = c.id;
    else if (where === 'sites') { d.sites = d.sites || []; if (!d.sites.includes(c.id)) d.sites.push(c.id); }
    else { const box = d[where] || (d[where] = {}); box[c.id] = (box[c.id] || 0) + 1; }
    d.updated = Date.now(); save(); toast(`Added to ${d.name}`); refreshView();
  };
  if (deckId) { const d = decks.find(x => x.id === deckId); return doAdd(d, slot); }
  openSheet(`<div class="sheet-h"><h2>Add ${esc(c.t)} to…</h2><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="menu">${decks.map(d => `<div class="row nowrap" style="border-bottom:1px solid var(--line);padding:6px 0"><div class="grow"><b>${esc(d.name)}</b><div class="small dim">${esc(DB.fmtBy.get(d.format)?.name || 'No format')}</div></div>
      ${c.rb ? `<button class="btn sm" data-d="${d.id}" data-w="rb">Ring-bearer</button>` : ''}
      <button class="btn sm primary" data-d="${d.id}" data-w="${slot}">${slot === 'sites' ? 'Sites' : slot === 'ring' ? 'Ring' : 'Deck'}</button>${slot === 'draw' ? `<button class="btn sm" data-d="${d.id}" data-w="maybe">Maybe</button>` : ''}</div>`).join('') || '<p class="muted">No decks yet.</p>'}
    <button class="btn" id="nd" style="margin-top:10px">New deck with this card</button></div>`, s => {
    $$('button[data-d]', s).forEach(b => b.onclick = () => { doAdd(decks.find(x => x.id === b.dataset.d), b.dataset.w); closeSheet(); });
    $('#nd', s).onclick = () => { const d = newDeck('New deck'); doAdd(d, c.rb ? 'rb' : slot); closeSheet(); location.hash = 'deck-' + d.id; };
  });
}

/* ---------- views ---------- */
const V = {};
let current = { name: '', arg: '' };
const filt = { side: '', types: [], cults: [], set: '', rar: [], fmt: '', owned: '', fav: false, twMin: '', twMax: '' };
let searchQ = '', searchSort = 'set', showFilters = false;

V.search = (main) => {
  setTop('Search', `<button class="icon-btn" id="gridT" aria-label="Toggle grid">${S.prefs.grid ? '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"/></svg>' : '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>'}</button>`);
  const nf = filt.types.length + filt.cults.length + filt.rar.length + (filt.side ? 1 : 0) + (filt.set !== '' ? 1 : 0) + (filt.fmt ? 1 : 0) + (filt.owned ? 1 : 0) + (filt.fav ? 1 : 0) + (filt.twMin !== '' ? 1 : 0) + (filt.twMax !== '' ? 1 : 0);
  main.innerHTML = `
  <form class="searchbar" id="sf"><div class="field"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input type="search" id="q" placeholder="Search cards" value="${esc(searchQ)}" autocomplete="off" enterkeyhint="search"></div><button type="button" class="btn ${showFilters || nf ? 'primary' : ''}" id="fb">Filters${nf ? ` · ${nf}` : ''}</button></form>
  <div id="fp" class="${showFilters ? '' : 'hidden'}"></div>
  <div class="toolbar"><span class="count" id="cnt"></span><select id="sort" style="width:auto;min-height:36px">${Object.keys(SORTS).map(k => `<option value="${k}" ${k === searchSort ? 'selected' : ''}>Sort: ${{ set: 'Set #', name: 'Name', tw: 'Twilight', str: 'Strength', culture: 'Culture' }[k]}</option>`).join('')}</select></div>
  <div id="res"></div>`;
  const draw = () => {
    const res = runSearch(searchQ, filt, searchSort);
    $('#cnt').textContent = `${res.length.toLocaleString()} card${res.length === 1 ? '' : 's'}`;
    if (!res.length) { $('#res').innerHTML = emptyHTML('No cards found', 'Try fewer filters or a shorter search.'); return; }
    paged($('#res'), res, S.prefs.grid ? c => tileHTML(c) : c => rowHTML(c), { grid: S.prefs.grid });
  };
  const drawFilters = () => {
    const chip = (grp, v, label, dot) => `<button type="button" class="chip ${(Array.isArray(filt[grp]) ? filt[grp].includes(v) : filt[grp] === v) ? 'on' : ''}" data-g="${grp}" data-v="${esc(v)}">${dot ? `<span class="dot" style="background:${dot}"></span>` : ''}${esc(label)}</button>`;
    $('#fp').innerHTML = `<div class="panel filters">
      <div><label class="lbl">Side</label><div class="chips">${chip('side', 'F', 'Free Peoples')}${chip('side', 'S', 'Shadow')}</div></div>
      <div><label class="lbl">Card type</label><div class="chips">${TYPES.map(t => chip('types', t, t)).join('')}</div></div>
      <div><label class="lbl">Culture</label><div class="chips">${Object.keys(CULTURES).map(t => chip('cults', t, t, cc(t))).join('')}</div></div>
      <div><label class="lbl">Rarity</label><div class="chips">${['C', 'U', 'R', 'R+', 'P', 'S'].map(r => chip('rar', r, RARITY[r])).join('')}</div></div>
      <div class="two"><div><label class="lbl" for="fset">Set</label><select id="fset"><option value="">All sets</option>${DB.sets.filter(s => s.kind !== 'pc-errata').map(s => `<option value="${s.s}" ${String(filt.set) === String(s.s) ? 'selected' : ''}>${s.s} · ${esc(s.name)}</option>`).join('')}</select></div>
        <div><label class="lbl" for="ffmt">Legal in</label><select id="ffmt"><option value="">Any format</option>${DB.formats.map(f => `<option value="${f.id}" ${filt.fmt === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div></div>
      <div class="two"><div><label class="lbl">Twilight cost</label><div class="row nowrap"><input type="number" inputmode="numeric" id="twmin" placeholder="min" value="${esc(filt.twMin)}"><span>–</span><input type="number" inputmode="numeric" id="twmax" placeholder="max" value="${esc(filt.twMax)}"></div></div>
        <div><label class="lbl">Collection</label><div class="chips">${chip('owned', 'own', 'Owned')}${chip('owned', 'miss', 'Missing')}<button type="button" class="chip ${filt.fav ? 'on' : ''}" id="ffav">Favorites</button></div></div></div>
      <div class="row"><label class="chip ${S.prefs.errata ? 'on' : ''}"><input type="checkbox" id="perr" ${S.prefs.errata ? 'checked' : ''} hidden>Show PC errata cards</label><label class="chip ${S.prefs.virtual ? 'on' : ''}"><input type="checkbox" id="pvir" ${S.prefs.virtual ? 'checked' : ''} hidden>Show PC virtual sets</label><span class="grow"></span><button type="button" class="btn sm" id="fclr">Clear filters</button></div>
      <p class="help">Search syntax: <code>tw&lt;=2</code> <code>str&gt;=8</code> <code>vit:4</code> <code>cu:gondor</code> <code>t:companion</code> <code>k:archer</code> <code>o:"exert"</code> <code>s:fotr</code> <code>side:shadow</code> <code>is:unique</code> <code>is:owned</code> <code>f:pc-movie</code>. Put <code>-</code> before a term to exclude it.</p></div>`;
    $$('#fp .chip[data-g]').forEach(b => b.onclick = () => {
      const g = b.dataset.g, v = b.dataset.v;
      if (Array.isArray(filt[g])) { const i = filt[g].indexOf(v); i >= 0 ? filt[g].splice(i, 1) : filt[g].push(v); } else filt[g] = filt[g] === v ? '' : v;
      V.search(main);
    });
    $('#ffav').onclick = () => { filt.fav = !filt.fav; V.search(main); };
    $('#fset').onchange = e => { filt.set = e.target.value; V.search(main); };
    $('#ffmt').onchange = e => { filt.fmt = e.target.value; V.search(main); };
    $('#twmin').onchange = e => { filt.twMin = e.target.value; V.search(main); };
    $('#twmax').onchange = e => { filt.twMax = e.target.value; V.search(main); };
    $('#perr').onchange = e => { S.prefs.errata = e.target.checked; save(); V.search(main); };
    $('#pvir').onchange = e => { S.prefs.virtual = e.target.checked; save(); V.search(main); };
    $('#fclr').onclick = () => { Object.assign(filt, { side: '', types: [], cults: [], set: '', rar: [], fmt: '', owned: '', fav: false, twMin: '', twMax: '' }); V.search(main); };
  };
  if (showFilters) drawFilters();
  draw();
  let t; $('#q').oninput = e => { searchQ = e.target.value; clearTimeout(t); t = setTimeout(draw, 160); };
  $('#sf').onsubmit = e => { e.preventDefault(); $('#q').blur(); };
  $('#fb').onclick = () => { showFilters = !showFilters; V.search(main); };
  $('#sort').onchange = e => { searchSort = e.target.value; draw(); };
  $('#gridT').onclick = () => { S.prefs.grid = !S.prefs.grid; save(); V.search(main); };
};

function binderStats(b) {
  let total = 0, foil = 0; const ids = Object.keys(b.items);
  for (const id of ids) { total += b.items[id].q || 0; foil += b.items[id].f || 0; }
  return { total: total + foil, foil, unique: ids.length };
}
function setCompletion() {
  const own = new Set();
  for (const b of S.binders) if (b.kind === 'collection') for (const id of Object.keys(b.items)) for (const g of groupOf(id)) own.add(g);
  return DB.sets.filter(s => s.s <= 19).map(s => { const cs = DB.cards.filter(c => c.s === s.s && c.r !== 'N'); const have = cs.filter(c => own.has(c.id)).length; return { s, n: cs.length, have }; });
}
V.collection = (main) => {
  setTop('Collection');
  const comp = setCompletion();
  const allOwn = S.binders.filter(b => b.kind === 'collection').map(binderStats).reduce((a, x) => ({ total: a.total + x.total, unique: a.unique + x.unique, foil: a.foil + x.foil }), { total: 0, unique: 0, foil: 0 });
  const totalPhys = comp.reduce((a, x) => a + x.n, 0), havePhys = comp.reduce((a, x) => a + x.have, 0);
  main.innerHTML = `
  <div class="summary"><div class="stat"><b>${allOwn.total.toLocaleString()}</b><span>Cards</span></div><div class="stat"><b>${allOwn.unique.toLocaleString()}</b><span>Unique</span></div><div class="stat"><b>${allOwn.foil}</b><span>Foils</span></div><div class="stat"><b>${totalPhys ? Math.round(havePhys / totalPhys * 100) : 0}%</b><span>Complete</span></div></div>
  <div class="section-h"><h2>Binders & lists</h2></div>
  <div class="cards-list">${S.binders.map(b => { const st = binderStats(b); const ic = b.kind === 'wish' ? '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>' : b.kind === 'trade' ? '<path d="M7 7h11l-3-3M17 17H6l3 3"/>' : '<rect x="5" y="4" width="11" height="15" rx="1.5"/><path d="M8.5 20.5H18a1.5 1.5 0 0 0 1.5-1.5V8"/>'; return `<button class="bcard" data-go="binder-${b.id}"><span class="art ic"><svg viewBox="0 0 24 24">${ic}</svg></span><div class="grow"><h3>${esc(b.name)}</h3><div class="meta">${b.kind === 'collection' ? 'Binder' : b.kind === 'wish' ? 'Wishlist' : 'Trade list'} · ${st.total.toLocaleString()} card${st.total === 1 ? '' : 's'} · ${st.unique.toLocaleString()} unique</div></div><svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>`; }).join('')}</div>
  <div class="section-h"><h2>Set completion</h2><a href="#sets" class="small">All sets</a></div>
  <div class="cards-list cols">${comp.map(x => `<button class="bcard" data-go="set-${x.s.s}"><div class="grow"><div class="row nowrap" style="justify-content:space-between"><h3>${esc(x.s.name)}</h3><span class="pct">${x.n ? Math.round(x.have / x.n * 100) : 0}%</span></div><div class="meta">${x.have} of ${x.n} cards</div><div class="progress"><i style="width:${x.n ? x.have / x.n * 100 : 0}%"></i></div></div></button>`).join('')}</div>`;
  fab('New binder', () => openSheet(`<div class="sheet-h"><h2>New binder or list</h2></div><form id="nbf" class="filters"><input type="text" id="nbn" placeholder="Name, e.g. Binder 2 or Gondor rares" autocomplete="off"><div class="chips"><label class="chip on"><input type="radio" name="k" value="collection" checked hidden>Collection binder</label><label class="chip"><input type="radio" name="k" value="wish" hidden>Wishlist</label><label class="chip"><input type="radio" name="k" value="trade" hidden>Trade list</label></div><button class="btn primary">Create</button></form>`, s => {
    $$('input[name=k]', s).forEach(r => r.onchange = () => $$('label.chip', s).forEach(l => l.classList.toggle('on', $('input', l).checked)));
    $('#nbf', s).onsubmit = e => { e.preventDefault(); const name = $('#nbn', s).value.trim(); if (!name) return; const b = { id: uid(), name, kind: $('input[name=k]:checked', s).value, items: {} }; S.binders.push(b); save(); closeSheet(); location.hash = 'binder-' + b.id; };
  }));
};

let binderQ = '', binderSort = 'set';
V.binder = (main, id) => {
  const b = binder(id); if (!b) { location.hash = 'collection'; return; }
  setTop(b.name, `<button class="icon-btn" id="bm" aria-label="Binder options"><svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18" r="1.4"/></svg></button>`, true);
  const st = binderStats(b);
  main.innerHTML = `
  <div class="summary"><div class="stat"><b>${st.total}</b><span>Cards</span></div><div class="stat"><b>${st.unique}</b><span>Different</span></div><div class="stat"><b>${st.foil}</b><span>Foils</span></div></div>
  <form class="searchbar" id="bf"><div class="field"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input type="search" id="bq" placeholder="Filter this ${b.kind === 'collection' ? 'binder' : 'list'}" value="${esc(binderQ)}"></div><select id="bs" style="width:auto">${Object.keys(SORTS).map(k => `<option value="${k}" ${k === binderSort ? 'selected' : ''}>${{ set: 'Set #', name: 'Name', tw: 'Twilight', str: 'Strength', culture: 'Culture' }[k]}</option>`).join('')}</select></form>
  <div id="bres"></div>`;
  const draw = () => {
    const tests = parseQuery(binderQ);
    const items = Object.keys(b.items).map(card).filter(c => c && tests.every(t => t(c))).sort(SORTS[binderSort]);
    if (!Object.keys(b.items).length) { $('#bres').innerHTML = emptyHTML('Nothing here yet', b.kind === 'collection' ? 'Scan cards with the camera, or open any card and tap + to add it.' : 'Open any card and add it to this list.', '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M12 9v6M9 12h6"/>'); return; }
    paged($('#bres'), items, S.prefs.grid ? c => tileHTML(c, { count: (b.items[c.id].q || 0) + (b.items[c.id].f || 0), foil: b.items[c.id].f || 0 }) : c => rowHTML(c, `×${(b.items[c.id].q || 0) + (b.items[c.id].f || 0)}${b.items[c.id].f ? `<br>★${b.items[c.id].f}` : ''}`), { grid: S.prefs.grid });
  };
  draw();
  $('#bq').oninput = e => { binderQ = e.target.value; draw(); };
  $('#bs').onchange = e => { binderSort = e.target.value; draw(); };
  $('#bf').onsubmit = e => e.preventDefault();
  $('#bm').onclick = () => openSheet(`<div class="sheet-h"><h2>${esc(b.name)}</h2><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="menu">
    <button id="m1">Rename</button><button id="m2">Export as CSV</button><button id="m3">Copy as text list</button><button id="m4">Import cards (CSV or text list)</button>${b.id !== 'main' ? '<button id="m5" class="danger" style="color:var(--red)">Delete this binder</button>' : ''}</div>`, s => {
    $('#m1', s).onclick = () => promptSheet('Rename', b.name, v => { b.name = v; save(); route(); });
    $('#m2', s).onclick = () => { download(`${b.name}.csv`, binderCSV(b), 'text/csv'); closeSheet(); };
    $('#m3', s).onclick = () => { copy(Object.entries(b.items).map(([id, it]) => `${(it.q || 0) + (it.f || 0)} ${fullName(card(id))} [${card(id).ci}]${it.f ? ` (${it.f} foil)` : ''}`).join('\n')); closeSheet(); };
    $('#m4', s).onclick = () => importSheet(b);
    const m5 = $('#m5', s); if (m5) m5.onclick = () => confirmSheet('Delete binder?', `“${b.name}” and its ${st.total} cards will be removed. This can't be undone.`, () => { S.binders = S.binders.filter(x => x !== b); save(); location.hash = 'collection'; });
  });
};
function binderCSV(b) {
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  return ['Quantity,Foil,Title,Subtitle,Set,Set name,Card #,Rarity,Culture,Type,ID', ...Object.entries(b.items).map(([id, it]) => { const c = card(id); return [it.q || 0, it.f || 0, q(c.t), q(c.st), c.s, q(setName(c.s)), c.ci, c.r || '', q(c.cu), q(c.ty), c.id].join(','); })].join('\n');
}
function findCardByText(name, code) {
  if (code) { const k = codeKey(code); const id = DB.byCode.get(k); if (id) return card(id); const m = k.match(/^(\d+)[A-Z]+(\d+)$/); if (m && DB.bySetNum.get(+m[1] + '_' + +m[2])) return card(DB.bySetNum.get(+m[1] + '_' + +m[2])); }
  const n = norm(name); if (!n) return null;
  const phys = DB.cards.filter(c => !isErrata(c));
  return phys.find(c => c._n === n) || phys.find(c => c._t === n) || phys.find(c => c._n.startsWith(n)) || null;
}
function parseList(text) {
  const out = []; const miss = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim(); if (!line || /^(#|\/\/)/.test(line)) continue;
    if (/^quantity,/i.test(line)) continue;
    let q = 1, foil = 0, name = line, code = '';
    if (line.includes(',') && /^\d+,\d+,/.test(line)) { // our CSV
      const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(s => s.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
      const c = card(cells[10]) || findCardByText(cells[2] + (cells[3] ? ', ' + cells[3] : ''), cells[6]);
      if (c) out.push({ c, q: +cells[0] || 0, f: +cells[1] || 0 }); else miss.push(line); continue;
    }
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i); if (m) { q = +m[1]; name = m[2]; }
    const fm = name.match(/\((\d+) foil\)/i); if (fm) { foil = +fm[1]; name = name.replace(fm[0], ''); }
    const cm = name.match(/\[([^\]]+)\]|\(([0-9]{1,3}\s*[A-Z]\+?\s*[0-9]{1,3})\)/i); if (cm) { code = cm[1] || cm[2]; name = name.replace(cm[0], ''); }
    if (/^\d{1,3}\s*[CURPSA]\+?\s*\d{1,3}$/i.test(name.trim())) { code = name.trim(); name = ''; }
    const c = findCardByText(name.trim(), code);
    if (c) out.push({ c, q: Math.max(0, q - foil), f: foil }); else miss.push(line);
  }
  return { out, miss };
}
function importSheet(b) {
  openSheet(`<div class="sheet-h"><h2>Import into ${esc(b.name)}</h2><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <p class="help">Paste one card per line: <code>3 Aragorn, Ranger of the North</code>, <code>2x Elven Bow [1C41]</code> or just <code>1R89</code>. RingBox CSV exports work too.</p>
    <textarea id="it" placeholder="4 Gandalf, The Grey Wizard&#10;1R89"></textarea><div class="row" style="margin-top:10px"><label class="btn"><input type="file" id="ifile" accept=".csv,.txt,text/*" hidden>Choose file</label><button class="btn primary" id="ido">Import</button></div><div id="ires" class="small" style="margin-top:10px"></div>`, s => {
    $('#ifile', s).onchange = async e => { const f = e.target.files[0]; if (f) $('#it', s).value = await f.text(); };
    $('#ido', s).onclick = () => {
      const { out, miss } = parseList($('#it', s).value);
      for (const x of out) { if (x.q) addTo(b.id, x.c.id, x.q); if (x.f) addTo(b.id, x.c.id, x.f, true); }
      $('#ires', s).innerHTML = `<p class="ok">Added ${out.reduce((a, x) => a + x.q + x.f, 0)} cards.</p>${miss.length ? `<p class="warn">Couldn't match ${miss.length} line(s):</p><pre class="ocr-debug">${esc(miss.join('\n'))}</pre>` : ''}`;
      refreshView();
    };
  });
}

V.sets = (main) => {
  setTop('Sets', '', true);
  const comp = new Map(setCompletion().map(x => [x.s.s, x]));
  const groups = [['Decipher sets', s => s.kind === 'decipher'], ["Player's Council virtual sets", s => s.kind === 'pc'], ["PC errata", s => s.kind === 'pc-errata']];
  main.innerHTML = groups.map(([h, f]) => `<div class="section-h"><h2>${h}</h2></div><div class="cards-list cols">${DB.sets.filter(f).map(s => { const x = comp.get(s.s); const n = DB.cards.filter(c => c.s === s.s).length; return `<button class="bcard" data-go="set-${s.s}"><div class="grow"><div class="row nowrap" style="justify-content:space-between"><h3>${esc(s.name)}</h3>${x ? `<span class="pct">${x.n ? Math.round(x.have / x.n * 100) : 0}%</span>` : ''}</div><div class="meta">Set ${s.s}${s.ab ? ' · ' + esc(s.ab) : ''}${s.date ? ' · ' + s.date.slice(0, 4) : ''} · ${n} cards${x ? ` · ${x.have} owned` : ''}</div>${x ? `<div class="progress"><i style="width:${x.n ? x.have / x.n * 100 : 0}%"></i></div>` : ''}</div></button>`; }).join('')}</div>`).join('');
};
V.set = (main, s) => {
  s = +s; const st = DB.setBy.get(s);
  setTop(st ? st.name : 'Set', '', true);
  const cs = DB.cards.filter(c => c.s === s).sort(SORTS.set);
  const have = cs.filter(c => ownedCount(c.id) > 0).length;
  main.innerHTML = `<p class="muted">${cs.length} cards${st?.date ? ` · released ${st.date}` : ''}${s <= 19 ? ` · you have ${have} (${cs.length ? Math.round(have / cs.length * 100) : 0}%)` : ''}</p><div class="chips" style="margin-bottom:12px"><button class="chip on" data-f="all">All</button><button class="chip" data-f="own">Owned</button><button class="chip" data-f="miss">Missing</button></div><div id="sres"></div>`;
  const draw = f => paged($('#sres'), cs.filter(c => f === 'all' || (f === 'own') === (ownedCount(c.id) > 0)), S.prefs.grid ? c => tileHTML(c) : c => rowHTML(c), { grid: S.prefs.grid });
  draw('all');
  $$('.chip[data-f]', main).forEach(b => b.onclick = () => { $$('.chip[data-f]', main).forEach(x => x.classList.toggle('on', x === b)); draw(b.dataset.f); });
};

/* decks */
function newDeck(name, fields = {}) {
  const d = { id: uid(), name, folder: '', format: 'pc_movie', rb: null, ring: null, sites: [], draw: {}, maybe: {}, notes: '', updated: Date.now(), ...fields };
  S.decks.unshift(d); save(); return d;
}
V.decks = (main) => {
  setTop('Decks', `<button class="icon-btn" id="imp" aria-label="Import deck list"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></button>`);
  const folders = [...new Set(S.decks.map(d => d.folder || ''))].sort();
  main.innerHTML = !S.decks.length ? emptyHTML('No decks yet', 'Build a Fellowship and a Shadow side, pick 9 sites, and RingBox checks the rules as you go.', '<rect x="7" y="4" width="11" height="15" rx="1.5"/><rect x="5" y="5" width="11" height="15" rx="1.5"/>') + '<div class="row" style="justify-content:center"><button class="btn tonal" id="imp2">Import a deck list</button></div>' :
    folders.map(f => `<div class="section-h"><h2>${f ? esc(f) : 'All decks'}</h2><span class="count">${S.decks.filter(d => (d.folder || '') === f).length}</span></div><div class="deck-grid">${S.decks.filter(d => (d.folder || '') === f).map(d => { const v = validate(d); const art = card(d.rb) || deckCards(d).draw.sort((a, b) => b.q - a.q)[0]?.c; const ok = v.issues[0][0] === 'g'; const ne = v.issues.filter(i => i[0] === 'e').length; return `<button class="dtile" data-go="deck-${d.id}"><div class="banner" style="${art ? `background-image:url('${esc(IMG(art.im))}')` : ''}">${art ? '' : '<div class="noart"><svg viewBox="0 0 24 24"><rect x="7" y="4" width="11" height="15" rx="1.5"/><rect x="5" y="5" width="11" height="15" rx="1.5"/></svg></div>'}<span class="fmt">${esc(DB.fmtBy.get(d.format)?.name || 'No format')}</span><span class="status ${ok ? 'ok' : 'bad'}">${ok ? 'Legal' : `${ne} issue${ne === 1 ? '' : 's'}`}</span></div><div class="body"><h3>${esc(d.name)}</h3><div class="meta"><span>${v.total} cards</span><span class="fpn">${v.fp} FP</span><span class="shn">${v.sh} Shadow</span><span>${(d.sites || []).length}/9 sites</span></div></div></button>`; }).join('')}</div>`).join('');
  const nd = () => promptSheet('New deck', '', name => { const d = newDeck(name); location.hash = 'deck-' + d.id; }, 'Create');
  const imp = () => importDeckSheet();
  $('#imp').onclick = imp; fab('New deck', nd);
  if ($('#imp2')) $('#imp2').onclick = imp;
};
function deckText(d) {
  const { draw, rb, ring, sites, maybe } = deckCards(d);
  const L = (c, q) => `${q} ${fullName(c)} [${c.ci || c.id}]`;
  const by = side => draw.filter(x => x.c.sd === side).sort((a, b) => a.c.ty.localeCompare(b.c.ty) || a.c.t.localeCompare(b.c.t)).map(x => L(x.c, x.q));
  const other = draw.filter(x => !x.c.sd).map(x => L(x.c, x.q));
  return [`# ${d.name}`, `# Format: ${DB.fmtBy.get(d.format)?.name || '-'}`, '', 'Ring-bearer:', rb ? L(rb, 1) : '', 'Ring:', ring ? L(ring, 1) : '', '', 'Adventure deck:', ...sites.slice().sort((a, b) => (a.si || 0) - (b.si || 0)).map(s => L(s, 1)), '', 'Free Peoples:', ...by('F'), '', 'Shadow:', ...by('S'), ...(other.length ? ['', 'Other:', ...other] : []), ...(maybe.length ? ['', 'Maybe:', ...maybe.map(x => L(x.c, x.q))] : [])].join('\n');
}
function parseDeck(text, name) {
  const d = { draw: {}, maybe: {}, sites: [], rb: null, ring: null }; const miss = []; let sec = 'draw';
  for (let line of text.split(/\r?\n/)) {
    line = line.trim(); if (!line) continue;
    const fmt = line.match(/^#\s*format:\s*(.+)$/i); if (fmt) { const f = DB.formats.find(x => norm(x.name) === norm(fmt[1])); if (f) d.format = f.id; continue; }
    const nm = line.match(/^#\s*(.+)$/); if (nm) { if (!d.name) d.name = nm[1]; continue; }
    const h = line.match(/^(ring-?bearer|ring|adventure deck|sites?|free peoples?|shadow|other|maybe(board)?|draw deck|deck|sideboard)\s*:?\s*$/i);
    if (h) { const k = h[1].toLowerCase(); sec = k.startsWith('ring-') || k === 'ringbearer' ? 'rb' : k === 'ring' ? 'ring' : k.startsWith('adv') || k.startsWith('site') ? 'sites' : k.startsWith('maybe') || k === 'sideboard' ? 'maybe' : 'draw'; continue; }
    const { out, miss: m } = parseList(line); miss.push(...m);
    for (const { c, q, f } of out) {
      const n = (q || 0) + (f || 0) || 1;
      if (sec === 'rb') d.rb = c.id;
      else if (sec === 'ring' || c.ty === 'The One Ring') d.ring = c.id;
      else if (sec === 'sites' || c.ty === 'Site') d.sites.push(c.id);
      else { const box = sec === 'maybe' ? d.maybe : d.draw; box[c.id] = (box[c.id] || 0) + n; }
    }
  }
  d.name = d.name || name || 'Imported deck';
  return { d, miss };
}
function importDeckSheet() {
  openSheet(`<div class="sheet-h"><h2>Import deck</h2><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
  <p class="help">Paste a deck list. Use section lines like <code>Ring-bearer:</code>, <code>Ring:</code>, <code>Adventure deck:</code>, <code>Free Peoples:</code>, <code>Shadow:</code>. Each card is <code>4 Title, Subtitle</code> or <code>4x 1R89</code>.</p>
  <textarea id="dt" placeholder="Ring-bearer:&#10;1 Frodo, Son of Drogo&#10;Ring:&#10;1 The One Ring, The Ruling Ring&#10;Free Peoples:&#10;4 Aragorn, Ranger of the North"></textarea><div class="row" style="margin-top:10px"><button class="btn primary" id="dok">Import</button></div><div id="dres" class="small"></div>`, s => {
    $('#dok', s).onclick = () => {
      const { d, miss } = parseDeck($('#dt', s).value);
      const nd = newDeck(d.name, { ...d, format: d.format || 'pc_movie' });
      if (miss.length) { $('#dres', s).innerHTML = `<p class="warn">Imported, but couldn't match ${miss.length} line(s):</p><pre class="ocr-debug">${esc(miss.join('\n'))}</pre><button class="btn" id="go">Open deck</button>`; $('#go', s).onclick = () => { closeSheet(); location.hash = 'deck-' + nd.id; }; }
      else { closeSheet(); location.hash = 'deck-' + nd.id; }
    };
  });
}
let deckTab = 'cards', deckAddQ = '';
V.deck = (main, id) => {
  const d = S.decks.find(x => x.id === id); if (!d) { location.hash = 'decks'; return; }
  setTop(d.name, `<button class="icon-btn" id="dm" aria-label="Deck options"><svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18" r="1.4"/></svg></button>`, true);
  const v = validate(d);
  main.innerHTML = `
  <div class="row nowrap"><select id="dfmt" class="grow">${DB.formats.map(f => `<option value="${f.id}" ${d.format === f.id ? 'selected' : ''}>${esc(f.name)}${f.active ? '' : ' (historic)'}</option>`).join('')}</select></div>
  <div class="summary" style="margin-top:10px"><div class="stat"><b>${v.total}</b><span>Draw deck</span></div><div class="stat"><b style="color:var(--fp)">${v.fp}</b><span>Free Peoples</span></div><div class="stat"><b style="color:var(--sh)">${v.sh}</b><span>Shadow</span></div><div class="stat"><b>${(d.sites || []).length}/9</b><span>Sites</span></div></div>
  <div class="tabsub">${[['cards', 'Cards'], ['add', 'Add cards'], ['stats', 'Stats'], ['hand', 'Test hand'], ['notes', 'Notes']].map(([k, l]) => `<button data-t="${k}" class="${deckTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  <div id="dbody"></div>`;
  $('#dfmt').onchange = e => { d.format = e.target.value; d.updated = Date.now(); save(); route(); };
  $$('.tabsub button', main).forEach(b => b.onclick = () => { deckTab = b.dataset.t; route(); });
  const body = $('#dbody');
  ({ cards: deckCardsTab, add: deckAddTab, stats: deckStatsTab, hand: deckHandTab, notes: deckNotesTab })[deckTab](body, d, v);
  $('#dm').onclick = () => openSheet(`<div class="sheet-h"><h2>${esc(d.name)}</h2><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="menu">
    <button id="o1">Rename</button><button id="o2">Move to folder</button><button id="o3">Copy deck list</button><button id="o4">Download deck list (.txt)</button><button id="o5">Duplicate</button><button id="o6">Add missing cards to Wishlist</button><button id="o7" style="color:var(--red)">Delete deck</button></div>`, s => {
    $('#o1', s).onclick = () => promptSheet('Rename deck', d.name, x => { d.name = x; save(); route(); });
    $('#o2', s).onclick = () => promptSheet('Folder name', d.folder, x => { d.folder = x; save(); route(); }, 'Move');
    $('#o3', s).onclick = () => { copy(deckText(d)); closeSheet(); };
    $('#o4', s).onclick = () => { download(`${d.name}.txt`, deckText(d)); closeSheet(); };
    $('#o5', s).onclick = () => { const n = newDeck(d.name + ' (copy)', JSON.parse(JSON.stringify({ ...d, id: undefined }))); n.id = uid(); save(); closeSheet(); location.hash = 'deck-' + n.id; };
    $('#o6', s).onclick = () => { const m = missingFor(d); m.forEach(([c, n]) => addTo('wish', c.id, n)); closeSheet(); toast(m.length ? `Added ${m.reduce((a, x) => a + x[1], 0)} cards to Wishlist` : 'You own everything in this deck'); };
    $('#o7', s).onclick = () => confirmSheet('Delete deck?', `“${d.name}” will be deleted. This can't be undone.`, () => { S.decks = S.decks.filter(x => x !== d); save(); location.hash = 'decks'; });
  });
};
function missingFor(d) {
  const { draw, rb, ring, sites } = deckCards(d); const need = new Map();
  const add = (c, n) => need.set(c.id, (need.get(c.id) || 0) + n);
  draw.forEach(x => add(x.c, x.q)); rb && add(rb, 1); ring && add(ring, 1); sites.forEach(s => add(s, 1));
  return [...need].map(([id, n]) => [card(id), n - ownedCount(id)]).filter(x => x[1] > 0);
}
function deckCardsTab(body, d, v) {
  const { draw, rb, ring, sites, maybe } = deckCards(d);
  const owned = id => ownedCount(id);
  const row = (c, q, where) => { const miss = Math.max(0, q - owned(c.id)); return `<div class="drow">${where === 'single' ? `<button class="rm" data-rm="${where}" data-id="${c.id}" aria-label="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : `<span class="qty"><button data-dq="-1" data-w="${where}" data-id="${c.id}" aria-label="Remove one">−</button><b>${q}</b><button data-dq="1" data-w="${where}" data-id="${c.id}" aria-label="Add one">+</button></span>`}<img class="thumb" loading="lazy" alt="" src="${esc(IMG(c.im))}" data-card="${c.id}" onerror="this.style.visibility='hidden'"><div class="name" data-card="${c.id}"><div class="t">${c.u ? '• ' : ''}${esc(c.t)}</div><div class="sub"><span class="cult"><i style="background:${cc(c.cu)}"></i>${esc(c.st || c.cu || '')}</span>${miss ? ` <span class="missing">need ${miss}</span>` : ''}</div></div><div>${c.ty === 'Site' ? `<span class="tw site">${c.si ?? '–'}</span>` : c.tw != null ? `<span class="tw ${c.sd === 'S' ? 'sh' : ''}">${c.tw}</span>` : ''}</div></div>`; };
  const typeOrder = ['Companion', 'Ally', 'Follower', 'Minion', 'Possession', 'Artifact', 'Condition', 'Event', 'Map'];
  const side = (sd, label) => { const xs = draw.filter(x => sd ? x.c.sd === sd : !x.c.sd); if (!xs.length) return ''; const n = xs.reduce((a, x) => a + x.q, 0); return `<div class="deck-sec"><h3>${label}<span class="count">${n}</span></h3><div class="list">${typeOrder.concat(TYPES).filter((t, i, a) => a.indexOf(t) === i).map(t => { const ys = xs.filter(x => x.c.ty === t).sort((a, b) => (a.c.tw ?? 0) - (b.c.tw ?? 0) || a.c.t.localeCompare(b.c.t)); return ys.length ? `<div class="subh">${t} · ${ys.reduce((a, x) => a + x.q, 0)}</div>${ys.map(x => row(x.c, x.q, 'draw')).join('')}` : ''; }).join('')}</div></div>`; };
  body.innerHTML = `
  <div class="panel"><ul class="issues">${v.issues.slice(0, 12).map(([k, t]) => `<li class="${k === 'w' ? 'w' : k === 'g' ? 'g' : ''}">${esc(t)}</li>`).join('')}${v.issues.length > 12 ? `<li class="w">…and ${v.issues.length - 12} more</li>` : ''}</ul></div>
  <div class="deck-sec"><h3>Ring-bearer & Ring</h3><div class="list">${rb ? row(rb, 1, 'single').replace('data-rm="single"', 'data-rm="rb"') : '<p class="small muted" style="padding:12px 14px;margin:0">No Ring-bearer yet — tap RB next to a companion in Add cards.</p>'}${ring ? row(ring, 1, 'single').replace('data-rm="single"', 'data-rm="ring"') : '<p class="small muted" style="padding:12px 14px;margin:0">No One Ring yet — search <code>t:"one ring"</code>.</p>'}</div></div>
  <div class="deck-sec"><h3>Adventure deck<span class="count">${sites.length}/9</span></h3><div class="list">${sites.slice().sort((a, b) => (a.si || 0) - (b.si || 0)).map(s => row(s, 1, 'single').replace('data-rm="single"', 'data-rm="sites"')).join('') || '<p class="small muted" style="padding:12px 14px;margin:0">Add 9 sites.</p>'}</div></div>
  ${side('F', 'Free Peoples')}${side('S', 'Shadow')}${side(null, 'Other')}
  ${maybe.length ? `<div class="deck-sec"><h3>Maybeboard<span class="count">${maybe.reduce((a, x) => a + x.q, 0)}</span></h3><div class="list">${maybe.map(x => row(x.c, x.q, 'maybe')).join('')}</div></div>` : ''}
  ${!draw.length ? `<div class="row" style="margin-top:16px"><button class="btn primary" id="goadd">Add cards</button></div>` : ''}`;
  $$('button[data-dq]', body).forEach(b => b.onclick = () => { const box = d[b.dataset.w]; const id = b.dataset.id; box[id] = (box[id] || 0) + +b.dataset.dq; if (box[id] <= 0) delete box[id]; d.updated = Date.now(); save(); route(); });
  $$('button[data-rm]', body).forEach(b => b.onclick = () => { const w = b.dataset.rm; if (w === 'sites') d.sites = d.sites.filter(x => x !== b.dataset.id); else d[w] = null; save(); route(); });
  if ($('#goadd', body)) $('#goadd', body).onclick = () => { deckTab = 'add'; route(); };
}
function deckAddTab(body, d) {
  const fm = DB.fmtBy.get(d.format);
  body.innerHTML = `<form class="searchbar" id="af" style="position:static;margin-top:0"><div class="field"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input type="search" id="aq" placeholder="Search cards legal in ${esc(fm?.name || 'any format')}" value="${esc(deckAddQ)}" autocomplete="off"></div></form><div class="chips" style="margin-bottom:10px"><button class="chip" data-q="is:rb">Ring-bearers</button><button class="chip" data-q='t:"one ring"'>The One Ring</button><button class="chip" data-q="t:site">Sites</button><button class="chip" data-q="side:fp t:companion">Companions</button><button class="chip" data-q="side:shadow t:minion">Minions</button><button class="chip" data-q="is:owned">Owned</button></div><div id="ares" class="list"></div>`;
  const draw = () => {
    const res = runSearch(deckAddQ, { fmt: d.format }, 'tw').slice(0, 80);
    const inDeck = id => (d.draw[id] || 0) + (d.sites.includes(id) ? 1 : 0) + (d.rb === id ? 1 : 0) + (d.ring === id ? 1 : 0);
    $('#ares').innerHTML = res.map(c => `<div class="drow"><span class="qty">${c.ty === 'Site' ? `<button data-a="sites" data-id="${c.id}" aria-label="Add site">+</button>` : c.ty === 'The One Ring' ? `<button data-a="ring" data-id="${c.id}" aria-label="Set ring">+</button>` : `<button data-a="draw" data-id="${c.id}" aria-label="Add">+</button>`}<b>${inDeck(c.id) || ''}</b></span><img class="thumb" loading="lazy" alt="" src="${esc(IMG(c.im))}" data-card="${c.id}" onerror="this.style.visibility='hidden'"><div class="name" data-card="${c.id}"><div class="t">${c.u ? '• ' : ''}${esc(c.t)}${c.st ? `<span class="muted">, ${esc(c.st)}</span>` : ''}</div><div class="sub"><span class="cult"><i style="background:${cc(c.cu)}"></i>${esc(c.cu || '')}</span> · ${esc(c.ty)}${c.str != null ? ` · ${c.str}/${c.vit}` : ''}${ownedCount(c.id) ? ` · own ${ownedCount(c.id)}` : ''}</div></div><div class="row nowrap">${c.rb ? `<button class="btn sm" data-a="rb" data-id="${c.id}">RB</button>` : ''}${c.ty === 'Site' ? `<span class="tw">${c.si ?? '–'}</span>` : c.tw != null ? `<span class="tw ${c.sd === 'S' ? 'sh' : ''}">${c.tw}</span>` : ''}</div></div>`).join('') || emptyHTML('No legal cards match', 'Change the search or the deck format.');
    $$('#ares button[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a, id = b.dataset.id;
      if (a === 'draw') d.draw[id] = (d.draw[id] || 0) + 1; else if (a === 'sites') { if (!d.sites.includes(id)) d.sites.push(id); else return toast('Already in your adventure deck'); } else d[a] = id;
      d.updated = Date.now(); save(); toast(`Added ${card(id).t}`); draw();
      const v = validate(d); const st = $$('.summary .stat b'); if (st.length) { st[0].textContent = v.total; st[1].textContent = v.fp; st[2].textContent = v.sh; st[3].textContent = `${d.sites.length}/9`; }
    });
  };
  draw();
  let t; $('#aq').oninput = e => { deckAddQ = e.target.value; clearTimeout(t); t = setTimeout(draw, 160); };
  $('#af').onsubmit = e => { e.preventDefault(); $('#aq').blur(); };
  $$('.chip[data-q]', body).forEach(b => b.onclick = () => { deckAddQ = b.dataset.q; $('#aq').value = deckAddQ; draw(); });
}
function deckStatsTab(body, d, v) {
  const { draw } = deckCards(d);
  const curve = side => { const a = Array(8).fill(0); draw.filter(x => x.c.sd === side && x.c.tw != null).forEach(x => a[Math.min(7, x.c.tw)] += x.q); return a; };
  const fp = curve('F'), sh = curve('S'); const mx = Math.max(1, ...fp.map((x, i) => x + sh[i]));
  const sum = (arr, side) => { const xs = draw.filter(x => x.c.sd === side && x.c.tw != null); const n = xs.reduce((a, x) => a + x.q, 0); return n ? (xs.reduce((a, x) => a + x.q * x.c.tw, 0) / n).toFixed(2) : '–'; };
  const by = key => { const m = new Map(); draw.forEach(x => m.set(x.c[key] || 'None', (m.get(x.c[key] || 'None') || 0) + x.q)); return [...m].sort((a, b) => b[1] - a[1]); };
  const cult = by('cu'), types = by('ty'); const tot = Math.max(1, v.total);
  const comps = draw.filter(x => x.c.ty === 'Companion');
  const fpShadowTw = draw.filter(x => x.c.sd === 'F').reduce((a, x) => a + (x.c.tw || 0) * x.q, 0);
  const miss = missingFor(d); const needN = miss.reduce((a, x) => a + x[1], 0);
  const allN = v.total + (d.rb ? 1 : 0) + (d.ring ? 1 : 0) + d.sites.length;
  body.innerHTML = `
  <div class="summary"><div class="stat"><b>${sum(fp, 'F')}</b><span>FP avg cost</span></div><div class="stat"><b>${sum(sh, 'S')}</b><span>Shadow avg cost</span></div><div class="stat"><b>${comps.reduce((a, x) => a + x.q, 0)}</b><span>Companions</span></div><div class="stat"><b>${fpShadowTw}</b><span>FP twilight</span></div></div>
  <div class="panel"><h3 style="font-size:17px">Twilight curve</h3><div class="curve">${fp.map((f, i) => `<div class="col"><span>${f + sh[i] || ''}</span><div class="stack" style="height:${(f + sh[i]) / mx * 100}%"><i style="height:${f + sh[i] ? f / (f + sh[i]) * 100 : 0}%;background:var(--fp)"></i><i style="height:${f + sh[i] ? sh[i] / (f + sh[i]) * 100 : 0}%;background:var(--sh)"></i></div><b>${i === 7 ? '7+' : i}</b></div>`).join('')}</div><div class="legend"><span><i style="background:var(--fp)"></i>Free Peoples</span><span><i style="background:var(--sh)"></i>Shadow</span></div></div>
  <div class="panel"><h3 style="font-size:17px;margin-bottom:8px">Cultures</h3><div class="bars">${cult.map(([k, n]) => `<div class="bar"><span class="cult"><i style="background:${cc(k)}"></i>${esc(k)}</span><div class="track"><i style="width:${n / tot * 100}%;background:${cc(k)}"></i></div><span class="n">${n}</span></div>`).join('') || '<p class="muted small">Add cards to see stats.</p>'}</div></div>
  <div class="panel"><h3 style="font-size:17px;margin-bottom:8px">Card types</h3><div class="bars">${types.map(([k, n]) => `<div class="bar"><span>${esc(k)}</span><div class="track"><i style="width:${n / tot * 100}%;background:var(--gold)"></i></div><span class="n">${n}</span></div>`).join('')}</div></div>
  ${comps.length ? `<div class="panel"><h3 style="font-size:17px;margin-bottom:8px">Companions</h3><table class="odds"><tr><th>Companion</th><th class="n">Tw</th><th class="n">Str</th><th class="n">Vit</th><th class="n">Res</th></tr>${comps.map(x => `<tr><td>${x.q}× ${esc(x.c.t)}</td><td class="n">${x.c.tw ?? ''}</td><td class="n">${x.c.str ?? ''}</td><td class="n">${x.c.vit ?? ''}</td><td class="n">${x.c.res ?? ''}</td></tr>`).join('')}</table></div>` : ''}
  <div class="panel"><h3 style="font-size:17px">Collection</h3><p>You own ${allN - needN} of ${allN} cards in this deck.${needN ? ` Missing ${needN}.` : ''}</p>${miss.length ? `<div class="list">${miss.map(([c, n]) => rowHTML(c, `need ${n}`)).join('')}</div><button class="btn" id="tw">Add missing to Wishlist</button>` : ''}</div>`;
  if ($('#tw', body)) $('#tw', body).onclick = () => { miss.forEach(([c, n]) => addTo('wish', c.id, n)); toast(`Added ${needN} cards to Wishlist`); };
}
function hyper(N, K, n, k) { // P(X >= k)
  const lc = (a, b) => { if (b < 0 || b > a) return -Infinity; let s = 0; for (let i = 1; i <= b; i++) s += Math.log(a - b + i) - Math.log(i); return s; };
  let p = 0; for (let i = k; i <= Math.min(K, n); i++) p += Math.exp(lc(K, i) + lc(N - K, n - i) - lc(N, n)); return p;
}
let hand = null;
function deckHandTab(body, d, v) {
  const { draw } = deckCards(d);
  const pool = draw.flatMap(x => Array(x.q).fill(x.c.id));
  const deal = () => { const p = pool.slice(); for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } hand = { deck: d.id, lib: p, n: Math.min(8, p.length) }; };
  if (!hand || hand.deck !== d.id || hand.lib.length !== pool.length) deal();
  const N = pool.length;
  const render = () => {
    const shown = hand.lib.slice(0, hand.n);
    const fpN = shown.filter(id => card(id).sd === 'F').length;
    body.innerHTML = !N ? emptyHTML('Add cards first', 'The test hand draws from your draw deck.') : `
    <div class="row" style="margin-bottom:10px"><button class="btn primary" id="nh">New hand</button><button class="btn" id="d1" ${hand.n >= N ? 'disabled' : ''}>Draw a card</button><span class="muted small">${hand.n} drawn · ${fpN} Free Peoples / ${hand.n - fpN} Shadow · ${N - hand.n} left in deck</span></div>
    <div class="hand">${shown.map(id => tileHTML(card(id), { count: 0, cap: false })).join('')}</div>
    <div class="panel" style="margin-top:14px"><h3 style="font-size:17px">Odds in your opening 8</h3><p class="small muted">Chance to draw at least one copy, from a ${N}-card draw deck.</p><table class="odds"><tr><th>Card</th><th class="n">Copies</th><th class="n">In 8</th><th class="n">In 12</th></tr>${draw.slice().sort((a, b) => b.q - a.q || a.c.t.localeCompare(b.c.t)).map(x => `<tr><td>${esc(x.c.t)}</td><td class="n">${x.q}</td><td class="n pct">${Math.round(hyper(N, x.q, Math.min(8, N), 1) * 100)}%</td><td class="n pct">${Math.round(hyper(N, x.q, Math.min(12, N), 1) * 100)}%</td></tr>`).join('')}</table></div>`;
    if (!N) return;
    $('#nh').onclick = () => { deal(); render(); };
    $('#d1').onclick = () => { hand.n = Math.min(N, hand.n + 1); render(); };
  };
  render();
}
function deckNotesTab(body, d) {
  body.innerHTML = `<textarea id="nt" placeholder="Strategy, sideboard plans, matchups…" style="min-height:240px;font-family:inherit">${esc(d.notes || '')}</textarea><p class="small dim">Saved as you type.</p>`;
  $('#nt').oninput = e => { d.notes = e.target.value; save(); };
}

V.more = (main) => {
  setTop('More');
  main.innerHTML = `<div class="menu">
    <a href="#sets"><span class="mi"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg></span><div><b>Browse sets</b><div class="d">All 19 Decipher sets plus Player's Council virtual sets</div></div></a>
    <a href="#favorites"><span class="mi"><svg viewBox="0 0 24 24"><path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/></svg></span><div><b>Favorites</b><div class="d">${S.favs.length} starred card${S.favs.length === 1 ? '' : 's'}</div></div></a>
    <button id="bk"><span class="mi"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></span><div><b>Back up everything</b><div class="d">Download your binders, decks and favorites as one file</div></div></button>
    <label><span class="mi"><svg viewBox="0 0 24 24"><path d="M12 20V9M7 14l5-5 5 5M5 4h14"/></svg></span><div><b>Restore a backup</b><div class="d">Replaces what's on this device</div></div><input type="file" id="rs" accept=".json,application/json" hidden></label>
    <button id="th"><span class="mi"><svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg></span><div><b>Appearance: ${S.prefs.theme === 'light' ? 'Light' : 'Dark'}</b><div class="d">Tap to switch</div></div></button>
  </div>
  <div class="section-h"><h2>About</h2></div><div class="panel">
  <p class="small muted">Your collection and decks are stored on this device only — use backups to move them. Works offline once loaded; add it to your home screen from the browser's share menu.</p>
  <p class="small muted">Card data and images come from the <a href="https://lotrtcgpc.net" target="_blank" rel="noopener">LOTR TCG Player's Council</a> (<a href="https://github.com/PlayersCouncil/lotrtcg-card-data" target="_blank" rel="noopener">card data</a>, <a href="https://wiki.lotrtcgpc.net" target="_blank" rel="noopener">wiki</a>). ${DB.cards.length.toLocaleString()} card records.</p>
  <p class="small dim">The Lord of the Rings TCG is © Decipher Inc. and Middle-earth Enterprises. RingBox is an unofficial fan tool and isn't affiliated with or endorsed by them.</p></div>`;
  $('#bk').onclick = () => download(`ringbox-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'ringbox', v: 1, at: new Date().toISOString(), data: S }, null, 1), 'application/json');
  $('#rs').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); const data = j.data || j; if (!data.binders) throw 0; confirmSheet('Restore backup?', `This replaces your ${S.binders.length} binders and ${S.decks.length} decks on this device with the backup from ${j.at ? j.at.slice(0, 10) : 'the file'}.`, () => { Object.assign(S, data); save(); toast('Backup restored'); route(); }, 'Restore'); } catch { toast("That file isn't a RingBox backup"); }
  };
  $('#th').onclick = () => { S.prefs.theme = S.prefs.theme === 'light' ? '' : 'light'; applyTheme(); save(); route(); };
};
V.favorites = (main) => {
  setTop('Favorites', '', true);
  const cs = S.favs.map(card).filter(Boolean);
  if (!cs.length) { main.innerHTML = emptyHTML('No favorites yet', 'Tap the star on any card to keep it here.'); return; }
  paged(main, cs, c => tileHTML(c));
};
V.scan = (main) => { setTop('Scan cards'); window.Scanner ? window.Scanner.mount(main) : (main.innerHTML = '<p>Scanner failed to load.</p>'); };

/* ---------- router ---------- */
function applyTheme() { if (S.prefs.theme) document.documentElement.dataset.theme = S.prefs.theme; else delete document.documentElement.dataset.theme; }
function route() {
  const h = (location.hash || '#search').slice(1);
  const m = h.match(/^([a-z]+)(?:-(.+))?$/) || ['', 'search'];
  let [, name, arg] = m;
  if (!V[name]) name = 'search';
  if (current.name === 'scan' && name !== 'scan' && window.Scanner) window.Scanner.stop();
  current = { name, arg };
  const tab = { binder: 'collection', sets: 'more', set: 'more', favorites: 'more', deck: 'decks' }[name] || name;
  $$('.tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  const main = $('#view'); main.innerHTML = '';
  V[name](main, arg);
  if (!route.keepScroll) window.scrollTo(0, 0);
  route.keepScroll = false;
}
function refreshView() { if (current.name === 'scan') return; const y = scrollY; route.keepScroll = true; route(); window.scrollTo(0, y); }

document.addEventListener('click', e => {
  const cl = e.target.closest('[data-close]'); if (cl) { e.preventDefault(); closeSheet(); return; }
  const cg = e.target.closest('[data-close-go]'); if (cg) { closeSheet(); return; }
  const cd = e.target.closest('[data-card]'); if (cd) { e.preventDefault(); openCard(cd.dataset.card); return; }
  const go = e.target.closest('[data-go]'); if (go) { location.hash = go.dataset.go; return; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const z = $('.zoom'); if (z) z.remove(); else if (!$('#sheetWrap').hidden) closeSheet(); } });
$('#backBtn').onclick = () => { if (history.length > 1) history.back(); else location.hash = 'search'; };
window.addEventListener('hashchange', () => { if (!$('#sheetWrap').hidden) { $('#sheetWrap').hidden = true; document.body.style.overflow = ''; } route(); });

(async () => {
  load(); applyTheme();
  try { await loadData(); } catch (e) { $('#view').innerHTML = `<div class="empty"><h3>Couldn't load the card data</h3><p>${esc(e.message)}</p></div>`; return; }
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
window.RB = { DB, S, card, IMG, esc, norm, codeKey, fullName, imgTag, addTo, binder, save, toast, openCard, openSheet, closeSheet, ownedCount, isErrata, isPhysical, $, $$ };
