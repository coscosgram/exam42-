'use strict';
/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return el;
}
const LS = {
  get(k, d) { try { const v = localStorage.getItem('xs02:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('xs02:' + k, JSON.stringify(v)); } catch (e) {} }
};
const fmt = ms => { const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60; const p = n => String(n).padStart(2, '0'); return (hh ? hh + ':' : '') + p(mm) + ':' + p(ss); };
const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------- compilador (clang en WebAssembly, dentro de un worker) ---------- */
const GZ_BYTES = { clang: 10536412, lld: 6717935, memfs: 18876, sysroot: 1816305 };
const GZ_TOTAL = Object.values(GZ_BYTES).reduce((a, b) => a + b, 0);
const ASSET_MB = Math.round(GZ_TOTAL / 1048576);
const assetUrl = n => new URL('wasm/' + n + '.gz', location.href).href;
const TC = {
  worker: null, ready: false, loading: null, rid: 0, pend: new Map(), onProgress: null, got: {},
  async cached() {
    try { return !!(await (await caches.open('xs42-assets-v1')).match(assetUrl('clang'))); } catch (e) { return false; }
  },
  mk() {
    this.worker = new Worker('js/toolchain.js');
    this.worker.onmessage = e => {
      const { id, data } = e.data;
      if (id === 'progress') {
        this.got[data.file] = data.loaded;
        if (this.onProgress) this.onProgress(Object.values(this.got).reduce((a, b) => a + b, 0) / GZ_TOTAL);
        return;
      }
      const p = this.pend.get(data.rid); if (!p) return; this.pend.delete(data.rid);
      id === 'error' ? p.rej(new Error(data.message)) : p.res(data);
    };
    this.worker.onerror = e => {
      const err = new Error('Fallo del compilador: ' + (e.message || 'desconocido'));
      for (const p of this.pend.values()) p.rej(err);
      this.pend.clear(); this.ready = false;
    };
  },
  call(id, data, timeoutMs) {
    return new Promise((res, rej) => {
      const r = ++this.rid; let to = null;
      this.pend.set(r, { res: v => { clearTimeout(to); res(v); }, rej: v => { clearTimeout(to); rej(v); } });
      if (timeoutMs) to = setTimeout(() => { this.pend.delete(r); rej(Object.assign(new Error('timeout'), { timeout: true })); }, timeoutMs);
      this.worker.postMessage({ id, rid: r, data });
    });
  },
  ensure(onProgress) {
    if (this.ready) return Promise.resolve();
    if (onProgress) this.onProgress = onProgress;
    if (!this.loading) {
      this.got = {};
      this.loading = (async () => { if (!this.worker) this.mk(); await this.call('init', {}); this.ready = true; })()
        .catch(e => { if (this.worker) this.worker.terminate(); this.worker = null; throw e; })
        .finally(() => { this.loading = null; });
    }
    return this.loading;
  },
  async restart() {
    if (this.worker) this.worker.terminate();
    this.worker = null; this.pend.clear(); this.ready = false;
    await this.ensure();
  }
};

function parseArgs(s) {
  const out = []; let cur = '', q = null, has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) cur += s[++i]; else cur += c; }
    else if (c === '"' || c === "'") { q = c; has = true; }
    else if (/\s/.test(c)) { if (cur || has) { out.push(cur); cur = ''; has = false; } }
    else cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}
/* como `cat -e`: marca el final de cada línea con $ */
const catE = s => (s === '' ? '(no imprime nada)' : s.replace(/\n/g, '$\n'));
const clip = (s, n = 600) => (s.length > n ? s.slice(0, n) + '…' : s);

/* Compila el código del alumno con las mismas banderas que el primer test del tester
   y lo ejecuta con cada caso, comparando la salida con la que da la referencia con gcc. */
async function runTests(ex, code, onMsg) {
  const say = m => onMsg && onMsg(m);
  const t0 = performance.now();
  await TC.ensure();
  const mainFile = ex.main != null ? [{ name: 'main_' + ex.name, src: ex.main, flags: ['-w'] }] : [];
  say('Compilando tu código con -Wall -Wextra -Werror…');
  const usr = await TC.call('build', { files: [...mainFile, { name: ex.name, src: code, flags: ['-Wall', '-Wextra', '-Werror'] }], headers: ex.headers || {}, wasm: 'usr.wasm' });
  if (!usr.out.ok) {
    const bad = usr.out.steps.find(s => !s.ok);
    return { compileOk: false, stage: bad.what, diag: bad.diag.trim(), ms: performance.now() - t0 };
  }
  const cases = []; let pass = 0, timeout = null;
  for (let i = 0; i < ex.tests.length; i++) {
    const t = ex.tests[i];
    say(`Ejecutando caso ${i + 1} de ${ex.tests.length}…`);
    let r;
    try { r = (await TC.call('run', { wasm: 'usr.wasm', args: parseArgs(t.args) }, 3000)).r; }
    catch (e) {
      if (!e.timeout) throw e;
      timeout = { args: t.args };
      say('Tu programa no termina; reiniciando el compilador…');
      await TC.restart();
      break;
    }
    const same = r.out === t.out && !r.trap;
    if (same) pass++;
    cases.push({ args: t.args, same, exp: t.out, got: r.out, trap: r.trap });
  }
  return { compileOk: true, cases, pass, total: ex.tests.length, timeout, ms: performance.now() - t0 };
}

/* Interfaz de descarga con barra de progreso. Llama a done() al terminar. */
function downloadControl(done) {
  const bar = h('div', { class: 'bar', hidden: true }, h('i'));
  const msg = h('p', { class: 'note', style: 'margin:8px 0 0' });
  const btn = h('button', { class: 'btn primary wide', onclick: async () => {
    btn.disabled = true; bar.hidden = false; msg.textContent = 'Descargando…';
    try {
      await TC.ensure(p => { bar.firstChild.style.width = Math.min(100, Math.round(p * 100)) + '%'; });
      if (done) done();
    } catch (e) { msg.textContent = 'No se pudo descargar: ' + e.message + '. Comprueba la conexión y vuelve a intentarlo.'; btn.disabled = false; bar.hidden = true; }
  } }, `Descargar compilador (${ASSET_MB} MB)`);
  return h('div', null, btn, bar, msg);
}

const NOWASM = !(window.Worker && window.WebAssembly && "DecompressionStream" in window && window.caches !== undefined);

/* ---------- resaltado de sintaxis (C) ---------- */
const C_KW = new Set('if else while for do return break continue switch case default goto sizeof typedef struct enum union static const extern volatile register inline'.split(' '));
const C_TY = new Set('int char short long float double void unsigned signed size_t ssize_t bool FILE NULL'.split(' '));
const C_RE = /(\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(^[ \t]*#[^\n]*)|(\b0[xX][0-9a-fA-F]+\b|\b\d+\b)|([A-Za-z_]\w*)/gm;
function hl(src) {
  let out = '', last = 0, m;
  C_RE.lastIndex = 0;
  while ((m = C_RE.exec(src))) {
    if (m[0] === '') { C_RE.lastIndex++; continue; }
    out += esc(src.slice(last, m.index)); last = m.index + m[0].length;
    let cls;
    if (m[1] !== undefined) cls = 'c';
    else if (m[2] !== undefined) cls = 's';
    else if (m[3] !== undefined) cls = 'p';
    else if (m[4] !== undefined) cls = 'd';
    else { const w = m[5]; cls = C_KW.has(w) ? 'k' : (C_TY.has(w) || /^t_\w+$/.test(w)) ? 'y' : src.slice(last).match(/^\s*\(/) ? 'f' : ''; }
    out += cls ? '<span class="' + cls + '">' + esc(m[0]) + '</span>' : esc(m[0]);
  }
  return out + esc(src.slice(last));
}
const codeBlock = (text, cls = '') => h('pre', { class: 'code ' + cls, html: hl(text) });

/* ---------- efectos ---------- */
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const buzz = p => { try { if (!reduced() && navigator.vibrate) navigator.vibrate(p); } catch (e) {} };
function confetti(n = 36) {
  if (reduced()) return;
  const cols = ['var(--accent)', 'var(--coin)', 'var(--t-kw)', 'var(--t-type)', 'var(--ink)'];
  const fx = h('div', { class: 'fx' });
  for (let i = 0; i < n; i++) {
    const b = h('i'); const st = b.style;
    st.left = Math.random() * 100 + '%'; st.background = rnd(cols);
    st.setProperty('--d', (1 + Math.random() * 0.9) + 's'); st.setProperty('--x', (Math.random() * 120 - 60) + 'px'); st.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
    st.animationDelay = Math.random() * 0.25 + 's'; fx.append(b);
  }
  document.body.append(fx); setTimeout(() => fx.remove(), 2600);
}
function banner(title, sub, cb) {
  const el = h('div', { class: 'banner' }, h('div', null, title, sub ? h('small', null, sub) : null));
  document.body.append(el); confetti(); buzz([40, 50, 40]);
  setTimeout(() => { el.remove(); cb(); }, reduced() ? 300 : 1100);
}

/* ---------- progreso: racha, récord, título ---------- */
const dayStr = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function streakNow() {
  const st = LS.get('streak', null); if (!st) return 0;
  const t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
  return st.last === dayStr(t) || st.last === dayStr(y) ? st.n : 0;
}
function recordPass(name) {
  passed.add(name); LS.set('passed', [...passed]);
  const st = LS.get('streak', null), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
  if (!st) LS.set('streak', { last: dayStr(t), n: 1 });
  else if (st.last !== dayStr(t)) LS.set('streak', { last: dayStr(t), n: st.last === dayStr(y) ? st.n + 1 : 1 });
}
const RANKS = ['Novato', 'Aprendiz', 'Coder', 'Hacker', '42 Master'];
const rankOf = f => RANKS[f >= 1 ? 4 : f >= 0.6 ? 3 : f >= 0.3 ? 2 : f >= 0.08 ? 1 : 0];

/* ---------- estado ---------- */
let DATA = [];
let passed = new Set(LS.get('passed', []));
let exam = LS.get('exam', null);          // {level,picks:[],acc,finished,total}
let listLevel = 0, lightLevel = 'all';
let ticker = null, clockEl = null, tickN = 0;
const app = $('#app');
const byLevel = l => DATA.filter(e => e.level === l);
const nameOf = n => DATA.find(e => e.name === n);
const firstLine = sub => {
  const t = sub.split(/\n-{5,}\n/)[1] || '';
  const s = t.trim().replace(/\s+/g, ' ');
  return s.length > 110 ? s.slice(0, 107) + '…' : s;
};
function stopTicker() { if (ticker) clearInterval(ticker); ticker = null; clockEl = null; }
function startTicker(el) {
  stopTicker(); clockEl = el;
  ticker = setInterval(() => {
    if (!exam || exam.finished || document.visibilityState !== 'visible') return;
    exam.acc += 1000; if (clockEl) clockEl.textContent = fmt(exam.acc);
    if (++tickN % 5 === 0) LS.set('exam', exam);
  }, 1000);
}
function show(node) { stopTicker(); app.replaceChildren(node); }

/* ---------- portada ---------- */
function screenHome() {
  const active = exam && !exam.finished;
  const nodes = [0, 1, 2, 3].map(l => {
    const done = exam && (exam.finished || exam.level > l);
    const cur = active && exam.level === l;
    const tot = byLevel(l).length, got = byLevel(l).filter(e => passed.has(e.name)).length;
    return h('div', { class: 'node' + (done ? ' done' : '') + (cur ? ' cur' : '') },
      h('span', { class: 'n' }, 'ETAPA ' + l),
      h('span', { class: 'ex' }, exam && exam.picks[l] ? exam.picks[l] : '—'),
      h('span', { class: 'cnt' }, got + '/' + tot));
  });
  const cnt = DATA.length;
  const done = DATA.filter(e => passed.has(e.name)).length, frac = cnt ? done / cnt : 0;
  const best = LS.get('best', null), streak = streakNow();
  const meter = h('i'); requestAnimationFrame(() => requestAnimationFrame(() => { meter.style.width = Math.round(frac * 100) + '%'; }));
  const s = h('div', { class: 'screen' },
    h('div', { class: 'scroll' },
      h('div', { class: 'hero' },
        h('div', { class: 'prompt' }, '/> examshell --rank 02'),
        h('h1', null, 'Rango 02'),
        h('p', null, '4 etapas seguidas, un ejercicio al azar en cada una. Como el examen de verdad.')),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('small', null, 'Superados'), h('b', null, done + '/' + cnt)),
        h('div', { class: 'stat' }, h('small', null, 'Racha'), h('b', null, streak + (streak === 1 ? ' día' : ' días'))),
        h('div', { class: 'stat' }, h('small', null, 'Récord'), h('b', null, best ? fmt(best) : '—'))),
      h('div', { class: 'xp' }, h('div', { class: 'head' }, h('span', null, 'Rango: ', h('b', null, rankOf(frac))), h('span', null, Math.round(frac * 100) + '%')), h('div', { class: 'meter' }, meter)),
      h('div', { class: 'track' }, nodes),
      h('div', { class: 'row' },
        active
          ? [h('button', { class: 'btn primary', style: 'flex:1', onclick: resumeExam }, `▶ Continuar · etapa ${exam.level} · ${fmt(exam.acc)}`),
             h('button', { class: 'btn ghost danger', onclick: () => { exam = null; LS.set('exam', null); screenHome(); } }, 'Abandonar')]
          : h('button', { class: 'btn primary wide', onclick: newExam }, exam && exam.finished ? `▶ Repetir · último ${fmt(exam.total)}` : '▶ Empezar examen')),
      h('div', { class: 'cards' },
        card('{ }', 'Práctica libre', 'Elige un ejercicio concreto de cualquier nivel.', () => screenList()),
        card('↕', 'Ordenar líneas', 'Reconstruye una solución tocando las líneas. Sin teclado.', () => screenOrder()),
        card('▾', 'Rellenar huecos', 'Completa operadores y valores de una solución. Sin teclado.', () => screenGaps())),
      h('p', { class: 'foot' }, 'Autoría: los ejercicios, las soluciones de referencia y el código de las pruebas (testers) son obra de ',
        h('b', null, 'terminal-42s'), ', del repositorio ',
        h('a', { href: 'https://github.com/terminal-42s/42_examshell', target: '_blank', rel: 'noopener' }, 'terminal-42s/42_examshell'),
        '. «Probar» compila y ejecuta tu código en el propio navegador (clang en WebAssembly): la primera vez descarga unos ' + ASSET_MB + ' MB y después funciona sin conexión.')));
  show(s);
}
function card(ic, t, d, fn) {
  return h('button', { class: 'card', onclick: fn }, h('div', { class: 'ic' }, ic), h('div', null, h('b', null, t), h('span', null, d)));
}

/* ---------- examen ---------- */
function newExam() {
  exam = { level: 0, picks: [], acc: 0, finished: false, total: 0 };
  LS.set('exam', exam); resumeExam();
}
function resumeExam() {
  if (!exam.picks[exam.level]) exam.picks[exam.level] = rnd(byLevel(exam.level)).name;
  LS.set('exam', exam);
  screenExercise(nameOf(exam.picks[exam.level]), 'exam');
}
function otherExercise() {
  const cur = exam.picks[exam.level], pool = byLevel(exam.level).filter(e => e.name !== cur);
  exam.picks[exam.level] = rnd(pool).name; LS.set('exam', exam); resumeExam();
}
function advanceExam() {
  recordPass(exam.picks[exam.level]);
  if (exam.level < 3) {
    const l = exam.level; exam.level++; LS.set('exam', exam);
    banner('Etapa ' + l + ' superada', 'Siguiente: etapa ' + exam.level, resumeExam);
  } else {
    exam.finished = true; exam.total = exam.acc;
    const best = LS.get('best', null); exam.record = !best || exam.total < best; if (exam.record) LS.set('best', exam.total);
    LS.set('exam', exam);
    banner('¡Examen superado!', fmt(exam.total), screenFinish);
  }
}
function screenFinish() {
  show(h('div', { class: 'screen' },
    h('div', { class: 'scroll' },
      h('div', { class: 'hero' },
        h('div', { class: 'prompt' }, '/> exam finished'),
        h('h1', null, 'Rango 02 superado'),
        h('p', null, `Tiempo activo: ${fmt(exam.total)}.` + (exam.record ? ' ¡Nuevo récord!' : ''))),
      h('div', { class: 'track' }, exam.picks.map((n, l) => h('div', { class: 'node done' }, h('span', { class: 'n' }, 'ETAPA ' + l), h('span', { class: 'ex' }, n)))),
      h('button', { class: 'btn primary wide', onclick: screenHome }, 'Volver al inicio'))));
  setTimeout(confetti, 150);
}

/* ---------- lista de práctica ---------- */
function screenList() {
  const list = h('div', { class: 'list' });
  const seg = h('div', { class: 'seg' });
  const draw = () => {
    seg.replaceChildren(...[0, 1, 2, 3].map(l => h('button', { 'aria-pressed': String(listLevel === l), onclick: () => { listLevel = l; draw(); } }, `N${l} · ${byLevel(l).filter(e => passed.has(e.name)).length}/${byLevel(l).length}`)));
    list.replaceChildren(...byLevel(listLevel).map(e => h('button', { class: 'item', onclick: () => screenExercise(e, 'practice') },
      h('div', { class: 'body' }, h('b', null, e.name), h('small', null, firstLine(e.sub))),
      passed.has(e.name) ? h('span', { class: 'tick' }, '✓') : null)));
  };
  draw();
  show(h('div', { class: 'screen' }, topbar('Práctica libre', 'Elige un ejercicio', screenHome), seg, h('div', { class: 'scroll' }, list)));
}
function topbar(title, sub, back, extra) {
  return h('div', { class: 'top' },
    h('button', { class: 'back', 'aria-label': 'Volver', onclick: back }, '‹'),
    h('div', { class: 'title' }, h('b', null, title), sub ? h('small', null, sub) : null), extra);
}

/* ---------- editor ---------- */
const SYMS = ['⇥', '{', '}', '(', ')', '[', ']', ';', '*', '&', '"', "'", '\\', '#', '<', '>', '=', '+', '-', '!', '|', '%', '/', ',', '.', '->', '&&', '||', '==', '!=', '<=', '>=', '++', '--', "'\\0'", "'\\n'"];
const MACROS = [
  ['#include <unistd.h>', '#include <unistd.h>\n'], ['#include <stdlib.h>', '#include <stdlib.h>\n'],
  ['main(ac, av)', 'int\tmain(int ac, char **av)\n{\n\t\n}\n', 4], ['{ }↵', '{\n\t\n}', 2], ['while', 'while ()', 1], ['if', 'if ()', 1],
  ['write(1,&c,1)', 'write(1, &c, 1);'], ['return', 'return ();', 2]
];
function insertText(ta, text, back) {
  ta.focus();
  let ok = false; try { ok = document.execCommand('insertText', false, text); } catch (e) {}
  if (!ok) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
  if (back) { const p = ta.selectionStart - back; ta.setSelectionRange(p, p); }
}
function makeEditor(ex, onChange) {
  const ta = h('textarea', { class: 'editor', id: 'code', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', wrap: 'off', placeholder: `// ${ex.name}.c` });
  ta.value = LS.get('draft:' + ex.name, '');
  const key = (label, fn, cls) => h('button', { type: 'button', class: cls || '', 'aria-label': label === '⇥' ? 'Tabulador' : label, onpointerdown: e => e.preventDefault(), onclick: fn }, label);
  const row1 = h('div', { class: 'keys' }, SYMS.map(s => key(s, () => insertText(ta, s === '⇥' ? '\t' : s))));
  const row2 = h('div', { class: 'keys' }, MACROS.map(([l, t, b]) => key(l, () => insertText(ta, t, b || 0), 'macro')));
  ta.addEventListener('input', e => {
    if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
      const p = ta.selectionStart, before = ta.value.slice(0, p - 1);
      const prev = before.slice(before.lastIndexOf('\n') + 1);
      let ind = (prev.match(/^[\t ]*/) || [''])[0];
      if (/\{\s*$/.test(prev)) ind += '\t';
      if (ind) insertText(ta, ind);
    }
    LS.set('draft:' + ex.name, ta.value); if (onChange) onChange();
  });
  const pre = h('pre', { 'aria-hidden': 'true' });
  const sync = () => { pre.innerHTML = hl(ta.value) + '\n '; pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; };
  ta.addEventListener('input', sync);
  ta.addEventListener('scroll', () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; });
  sync();
  return { ta, node: h('div', { class: 'panel' }, row1, row2, h('div', { class: 'ed' }, pre, ta), h('div', { class: 'hint-line' }, 'Los tabuladores son tabs reales, como pide la Norma.')) };
}

/* ---------- ejercicio ---------- */
function screenExercise(ex, mode) {
  const isExam = mode === 'exam';
  const editor = makeEditor(ex);
  const clock = h('span', { class: 'clock' }, isExam ? fmt(exam.acc) : '');
  const tabNames = ['Enunciado', 'Código', 'Casos', 'Resultado'];
  const panels = {}, tabBtns = [];
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const setTab = i => {
    tabBtns.forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
    tabNames.forEach((n, j) => { panels[n].hidden = i !== j; });
  };
  tabNames.forEach((n, i) => { const b = h('button', { role: 'tab', onclick: () => setTab(i) }, n); tabBtns.push(b); tabs.append(b); });

  // enunciado
  panels.Enunciado = h('div', { class: 'panel' }, h('div', { class: 'pad' }, h('pre', { class: 'sub' }, ex.sub),
    h('div', { class: 'row', style: 'margin-top:16px' }, h('button', { class: 'btn primary', onclick: () => setTab(1) }, 'Escribir la solución'))));
  panels.Código = editor.node;

  // casos
  const cases = h('div', { class: 'pad' },
    h('p', { class: 'note', style: 'margin-top:0' }, ex.main !== null && ex.main !== undefined
      ? 'El tester compila tu archivo junto con este main.c y compara la salida con la de la solución de referencia.'
      : 'El tester compila tu programa y compara su salida con la de la solución de referencia, con estos argumentos. Debe compilar con -Wall -Wextra -Werror.'));
  if (ex.main) cases.append(h('details', null, h('summary', null, 'main.c del tester'), codeBlock(ex.main)));
  cases.append(h('div', { class: 'lbl' }, `${ex.tests.length} casos · salida esperada`));
  ex.tests.forEach((t, i) => cases.append(h('details', null,
    h('summary', null, (t.args ? './prog ' + t.args : './prog').slice(0, 140)),
    h('pre', { class: 'code' }, t.out === '' ? '(no imprime nada)' : t.out.replace(/\n$/, '\n⏎')))));
  panels.Casos = h('div', { class: 'panel' }, cases);

  // resultado
  const out = h('div', { class: 'pad' });
  panels.Resultado = h('div', { class: 'panel' }, out);
  let lastLocal = null, lastRun = null, aiBox = null, busy = false, needDl = false, statusEl = null;

  const passBlock = () => {
    if (!lastLocal || lastLocal.some(r => r.level === 'err')) return null;
    const tested = lastRun && lastRun.compileOk && !lastRun.timeout && lastRun.pass === lastRun.total;
    if (!tested && !NOWASM) return null;
    const idx = isExam ? exam.level : -1;
    return h('div', { class: 'pass' },
      h('div', { class: 'big' }, tested ? '¡Todos los casos!' : 'Sin errores básicos'), h('p', null, tested ? 'Compila sin avisos y los ' + lastRun.total + ' casos dan la misma salida que la referencia.' : 'Tu navegador no puede compilar aquí. La comprobación básica no encuentra errores; si has revisado los casos, puedes darlo por bueno.'),
      h('button', { class: 'btn primary wide', onclick: () => {
        if (isExam) advanceExam(); else { recordPass(ex.name); banner('¡Superado!', ex.name, screenList); }
      } }, isExam ? (idx < 3 ? `Superado · pasar al nivel ${idx + 1}` : 'Superado · terminar examen') : 'Marcar como superado'));
  };
  const runView = () => {
    const r = lastRun; if (!r) return null;
    if (r.error) return h('div', { class: 'ai' }, h('b', null, 'Error del compilador'), h('p', { class: 'note' }, r.error));
    if (!r.compileOk) return h('div', null, h('div', { class: 'lbl' }, 'Compilación'), h('span', { class: 'badge bad' }, 'NO COMPILA'),
      h('p', { class: 'note' }, 'Se compila con -Wall -Wextra -Werror: un aviso cuenta como error. Fallo en: ' + r.stage + '.'),
      h('pre', { class: 'code diag' }, clip(r.diag, 3000)));
    const allOk = r.pass === r.total && !r.timeout;
    const nodes = [h('div', { class: 'lbl' }, 'Pruebas'), h('span', { class: 'badge ' + (allOk ? 'ok' : 'bad') }, `${r.pass}/${r.total} CASOS`)];
    if (r.timeout) nodes.push(h('div', { class: 'msg' }, 'Tu programa no termina con «./prog ' + r.timeout.args + '» (límite 3 s). ¿Bucle infinito?'));
    let openOne = false;
    r.cases.forEach(c => {
      const open = !c.same && !openOne; if (open) openOne = true;
      nodes.push(h('details', { open }, h('summary', { class: 'sum ' + (c.same ? 'ok' : 'bad') }, (c.args ? './prog ' + c.args : './prog').slice(0, 140)),
        c.same ? null : [h('div', { class: 'lbl', style: 'margin:0 10px' }, 'Esperado'), h('pre', { class: 'code' }, clip(catE(c.exp))),
          h('div', { class: 'lbl', style: 'margin:0 10px' }, 'Obtenido'), h('pre', { class: 'code' }, clip(catE(c.got))),
          c.trap ? h('p', { class: 'note', style: 'margin:0 10px 10px' }, 'El programa se detuvo con un fallo: ' + c.trap) : null]));
    });
    nodes.push(h('p', { class: 'note' }, 'Cada «$» marca un salto de línea. Se compara la salida estándar completa, como el tester.'));
    return h('div', null, nodes);
  };
  const renderOut = () => {
    out.replaceChildren(); statusEl = null;
    if (busy) { statusEl = h('p', { class: 'note', style: 'margin-top:0' }, 'Preparando…'); out.append(statusEl); return; }
    if (needDl) out.append(h('div', { class: 'dl' }, h('p', null, 'Para compilar y probar tu código se descarga una vez el compilador (clang en WebAssembly). Se guarda en el móvil y después funciona sin conexión.'), downloadControl(() => { needDl = false; probar(); })));
    if (!lastLocal && !needDl) out.append(h('p', { class: 'note', style: 'margin-top:0' }, 'Pulsa «Probar» para compilar tu código y ejecutarlo con los casos del tester, o «Comprobar» para una revisión rápida sin compilar.'));
    if (lastLocal) {
      const p = passBlock(); if (p) out.append(p);
      const rv = runView(); if (rv) out.append(rv);
      out.append(h('div', { class: 'lbl' }, 'Comprobación básica'),
        h('ul', { class: 'chk' }, lastLocal.map(r => h('li', { class: r.level }, h('span', { class: 'm' }, r.level === 'ok' ? '✓' : r.level === 'err' ? '✗' : '!'), h('span', null, r.text)))),
        h('p', { class: 'note' }, 'Esta comprobación no compila: vigila estructura, funciones permitidas, cabeceras y variables sin usar.'));
    }
    if (aiBox) out.append(aiBox);
    out.append(h('div', { class: 'more' },
      h('button', { class: 'btn', onclick: showSolution }, 'Ver solución de referencia'),
      isExam ? h('button', { class: 'btn', onclick: otherExercise }, 'Otro ejercicio de este nivel') : null,
      h('button', { class: 'btn ghost', onclick: () => (isExam ? screenHome() : screenList()) }, 'Salir')));
  };
  const runLocal = () => { lastLocal = checkCode(editor.ta.value, ex); renderOut(); setTab(3); };
  const showSolution = () => {
    aiBox = h('div', { class: 'ai' }, h('b', null, 'Solución de referencia'),
      h('p', { class: 'note' }, 'Compara con la tuya.'), codeBlock(ex.ref));
    renderOut(); setTab(3);
  };
  async function probar() {
    if (busy) return;
    const code = editor.ta.value;
    lastLocal = checkCode(code, ex); lastRun = null; needDl = false; setTab(3);
    if (!code.trim() || NOWASM) { renderOut(); return; }
    if (!TC.ready && !(await TC.cached())) { needDl = true; renderOut(); return; }
    busy = true; renderOut();
    try { lastRun = await runTests(ex, code, m => { if (statusEl) statusEl.textContent = m; }); }
    catch (e) { lastRun = { error: String(e.message || e) + ' Si persiste, recarga la página.' }; }
    busy = false; renderOut();
    if (lastRun && lastRun.compileOk && !lastRun.timeout && lastRun.pass === lastRun.total && !lastLocal.some(r => r.level === 'err')) { confetti(28); buzz([30, 40, 30]); }
    else buzz(90);
  }
  const act = h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: runLocal }, 'Comprobar'),
    h('button', { class: 'btn primary', onclick: probar }, 'Probar'));

  Object.values(panels).forEach(p => p.hidden = true);
  renderOut();
  const s = h('div', { class: 'screen' },
    topbar(ex.name, isExam ? `Nivel ${ex.level} · examen` : `Nivel ${ex.level} · práctica`, () => (isExam ? screenHome() : screenList()), isExam ? clock : null),
    tabs, panels.Enunciado, panels.Código, panels.Casos, panels.Resultado, act);
  show(s); setTab(0);
  if (isExam) startTicker(clock);
}

