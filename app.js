'use strict';

/* ---------- Konstanta ---------- */
const API = 'https://api.modrinth.com/v2';
const KEY = 'reonzy-mp-maker-v1';
const TYPES = {
  mod:          { folder: 'mods',          path: 'mod' },
  resourcepack: { folder: 'resourcepacks', path: 'resourcepack' },
  shader:       { folder: 'shaderpacks',   path: 'shader' }
};
const LOADERS = {
  fabric:   { label: 'Fabric',   key: 'fabric-loader', cats: ['fabric'] },
  quilt:    { label: 'Quilt',    key: 'quilt-loader',  cats: ['quilt', 'fabric'] },
  forge:    { label: 'Forge',    key: 'forge',         cats: ['forge'] },
  neoforge: { label: 'NeoForge', key: 'neoforge',      cats: ['neoforge'] }
};
/* ---------- Daftar tag populer per tipe ---------- */
const TAGS = {
  mod: ['adventure', 'magic', 'technology', 'optimization', 'utility', 'worldgen', 'mobs', 'decoration', 'equipment', 'food', 'storage', 'library'],
  resourcepack: ['realistic', 'vanilla-like', 'themed', 'simplistic', 'tweaks', 'decoration', 'environment', 'gui', 'models', 'utility'],
  shader: ['realistic', 'semi-realistic', 'vanilla-like', 'fantasy', 'potato', 'low', 'medium', 'high', 'shadows', 'reflections', 'bloom', 'pbr']
};
/* Loader & lingkungan bukan tag konten — disembunyikan dari daftar tag kartu */
const HIDE_TAGS = new Set(['fabric', 'forge', 'neoforge', 'quilt', 'client', 'server', 'client_only', 'server_only', 'client_and_server', 'singleplayer', 'multiplayer']);
function tagLabel(tag) {
  return tag.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}
function cardTags(h) {
  const raw = h.display_categories && h.display_categories.length ? h.display_categories : (h.categories || []);
  return raw.filter(c => !HIDE_TAGS.has(c)).slice(0, 5);
}
function toggleTag(tag) {
  const on = S.tags.includes(tag);
  S.tags = on ? S.tags.filter(x => x !== tag) : [...S.tags, tag];
  save();
  renderTags();
  renderActiveFilters();
  renderResults();
  runSearch(true);
}
const RANK = { release: 0, beta: 1, alpha: 2 };
const TLABEL = { release: 'Release', beta: 'Beta', alpha: 'Alpha' };
const TCLASS = { release: '', beta: 'warn', alpha: 'bad' };

/* ---------- Helper ---------- */
const $ = (s, r = document) => r.querySelector(s);
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}
const locale = () => (typeof S !== 'undefined' && S.lang === 'en') ? 'en-US' : 'id-ID';
const fmtNum = n => new Intl.NumberFormat(locale(), { notation: 'compact' }).format(n || 0);
const fmtDate = d => new Date(d).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' });
const slugify = s => (s || 'modpack').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'modpack';

let noticeTimer;
function toast(msg, kind = '') {
  const n = $('#notice');
  n.textContent = msg;
  n.className = 'show ' + kind;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { n.className = ''; }, 5200);
}

const cache = new Map();
async function getJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
  cache.set(url, p);
  try { return await p; } catch (e) { cache.delete(url); throw e; }
}

async function pool(arr, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, async () => {
    while (i < arr.length) { const x = arr[i++]; await fn(x); }
  }));
}

function cmpVer(a, b) {
  const pa = a.split(/[.\-+]/), pb = b.split(/[.\-+]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = parseInt(pa[i], 10), y = parseInt(pb[i], 10);
    if (isNaN(x) || isNaN(y)) {
      if (pa[i] === pb[i]) continue;
      return (pa[i] || '') < (pb[i] || '') ? -1 : 1;
    }
    if (x !== y) return x - y;
  }
  return 0;
}

/* ---------- State ---------- */
const S = {
  lang: (() => { try { return localStorage.getItem(LANGKEY) || 'id'; } catch (e) { return 'id'; } })(),
  name: 'Modpack Saya', packVer: '1.0.0',
  mc: '', loader: 'fabric', loaderVer: '',
  pref: 'auto', autoDeps: true, showSnap: false,
  mcList: [], loaderList: null,
  items: [],
  tab: 'mod', query: '', tags: [], results: [], total: 0, offset: 0, searching: false, searchErr: false,
  gen: 0
};
let lvGen = 0, searchGen = 0;

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      name: S.name, packVer: S.packVer, mc: S.mc, loader: S.loader, loaderVer: S.loaderVer,
      pref: S.pref, autoDeps: S.autoDeps, showSnap: S.showSnap, tab: S.tab, tags: S.tags,
      items: S.items.map(i => ({ id: i.id, vid: i.manual ? i.vid : null, manual: !!i.manual, auto: !!i.auto, requiredBy: i.requiredBy || null }))
    }));
  } catch (e) { /* penyimpanan tidak tersedia */ }
}
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
}

/* ---------- Versi Minecraft & loader ---------- */
const mcOptions = () => S.mcList.filter(v => S.showSnap || v.version_type === 'release');

async function fetchLoaderVersions(loader, mc) {
  if (loader === 'fabric') {
    const d = await getJSON('https://meta.fabricmc.net/v2/versions/loader');
    return d.map(x => ({ v: x.version, stable: !!x.stable }));
  }
  if (loader === 'quilt') {
    const d = await getJSON('https://meta.quiltmc.org/v3/versions/loader');
    return d.map(x => ({ v: x.version, stable: !/-/.test(x.version) }));
  }
  if (loader === 'forge') {
    try {
      const d = await getJSON('https://bmclapi2.bangbang93.com/forge/minecraft/' + mc);
      if (Array.isArray(d) && d.length) return d.map(x => ({ v: x.version, stable: true }));
    } catch (e) { /* coba sumber cadangan */ }
    const p = await getJSON('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    const map = new Map();
    for (const [k, v] of Object.entries(p.promos || {})) {
      if (k === mc + '-latest' && !map.has(v)) map.set(v, false);
      if (k === mc + '-recommended') map.set(v, true);
    }
    return [...map].map(([v, stable]) => ({ v, stable }));
  }
  if (loader === 'neoforge') {
    try {
      const d = await getJSON('https://bmclapi2.bangbang93.com/neoforge/list/' + mc);
      const out = (Array.isArray(d) ? d : []).map(x => {
        const v = String(x.version || x.rawVersion || '').replace(/^neoforge-/, '');
        return { v, stable: !/-(beta|alpha|rc)/i.test(v) };
      }).filter(x => x.v);
      if (out.length) return out;
    } catch (e) { /* coba sumber cadangan */ }
    const m = mc.match(/^1\.(\d+)(?:\.(\d+))?/);
    if (!m) return [];
    const prefix = m[1] + '.' + (m[2] || 0) + '.';
    const d = await getJSON('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    return (d.versions || []).filter(v => v.startsWith(prefix)).map(v => ({ v, stable: !/-/.test(v) }));
  }
  return [];
}

async function refreshLoader() {
  const my = ++lvGen;
  S.loaderList = null;
  renderLoader();
  let list = [], failed = false;
  try { list = await fetchLoaderVersions(S.loader, S.mc); } catch (e) { failed = true; }
  if (my !== lvGen) return;
  list.sort((a, b) => cmpVer(b.v, a.v));
  S.loaderList = list;
  S.loaderFailed = failed;
  if (!list.some(x => x.v === S.loaderVer) && list.length) {
    const st = list.find(x => x.stable) || list[0];
    S.loaderVer = st.v;
  } else if (!list.length) {
    if (failed) { /* biarkan isian manual */ } else S.loaderVer = '';
  }
  renderLoader();
  save();
}

/* ---------- Versi mod ---------- */
function isMatch(item, v) {
  if (!v.game_versions.includes(S.mc)) return false;
  if (item.type === 'mod') return v.loaders.some(l => LOADERS[S.loader].cats.includes(l));
  return true;
}
function sortVersions(vs) {
  return vs.slice().sort((a, b) =>
    (Number(b.matches) - Number(a.matches)) ||
    (S.pref === 'auto' ? RANK[a.type] - RANK[b.type] : 0) ||
    (new Date(b.date) - new Date(a.date)));
}
async function loadVersions(item, all) {
  const q = new URLSearchParams({ include_changelog: 'false' });
  if (!all) {
    q.set('game_versions', JSON.stringify([S.mc]));
    if (item.type === 'mod') q.set('loaders', JSON.stringify(LOADERS[S.loader].cats));
  }
  const raw = await getJSON(API + '/project/' + item.id + '/version?' + q);
  return raw.map(v => ({
    id: v.id, name: v.name, number: v.version_number, type: v.version_type, date: v.date_published,
    gv: v.game_versions, loaders: v.loaders, files: v.files, deps: v.dependencies || [],
    matches: isMatch(item, v)
  }));
}

function makeItem(p) {
  return {
    id: p.project_id || p.id, slug: p.slug, title: p.title, icon: p.icon_url,
    type: p.project_type, client: p.client_side, server: p.server_side,
    versions: [], vid: null, manual: false, auto: false, requiredBy: null,
    status: 'loading', allLoaded: false
  };
}
const selVersion = item => item.versions.find(v => v.id === item.vid);
const depTitles = new Map(); // project_id -> nama tampilan dependensi (cache)
async function depName(d) {
  if (depTitles.has(d.project_id)) return depTitles.get(d.project_id);
  let name = d.project_id;
  try {
    const p = await getJSON(API + '/project/' + d.project_id);
    name = p.title || p.slug || d.project_id;
  } catch (e) { /* pakai id mentah */ }
  depTitles.set(d.project_id, name);
  return name;
}

async function resolveItem(item, gen) {
  item.status = 'loading';
  renderPack();
  try {
    let list = sortVersions(await loadVersions(item, false));
    if (gen !== undefined && gen !== S.gen) return;
    item.allLoaded = false;
    let keep = null;
    if (item.manual && item.vid) {
      keep = list.find(v => v.id === item.vid);
      if (!keep) {
        const all = sortVersions(await loadVersions(item, true));
        if (gen !== undefined && gen !== S.gen) return;
        keep = all.find(v => v.id === item.vid);
        if (keep) { list = all; item.allLoaded = true; }
      }
    }
    item.versions = list;
    if (!keep) item.manual = false;
    const chosen = keep || list.find(v => v.matches);
    item.vid = chosen ? chosen.id : null;
    item.status = chosen ? 'ready' : 'none';
    if (chosen) await addDeps(item, chosen, gen);
  } catch (e) {
    item.status = 'error';
  }
  renderPack();
  save();
}

async function addDeps(item, v, gen) {
  if (!S.autoDeps) return;
  for (const d of v.deps) {
    if (d.dependency_type !== 'required' || !d.project_id) continue;
    if (S.items.some(i => i.id === d.project_id)) continue;
    try {
      const p = await getJSON(API + '/project/' + d.project_id);
      if (gen !== undefined && gen !== S.gen) return;
      if (!TYPES[p.project_type] || S.items.some(i => i.id === p.id)) continue;
      const dep = makeItem(p);
      dep.auto = true;
      dep.requiredBy = item.title;
      S.items.push(dep);
      renderPack();
      resolveItem(dep, gen);
    } catch (e) { /* lewati dependensi yang gagal dimuat */ }
  }
}

function addItem(hit) {
  const id = hit.project_id;
  if (S.items.some(i => i.id === id)) return;
  const it = makeItem(hit);
  S.items.push(it);
  renderPack();
  renderResults();
  resolveItem(it, S.gen);
  save();
}
function removeItem(item) {
  S.items = S.items.filter(i => i !== item && (!item.id || i.id !== item.id));
  renderPack(); renderResults(); save();
}

async function onConfigChange() {
  const g = ++S.gen;
  save();
  runSearch(true);
  await pool(S.items.slice(), 6, i => resolveItem(i, g));
}

/* ---------- Pencarian ---------- */
function renderActiveFilters() {
  let bar = $('#activeFilters');
  if (!bar) {
    bar = el('div', { class: 'activefilters', id: 'activeFilters' });
    const tags = $('#tags');
    tags.after(bar);
  }
  bar.replaceChildren();
  if (!S.tags.length) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.append(el('span', { text: tr('activeTags') + ':' }));
  for (const tag of S.tags) {
    bar.append(el('button', {
      type: 'button', class: 'tagchip on',
      title: tr('tagOff', { tag: tagLabel(tag) }),
      onclick: () => toggleTag(tag)
    }, tagLabel(tag) + ' ', el('i', { text: '✕' })));
  }
  bar.append(el('button', { type: 'button', class: 'clearfilter', text: tr('clearTags'), onclick: clearTags }));
}
function clearTags() {
  if (!S.tags.length) return;
  S.tags = [];
  save();
  renderTags();
  renderActiveFilters();
  runSearch(true);
}
function renderTags() {
  const box = $('#tags');
  box.replaceChildren();
  for (const tag of TAGS[S.tab] || []) {
    const on = S.tags.includes(tag);
    box.append(el('button', {
      type: 'button', class: 'tagchip' + (on ? ' on' : ''), 'aria-pressed': String(on), text: tagLabel(tag),
      title: on ? tr('tagOff', { tag: tagLabel(tag) }) : tr('tagOn', { tag: tagLabel(tag) }),
      onclick: () => toggleTag(tag)
    }));
  }
}
async function runSearch(reset) {
  const my = ++searchGen;
  if (reset) { S.offset = 0; S.results = []; S.total = 0; }
  if (!S.mc) { renderResults(); return; }
  S.searching = true; S.searchErr = false;
  renderResults();
  try {
    const f = [['project_type:' + S.tab], ['versions:' + S.mc]];
    if (S.tab === 'mod') f.push(LOADERS[S.loader].cats.map(c => 'categories:' + c));
    if (S.tags.length) f.push(S.tags.map(tag => 'categories:' + tag));
    const q = new URLSearchParams({
      query: S.query, facets: JSON.stringify(f), limit: '20',
      offset: String(S.offset), index: S.query ? 'relevance' : 'downloads'
    });
    const d = await getJSON(API + '/search?' + q);
    if (my !== searchGen) return;
    S.results = S.results.concat(d.hits);
    S.total = d.total_hits;
    S.offset = S.results.length;
  } catch (e) {
    if (my !== searchGen) return;
    S.searchErr = true;
  }
  S.searching = false;
  renderResults();
}

/* ---------- Render: pengaturan ---------- */
function renderConfig() {
  const sel = $('#mc');
  sel.replaceChildren(...mcOptions().map(v =>
    el('option', { value: v.version, text: v.version + (v.version_type !== 'release' ? ' (' + v.version_type + ')' : '') })));
  sel.value = S.mc;
  $('#snap').checked = S.showSnap;
  $('#name').value = S.name;
  $('#packVer').value = S.packVer;
  $('#pref').value = S.pref;
  $('#deps').checked = S.autoDeps;
  document.querySelectorAll('#loaders input').forEach(r => { r.checked = r.value === S.loader; });
  renderLoaderHint();
}
function renderLoaderHint() {
  $('#loaderHint').textContent = S.loader === 'quilt' ? tr('quiltHint') : '';
}
function renderLoader() {
  const sel = $('#lv'), man = $('#lvManual'), hint = $('#lvHint');
  hint.className = 'hint';
  if (S.loaderList === null) {
    sel.replaceChildren(el('option', { text: tr('lvLoading') }));
    sel.disabled = true; sel.hidden = false; man.hidden = true; hint.textContent = '';
    return;
  }
  sel.disabled = false;
  if (!S.loaderList.length) {
    sel.hidden = true; man.hidden = false; man.value = S.loaderVer;
    hint.className = 'hint bad';
    hint.textContent = S.loaderFailed
      ? tr('lvManualFail')
      : tr('lvNone', { loader: LOADERS[S.loader].label, mc: S.mc });
    return;
  }
  sel.hidden = false; man.hidden = true;
  sel.replaceChildren(...S.loaderList.slice(0, 150).map(x =>
    el('option', { value: x.v, text: x.v + (x.stable ? '' : tr('betaTag')) })));
  if (!S.loaderList.slice(0, 150).some(x => x.v === S.loaderVer))
    sel.append(el('option', { value: S.loaderVer, text: S.loaderVer }));
  sel.value = S.loaderVer;
  hint.textContent = tr('lvAuto');
}

/* ---------- Render: hasil pencarian ---------- */
function icon(url, title, small) {
  const cls = 'ico' + (small ? ' sm' : '');
  const letter = (title || '?').trim().charAt(0).toUpperCase();
  if (!url) return el('div', { class: cls, text: letter });
  const img = el('img', { class: cls, src: url, alt: '', loading: 'lazy', width: small ? 36 : 52, height: small ? 36 : 52 });
  img.addEventListener('error', () => img.replaceWith(el('div', { class: cls, text: letter })));
  return img;
}
function renderResults() {
  const ul = $('#results'), info = $('#resInfo'), more = $('#more');
  ul.replaceChildren();
  more.hidden = true;
  const t = TYPES[S.tab];
  $('#tabHint').textContent = S.tab === 'shader' ? tr('tabHintShader') : '';
  if (!S.mc) { info.textContent = tr('mcFirst'); return; }
  if (S.searchErr) {
    info.textContent = '';
    ul.append(el('li', { class: 'empty' }, tr('searchFail'),
      el('button', { class: 'btn small', onclick: () => runSearch(S.results.length === 0), text: tr('retry') })));
    return;
  }
  if (S.searching && !S.results.length) {
    info.textContent = tr('searching');
    for (let i = 0; i < 6; i++) ul.append(el('li', { class: 'skel' }));
    return;
  }
  const scope = 'Minecraft ' + S.mc + (S.tab === 'mod' ? ' ' + tr('withLoader', { loader: LOADERS[S.loader].label }) : '');
  if (!S.results.length) {
    info.textContent = '';
    ul.append(el('li', { class: 'empty', text: tr('noResults', {
      plural: typePlural(S.tab),
      query: S.query ? tr('withQuery', { q: S.query }) : '',
      scope }) }));
    return;
  }
  info.textContent = tr('resCount', {
    total: S.total.toLocaleString(locale()),
    plural: typePlural(S.tab), scope });
  for (const h of S.results) {
    const inPack = S.items.some(i => i.id === h.project_id);
    const tags = cardTags(h);
    ul.append(el('li', { class: 'card' + (inPack ? ' in' : '') },
      icon(h.icon_url, h.title),
      el('div', {},
        el('h3', {}, h.title, el('small', { text: tr('by') + h.author })),
        el('p', { text: h.description }),
        tags.length ? el('div', { class: 'cardtags' }, ...tags.map(c =>
          el('button', {
            type: 'button', class: 'tagchip sm' + (S.tags.includes(c) ? ' on' : ''),
            text: tagLabel(c), title: tr('tagOn', { tag: tagLabel(c) }),
            onclick: () => toggleTag(c)
          })
        )) : null,
        el('div', { class: 'meta' },
          el('span', { text: fmtNum(h.downloads) + ' ' + tr('downloads') }),
          h.latest_version ? el('span', { text: tr('latest') + h.latest_version }) : null,
          el('a', { href: 'https://modrinth.com/' + t.path + '/' + h.slug, target: '_blank', rel: 'noopener', text: tr('viewModrinth') }))),
      inPack
        ? el('div', { class: 'inpack' },
          el('span', { class: 'have', title: tr('added'), 'aria-label': tr('added'), text: '✓' }),
          el('button', {
            class: 'unadd', title: tr('remove', { title: h.title }), 'aria-label': tr('remove', { title: h.title }),
            onclick: () => removeItem({ id: h.project_id }), text: '✕'
          }))
        : el('button', { class: 'btn add', onclick: () => addItem(h), text: tr('add') })));
  }
  more.hidden = S.results.length >= S.total;
  more.disabled = S.searching;
}

/* ---------- Render: isi pack ---------- */
async function addDepById(pid, requiredBy) {
  if (S.items.some(i => i.id === pid)) return;
  try {
    const p = await getJSON(API + '/project/' + pid);
    if (!TYPES[p.project_type] || S.items.some(i => i.id === p.id)) return;
    const it = makeItem(p);
    it.auto = true;
    it.requiredBy = requiredBy || null;
    S.items.push(it);
    depTitles.set(it.id, it.title);
    renderPack(); renderResults();
    resolveItem(it, S.gen);
    save();
  } catch (e) { toast(tr('depAddFail'), 'bad'); }
}
function missingDeps(item) {
  const v = selVersion(item);
  if (!v || !v.deps || item.type !== 'mod') return [];
  return v.deps.filter(d =>
    d.project_id && d.dependency_type === 'required' && !S.items.some(i => i.id === d.project_id));
}
function missingDepsCount() {
  return S.items.reduce((n, i) => n + missingDeps(i).length, 0);
}
function packState(item) {
  if (item.status === 'loading') return { cls: '', text: '' };
  if (item.status === 'none' || item.status === 'error') return { cls: 'bad' };
  const v = selVersion(item);
  if (!v || !v.matches) return { cls: 'bad' };
  return { cls: v.type === 'release' ? 'ok' : 'warn' };
}
function packRow(item) {
  const st = packState(item);
  const v = selVersion(item);
  const body = el('div', {}, el('b', { text: item.title }));
  const line = el('div', { class: 'pline' });
  const scope = S.mc + (item.type === 'mod' ? ' / ' + LOADERS[S.loader].label : '');

  if (item.status === 'loading') {
    line.append(el('span', { class: 'chip', text: tr('findingVer') }));
  } else if (item.status === 'none') {
    line.append(el('span', { class: 'chip bad', text: tr('noVerFor', { scope }) }),
      el('button', { class: 'btn small', onclick: () => openVersions(item), text: tr('viewAll') }));
  } else if (item.status === 'error') {
    line.append(el('span', { class: 'chip bad', text: tr('loadVerFail') }),
      el('button', { class: 'btn small', onclick: () => resolveItem(item, S.gen), text: tr('retry') }));
  } else if (v) {
    line.append(
      el('span', { text: v.number }),
      el('span', { class: 'chip ' + TCLASS[v.type], text: TLABEL[v.type] }),
      v.matches ? el('span', { class: 'chip ok', text: tr('match') }) : el('span', { class: 'chip bad', text: tr('nomatch') }),
      el('button', { class: 'btn small', onclick: () => openVersions(item), text: tr('changeVer') }));
  }
  body.append(line);
  if (item.status === 'ready' && v) {
    if (!v.matches) body.append(el('div', { class: 'pnote', text: tr('mismatchNote') }));
    else if (v.type !== 'release' && !item.manual) body.append(el('div', { class: 'pnote', text: tr('betaNote', { scope, type: TLABEL[v.type].toLowerCase() }) }));
  }
  if (item.auto && item.requiredBy) body.append(el('div', { class: 'pnote', text: tr('needBy', { who: item.requiredBy }) }));
  if (item.status === 'ready' && v && v.deps && v.deps.length && item.type === 'mod') {
    const box = el('div', { class: 'reqlist' });
    const reqs = v.deps.filter(d => d.project_id && (d.dependency_type === 'required' || d.dependency_type === 'optional'));
    if (reqs.length) {
      const missingReq = reqs.filter(d =>
        d.dependency_type === 'required' && !S.items.some(i => i.id === d.project_id));
      box.append(el('div', { class: 'reqhead', text:
        tr('reqTitle') + (missingReq.length ? ' — ' + missingReq.length + ' ' + tr('reqMissing') : ' — ' + tr('reqOk')) }));
      for (const d of reqs) {
        const opt = d.dependency_type === 'optional';
        const has = S.items.some(i => i.id === d.project_id);
        const name = depTitles.get(d.project_id) || d.project_id;
        const row = el('div', { class: 'req' + (opt ? ' opt' : '') },
          el('span', { text: name }),
          el('span', { class: 'chip ' + (opt ? '' : has ? 'ok' : 'bad'), text: opt ? tr('reqOpt') : has ? tr('match') : tr('reqMissing') }));
        if (!opt && !has) {
          row.append(el('button', { class: 'btn small adddep', 'data-pid': d.project_id, text: tr('add') }));
        }
        box.append(row);
      }
      if (missingReq.length > 1) {
        box.append(el('button', { class: 'btn small addall', text: tr('reqAddAll') }));
      }
      body.append(box);
      if (reqs.some(d => !depTitles.has(d.project_id))) {
        (async () => {
          const g = S.gen;
          for (const d of reqs) {
            if (!depTitles.has(d.project_id)) await depName(d);
          }
          if (g === S.gen) renderPack();
        })();
      }
    }
  }

  return el('div', { class: 'pitem ' + st.cls, 'data-id': item.id },
    icon(item.icon, item.title, true), body,
    el('button', { class: 'x', title: tr('remove', { title: item.title }), 'aria-label': tr('remove', { title: item.title }), onclick: () => removeItem(item), text: '×' }));
}
function renderPack() {
  const box = $('#pack');
  box.replaceChildren();
  box.onclick = async e => {
    const row = e.target.closest('.pitem');
    const owner = row ? S.items.find(i => i.id === row.dataset.id) : null;
    const add = e.target.closest('.adddep');
    if (add) {
      addDepById(add.dataset.pid, owner ? owner.title : '');
      return;
    }
    const all = e.target.closest('.addall');
    if (all && owner) {
      for (const d of missingDeps(owner)) await addDepById(d.project_id, owner.title);
    }
  };
  const counts = { ok: 0, warn: 0, bad: 0, loading: 0 };
  for (const type of Object.keys(TYPES)) {
    const list = S.items.filter(i => i.type === type);
    if (!list.length) continue;
    box.append(el('div', { class: 'grp' }, typeLabel(type), el('span', { text: list.length })));
    for (const it of list) {
      const st = packState(it);
      counts[st.cls || 'loading']++;
      box.append(packRow(it));
    }
  }
  if (!S.items.length) {
    box.append(el('div', { class: 'empty', text: tr('emptyPack') }));
  }
  const parts = [];
  if (S.items.length) {
    parts.push(S.items.length + ' ' + tr('sumItem'));
    if (counts.ok + counts.warn) parts.push((counts.ok + counts.warn) + ' ' + tr('sumMatch'));
    if (counts.bad) parts.push(counts.bad + ' ' + tr('sumBad'));
    if (counts.loading) parts.push(counts.loading + ' ' + tr('sumLoading'));
    const miss = missingDepsCount();
    if (miss) parts.push(miss + ' ' + tr('sumMissing'));
  }
  $('#sum').textContent = parts.join(', ');
  $('#packCount').textContent = S.items.length;
  const ready = exportable().length;
  $('#btnMrpack').disabled = ready === 0;
  $('#btnCopy').disabled = S.items.length === 0;
  $('#btnClear').disabled = S.items.length === 0;
}

/* ---------- Dialog pilih versi ---------- */
const dlg = $('#verDialog');
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

async function openVersions(item) {
  if (!dlg.open) dlg.showModal();
  draw();

  function draw(loading) {
    const body = $('#verBody');
    body.replaceChildren();
    const scope = 'Minecraft ' + S.mc + (item.type === 'mod' ? ' ' + tr('withLoader', { loader: LOADERS[S.loader].label }) : '');
    body.append(
      el('header', {}, el('div', {}, el('h2', { text: item.title })),
        el('button', { class: 'x', 'aria-label': tr('close'), onclick: () => dlg.close(), text: '×' })),
      el('p', { class: 'sub', text: tr('dlgSub', { scope }) }));
    const list = el('div', { class: 'vlist' });
    if (loading) list.append(el('div', { class: 'empty', text: tr('dlgLoading') }));
    else if (!item.versions.length) list.append(el('div', { class: 'empty', text: tr('dlgEmpty') }));
    const best = item.versions.find(v => v.matches);
    item.versions.forEach(v => {
      const gvText = v.gv.length > 4 ? v.gv.slice(0, 4).join(', ') + ' +' + (v.gv.length - 4) : v.gv.join(', ');
      list.append(el('button', {
        class: 'vrow ' + (v.matches ? 'match' : 'nomatch') + (v.id === item.vid ? ' current' : ''),
        onclick: () => choose(item, v, best)
      },
        el('span', { class: 'vnum', text: v.number }),
        el('span', { class: 'vtags' },
          best && v.id === best.id ? el('span', { class: 'chip ok', text: tr('suggested') }) : null,
          el('span', { class: 'chip ' + TCLASS[v.type], text: TLABEL[v.type] }),
          el('span', { class: 'chip ' + (v.matches ? 'ok' : 'bad'), text: v.matches ? tr('match') : tr('nomatch') })),
        el('span', { class: 'vmeta', text: fmtDate(v.date) + '. Minecraft ' + gvText + (item.type === 'mod' ? '. ' + v.loaders.join(', ') : '') })));
    });
    body.append(list);
    const foot = el('footer', {});
    if (!item.allLoaded && !loading) {
      foot.append(el('button', { class: 'btn', text: tr('showAll'), onclick: async () => {
        draw(true);
        try { item.versions = sortVersions(await loadVersions(item, true)); item.allLoaded = true; }
        catch (e) { toast(tr('loadAllFail'), 'bad'); }
        draw();
      } }));
    } else foot.append(el('span'));
    foot.append(el('button', { class: 'btn', onclick: () => dlg.close(), text: tr('close') }));
    body.append(foot);
  }

  if (item.status === 'none' && !item.allLoaded) {
    draw(true);
    try { item.versions = sortVersions(await loadVersions(item, true)); item.allLoaded = true; }
    catch (e) { toast(tr('loadAllFail'), 'bad'); }
    draw();
  }
}
function choose(item, v, best) {
  item.vid = v.id;
  item.manual = !(best && best.id === v.id);
  item.status = 'ready';
  dlg.close();
  renderPack(); save();
  if (!v.matches) toast(tr('packMismatch'), 'bad');
  else addDeps(item, v, S.gen);
}

/* ---------- Ekspor ---------- */
function primaryFile(v) { return v.files.find(f => f.primary) || v.files[0]; }
function exportable() {
  return S.items.filter(i => {
    const v = selVersion(i);
    return i.status === 'ready' && v && v.files && v.files.length;
  });
}
function envVal(x) { return x === 'required' || x === 'optional' || x === 'unsupported' ? x : 'optional'; }
function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function exportMrpack() {
  const list = exportable();
  if (!list.length) return;
  if (!S.loaderVer) { toast(tr('needLoaderVer'), 'bad'); return; }
  if (!window.JSZip) { toast(tr('zipNotReady'), 'bad'); return; }
  const bad = list.filter(i => !selVersion(i).matches).length;
  const pending = S.items.length - list.length;
  const files = list.map(i => {
    const f = primaryFile(selVersion(i));
    return {
      path: TYPES[i.type].folder + '/' + f.filename,
      hashes: { sha1: f.hashes.sha1, sha512: f.hashes.sha512 },
      env: { client: envVal(i.client), server: envVal(i.server) },
      downloads: [f.url],
      fileSize: f.size
    };
  });
  const index = {
    formatVersion: 1, game: 'minecraft',
    versionId: S.packVer || '1.0.0',
    name: S.name || 'Modpack',
    summary: tr('madeWith'),
    files,
    dependencies: { minecraft: S.mc, [LOADERS[S.loader].key]: S.loaderVer }
  };
  const zip = new JSZip();
  zip.file('modrinth.index.json', JSON.stringify(index, null, 2));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  download(blob, slugify(S.name) + '-' + slugify(S.packVer) + '.mrpack');
  let msg = tr('dlDone', { n: files.length });
  if (pending) msg += tr('dlSkip', { n: pending });
  if (bad) msg += tr('dlBad', { n: bad });
  toast(msg, pending || bad ? 'bad' : 'ok');
}

function listText() {
  const out = [S.name + ' ' + S.packVer, 'Minecraft ' + S.mc + ', ' + LOADERS[S.loader].label + ' ' + S.loaderVer, ''];
  for (const type of Object.keys(TYPES)) {
    const l = S.items.filter(i => i.type === type);
    if (!l.length) continue;
    out.push(typeLabel(type) + ':');
    for (const i of l) {
      const v = selVersion(i);
      out.push('- ' + i.title + (v ? ' ' + v.number + ' (' + TLABEL[v.type].toLowerCase() + ')' : ' ' + tr('noVerYet')));
    }
    out.push('');
  }
  return out.join('\n').trim();
}

/* ---------- Simpan / buka proyek ---------- */
function projectJSON() {
  return {
    app: 'reonzy-mp-maker', v: 1,
    name: S.name, packVer: S.packVer, mc: S.mc, loader: S.loader, loaderVer: S.loaderVer,
    pref: S.pref, autoDeps: S.autoDeps,
    items: S.items.map(i => ({ id: i.id, vid: i.manual ? i.vid : null, manual: !!i.manual, auto: !!i.auto, requiredBy: i.requiredBy || null }))
  };
}
async function applyProject(o) {
  if (!o || !Array.isArray(o.items) || !LOADERS[o.loader]) throw new Error('format');
  Object.assign(S, {
    name: o.name || tr('defaultName'), packVer: o.packVer || '1.0.0', mc: o.mc || S.mc,
    loader: o.loader, loaderVer: o.loaderVer || '', pref: o.pref === 'newest' ? 'newest' : 'auto',
    autoDeps: o.autoDeps !== false
  });
  const cur = S.mcList.find(v => v.version === S.mc);
  if (cur && cur.version_type !== 'release') S.showSnap = true;
  S.items = await buildItems(o.items);
  renderConfig(); renderPack();
  const g = ++S.gen;
  refreshLoader();
  runSearch(true);
  await pool(S.items.slice(), 6, i => resolveItem(i, g));
}
async function buildItems(saved) {
  const ids = saved.map(s => s.id).filter(Boolean);
  if (!ids.length) return [];
  const projects = [];
  for (let k = 0; k < ids.length; k += 50) {
    const chunk = ids.slice(k, k + 50);
    try { projects.push(...await getJSON(API + '/projects?ids=' + encodeURIComponent(JSON.stringify(chunk)))); } catch (e) { /* lewati */ }
  }
  const byId = new Map(projects.map(p => [p.id, p]));
  const out = [];
  for (const s of saved) {
    const p = byId.get(s.id);
    if (!p || !TYPES[p.project_type]) continue;
    const it = makeItem(p);
    it.vid = s.vid || null; it.manual = !!s.manual && !!s.vid;
    it.auto = !!s.auto; it.requiredBy = s.requiredBy || null;
    out.push(it);
  }
  return out;
}

/* ---------- Drawer mobile/tablet ---------- */
function syncScrim() {
  $('#scrim').hidden = !(document.body.classList.contains('side-open') || document.body.classList.contains('pack-open'));
}
function setSide(open) {
  document.body.classList.toggle('side-open', open);
  if (open) document.body.classList.remove('pack-open');
  $('#menuBtn').setAttribute('aria-expanded', String(open));
  $('#packBtn').setAttribute('aria-expanded', String(document.body.classList.contains('pack-open')));
  syncScrim();
}
function setPack(open) {
  document.body.classList.toggle('pack-open', open);
  if (open) document.body.classList.remove('side-open');
  $('#packBtn').setAttribute('aria-expanded', String(open));
  $('#menuBtn').setAttribute('aria-expanded', String(document.body.classList.contains('side-open')));
  syncScrim();
}
function applyStaticLang() {
  document.documentElement.lang = S.lang;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', tr('desc'));
  document.querySelectorAll('[data-i18n]').forEach(elm => {
    elm.textContent = tr(elm.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(elm => {
    elm.setAttribute('placeholder', tr(elm.dataset.i18nPh));
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(elm => {
    elm.setAttribute('aria-label', tr(elm.dataset.i18nAria));
  });
  $('#langId').classList.toggle('on', S.lang === 'id');
  $('#langEn').classList.toggle('on', S.lang === 'en');
  $('#langId').setAttribute('aria-pressed', String(S.lang === 'id'));
  $('#langEn').setAttribute('aria-pressed', String(S.lang === 'en'));
}
function setLang(lang) {
  if (lang !== 'id' && lang !== 'en') return;
  S.lang = lang;
  try { localStorage.setItem(LANGKEY, lang); } catch (e) { /* abaikan */ }
  if (S.name === I18N.id.defaultName || S.name === I18N.en.defaultName || !S.name) {
    S.name = tr('defaultName');
  }
  applyStaticLang();
  renderConfig();
  renderLoaderHint();
  renderLoader();
  document.querySelectorAll('#tabs button').forEach(b => { b.textContent = typeLabel(b.dataset.tab); });
  renderTags();
  renderActiveFilters();
  renderResults();
  renderPack();
  save();
}

/* ---------- Event ---------- */
function bind() {
  $('#menuBtn').addEventListener('click', () => setSide(!document.body.classList.contains('side-open')));
  $('#sideClose').addEventListener('click', () => setSide(false));
  $('#packClose').addEventListener('click', () => setPack(false));
  $('#scrim').addEventListener('click', () => { setSide(false); setPack(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { setSide(false); setPack(false); } });
  $('#packBtn').addEventListener('click', () => setPack(!document.body.classList.contains('pack-open')));
  window.matchMedia('(min-width: 1181px)').addEventListener('change', e => { if (e.matches) { setSide(false); setPack(false); } });
  $('#langId').addEventListener('click', () => setLang('id'));
  $('#langEn').addEventListener('click', () => setLang('en'));
  // loader
  const lw = $('#loaders');
  for (const [k, l] of Object.entries(LOADERS)) {
    lw.append(el('label', {},
      el('input', { type: 'radio', name: 'loader', value: k }),
      el('span', { text: l.label })));
  }
  lw.addEventListener('change', e => {
    S.loader = e.target.value;
    renderLoaderHint();
    refreshLoader();
    onConfigChange();
  });
  // tab
  const tabs = $('#tabs');
  tabs.replaceChildren();
  for (const [k] of Object.entries(TYPES)) {
    tabs.append(el('button', {
      type: 'button', role: 'tab', 'aria-selected': String(k === S.tab), 'data-tab': k, text: typeLabel(k),
      onclick: () => {
        if (S.tab === k) return;
        S.tab = k;
        S.tags = [];
        save();
        tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === k)));
        renderTags();
        renderActiveFilters();
        renderResults();
        runSearch(true);
      }
    }));
  }
  $('#mc').addEventListener('change', e => { S.mc = e.target.value; refreshLoader(); onConfigChange(); });
  $('#snap').addEventListener('change', e => {
    S.showSnap = e.target.checked;
    if (!mcOptions().some(v => v.version === S.mc)) { S.mc = mcOptions()[0].version; renderConfig(); refreshLoader(); onConfigChange(); }
    else renderConfig();
    save();
  });
  $('#lv').addEventListener('change', e => { S.loaderVer = e.target.value; save(); });
  $('#lvManual').addEventListener('input', e => { S.loaderVer = e.target.value.trim(); save(); });
  $('#name').addEventListener('input', e => { S.name = e.target.value; save(); });
  $('#packVer').addEventListener('input', e => { S.packVer = e.target.value; save(); });
  $('#pref').addEventListener('change', e => { S.pref = e.target.value; onConfigChange(); });
  $('#deps').addEventListener('change', e => {
    S.autoDeps = e.target.checked; save();
    if (S.autoDeps) S.items.slice().forEach(i => { const v = selVersion(i); if (v) addDeps(i, v, S.gen); });
  });
  let tm;
  $('#q').addEventListener('input', e => {
    S.query = e.target.value.trim();
    clearTimeout(tm);
    tm = setTimeout(() => runSearch(true), 350);
  });
  $('#more').addEventListener('click', () => runSearch(false));
  $('#btnMrpack').addEventListener('click', exportMrpack);
  $('#btnCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(listText()); toast(tr('copied'), 'ok'); }
    catch (e) { toast(tr('clipDeny'), 'bad'); }
  });
  $('#btnSave').addEventListener('click', () => {
    download(new Blob([JSON.stringify(projectJSON(), null, 2)], { type: 'application/json' }), slugify(S.name) + '.reonzy.json');
  });
  $('#btnOpen').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { await applyProject(JSON.parse(await f.text())); toast(tr('opened'), 'ok'); }
    catch (err) { toast(tr('invalidProj'), 'bad'); }
  });
  $('#btnClear').addEventListener('click', () => {
    if (!confirm(tr('confirmClear'))) return;
    S.items = []; renderPack(); renderResults(); save();
  });
}

/* ---------- Mulai ---------- */
async function boot() {
  const saved = loadSaved();
  if (saved) {
    Object.assign(S, {
      name: saved.name || S.name, packVer: saved.packVer || S.packVer,
      mc: saved.mc || '', loader: LOADERS[saved.loader] ? saved.loader : 'fabric',
      loaderVer: saved.loaderVer || '', pref: saved.pref === 'newest' ? 'newest' : 'auto',
      autoDeps: saved.autoDeps !== false, showSnap: !!saved.showSnap,
      tab: TYPES[saved.tab] ? saved.tab : 'mod',
      tags: Array.isArray(saved.tags) ? saved.tags.filter(x => typeof x === 'string') : []
    });
  }
  if (!saved || !saved.name) S.name = tr('defaultName');
  bind();
  applyStaticLang();
  renderPack();
  renderTags();
  renderActiveFilters();
  renderResults();
  try {
    const d = await getJSON(API + '/tag/game_version');
    S.mcList = d.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch (e) {
    $('#resInfo').textContent = tr('mcListFail');
    return;
  }
  const savedMc = S.mcList.find(v => v.version === S.mc);
  if (savedMc && savedMc.version_type !== 'release') S.showSnap = true;
  if (!savedMc) S.mc = (mcOptions()[0] || {}).version || '';
  renderConfig();
  refreshLoader();
  runSearch(true);

  if (saved && Array.isArray(saved.items) && saved.items.length) {
    S.items = await buildItems(saved.items);
    renderPack(); renderResults();
    const g = ++S.gen;
    await pool(S.items.slice(), 6, i => resolveItem(i, g));
  }
}
boot();