/* ---------- ordenar líneas ---------- */
const refLines = ref => ref.split('\n').filter(l => l.trim() && !/^\s*#\s*include/.test(l) && !/^\s*(\/\/|\/\*|\*)/.test(l));
function levelSeg(cur, set) {
  const seg = h('div', { class: 'seg' });
  const draw = () => seg.replaceChildren(...['all', 0, 1, 2, 3].map(l => h('button', { 'aria-pressed': String(cur() === l), onclick: () => { set(l); draw(); } }, l === 'all' ? 'Todos' : 'N' + l)));
  draw(); return seg;
}
function screenOrder() {
  const pickEx = () => rnd(DATA.filter(e => (lightLevel === 'all' || e.level === lightLevel) && refLines(e.ref).length >= 4 && refLines(e.ref).length <= 24));
  const host = h('div', { class: 'scroll' });
  const seg = levelSeg(() => lightLevel, l => { lightLevel = l; start(); });
  function start() {
    const ex = pickEx(); if (!ex) { host.replaceChildren(h('p', { class: 'note' }, 'No hay ejercicios cortos en ese nivel.')); return; }
    const lines = refLines(ex.ref);
    let pool = shuffle(lines.map((t, i) => ({ id: i, t }))); if (pool.every((p, i) => p.id === i)) pool.reverse();
    let ans = [], solved = false, marks = null;
    const draw = () => {
      const poolEl = h('div', { class: 'pool' }, pool.map(p => h('button', { class: 'ln', onclick: () => { pool = pool.filter(x => x !== p); ans.push(p); marks = null; draw(); } }, p.t.trim())));
      const ansEl = h('div', { class: 'ans' }, ans.length ? ans.map((p, i) => h('button', { class: 'ln' + (marks ? (marks[i] ? ' ok' : ' bad') : ''), onclick: () => { if (solved) return; ans = ans.filter(x => x !== p); pool.push(p); marks = null; draw(); } },
        h('span', { class: 'i' }, i + 1), p.t.trim())) : h('span', { class: 'note', style: 'margin:6px' }, 'Toca las líneas de abajo en el orden correcto.'));
      host.replaceChildren(...[
        h('div', { class: 'lbl', style: 'margin-top:0' }, `${ex.name} · nivel ${ex.level}`),
        h('details', null, h('summary', null, 'Ver enunciado'), h('pre', { class: 'sub', style: 'padding:0 12px 12px' }, ex.sub)),
        h('div', { class: 'lbl' }, 'Tu orden'), ansEl,
        solved ? h('div', null, h('div', { class: 'msg' }, 'Correcto. Así queda la solución con su sangrado:'), codeBlock(lines.join('\n')),
          h('button', { class: 'btn primary wide', onclick: start }, 'Siguiente ejercicio'))
        : [h('div', { class: 'lbl' }, 'Líneas'), poolEl,
          h('div', { class: 'row', style: 'margin-top:14px' },
            h('button', { class: 'btn primary', style: 'flex:1', disabled: pool.length > 0, onclick: () => {
              marks = ans.map((p, i) => p.t.trim() === lines[i].trim());
              if (marks.every(Boolean)) solved = true; draw();
            } }, 'Comprobar'),
            h('button', { class: 'btn', onclick: start }, 'Otro')),
          marks && !solved ? h('p', { class: 'note' }, 'En rojo, las líneas que no coinciden con la solución de referencia en esa posición. Toca una línea de tu orden para devolverla.') : null]
      ].flat().filter(Boolean));
    };
    draw();
  }
  show(h('div', { class: 'screen' }, topbar('Ordenar líneas', 'Reconstruye la solución', screenHome), seg, host));
  start();
}

/* ---------- rellenar huecos ---------- */
const GROUPS = [
  { re: /^('(?:\\.|[^'\\])')$/, set: ["'\\0'", "' '", "'\\t'", "'\\n'", "'a'", "'-'"] },
  { re: /^\d+$/, set: ['0', '1', '2', '3', '10', '-1'] },
  { re: /^(==|!=|<=|>=|<|>)$/, set: ['==', '!=', '<', '>', '<=', '>='] },
  { re: /^(&&|\|\|)$/, set: ['&&', '||'] },
  { re: /^(\+\+|--)$/, set: ['++', '--'] }
];
function screenGaps() {
  const pickEx = () => rnd(DATA.filter(e => (lightLevel === 'all' || e.level === lightLevel) && refLines(e.ref).length >= 4 && refLines(e.ref).length <= 40));
  const host = h('div', { class: 'scroll' });
  const seg = levelSeg(() => lightLevel, l => { lightLevel = l; start(); });
  const CAND = /'(?:\\.|[^'\\])'|\b\d+\b|==|!=|<=|>=|&&|\|\||\+\+|--|(?<![<>-])[<>](?![<>])/g;
  function start() {
    const ex = pickEx(); if (!ex) { host.replaceChildren(h('p', { class: 'note' }, 'No hay ejercicios en ese nivel.')); return; }
    const lines = ex.ref.split('\n').filter(l => l.trim());
    const cands = [];
    lines.forEach((ln, li) => {
      if (/^\s*#/.test(ln) || /^\s*(\/\/|\/\*)/.test(ln)) return;
      for (const m of ln.matchAll(CAND)) {
        const before = ln.slice(0, m.index).replace(/\\./g, '');
        if ((before.match(/"/g) || []).length % 2) continue;
        cands.push({ li, idx: m.index, t: m[0] });
      }
    });
    const n = Math.min(cands.length, 5);
    const chosen = shuffle(cands).slice(0, n);
    if (n < 2) { start(); return; }
    const gaps = new Map(chosen.map(c => [c.li + ':' + c.idx, c]));
    const sels = [];
    const code = h('pre', { class: 'code gaps' });
    lines.forEach((ln, li) => {
      const mine = chosen.filter(c => c.li === li).sort((a, b) => a.idx - b.idx);
      let pos = 0; const frag = [];
      mine.forEach(c => {
        frag.push(ln.slice(pos, c.idx));
        const g = GROUPS.find(g => g.re.test(c.t));
        const opts = shuffle([c.t, ...shuffle((g ? g.set : []).filter(x => x !== c.t)).slice(0, 3)]);
        const sel = h('select', { class: 'gap', 'aria-label': 'Hueco' }, h('option', { value: '' }, '▾'), opts.map(o => h('option', { value: o }, o)));
        sel.dataset.answer = c.t; sels.push(sel); frag.push(sel); pos = c.idx + c.t.length;
      });
      frag.push(ln.slice(pos) + '\n'); code.append(...frag.map(f => typeof f === 'string' ? document.createTextNode(f) : f));
    });
    const msg = h('div');
    const check = () => {
      let ok = 0; sels.forEach(s => { const good = s.value === s.dataset.answer; s.className = 'gap ' + (good ? 'ok' : 'bad'); if (good) ok++; });
      msg.replaceChildren(h('div', { class: 'msg' }, `${ok} de ${sels.length} correctos.`));
    };
    const reveal = () => { sels.forEach(s => { s.value = s.dataset.answer; s.className = 'gap ok'; }); msg.replaceChildren(); };
    host.replaceChildren(
      h('div', { class: 'lbl', style: 'margin-top:0' }, `${ex.name} · nivel ${ex.level}`),
      h('details', null, h('summary', null, 'Ver enunciado'), h('pre', { class: 'sub', style: 'padding:0 12px 12px' }, ex.sub)),
      code, msg,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', style: 'flex:1', onclick: check }, 'Comprobar'),
        h('button', { class: 'btn', onclick: reveal }, 'Mostrar'), h('button', { class: 'btn', onclick: start }, 'Otro')));
  }
  show(h('div', { class: 'screen' }, topbar('Rellenar huecos', 'Operadores y valores', screenHome), seg, host));
  start();
}

/* ---------- arranque ---------- */
async function boot() {
  let data = null;
  try { const r = await fetch('data/rank02.json', { cache: 'no-cache' }); if (!r.ok) throw 0; data = await r.json(); LS.set('data', data); }
  catch (e) { data = LS.get('data', null); }
  if (!data) {
    app.replaceChildren(h('div', { class: 'center' }, h('div', null, h('p', null, 'No se pudieron cargar los ejercicios. Comprueba la conexión.'), h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Reintentar'))));
    return;
  }
  DATA = data;
  if (exam && exam.finished) { /* se muestra en portada */ }
  screenHome();
}
boot();
