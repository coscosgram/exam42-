/* Worker: compila C con clang/lld en WebAssembly y ejecuta el resultado (WASI). */
importScripts('wasmapi.js');

let memfs = null, clangMod = null, lldMod = null;
let cur = { out: '', err: '' };
const post = (id, data) => self.postMessage({ id, data });
const hostWrite = (s, fd) => { if (fd === 1) cur.out += s; else cur.err += s; };
/* Descarga wasm/NAME.gz (gzip) con progreso y caché persistente. */
const CACHE = 'xs42-assets-v1';
async function getBytes(name) {
  const url = new URL('../wasm/' + name + '.gz', self.location.href).href;
  let cache = null, r = null;
  try { cache = await caches.open(CACHE); r = await cache.match(url); } catch (e) {}
  let raw;
  if (r) raw = await r.arrayBuffer();
  else {
    r = await fetch(url);
    if (!r.ok) throw new Error('No se pudo descargar ' + name + ' (' + r.status + ')');
    const reader = r.body.getReader(); const chunks = []; let loaded = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); loaded += value.length; post('progress', { file: name, loaded }); }
    raw = await new Blob(chunks).arrayBuffer();
    if (cache) { try { await cache.put(url, new Response(raw)); } catch (e) {} }
  }
  const u = new Uint8Array(raw);
  if (u[0] === 0x1f && u[1] === 0x8b) {
    return await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return raw;
}
const compile = async name => {
  const t = performance.now();
  const buf = await getBytes(name);
  const fetched = performance.now();
  const mod = await WebAssembly.compile(buf);
  return { mod, bytes: buf.byteLength, fetchMs: fetched - t, compileMs: performance.now() - fetched };
};

async function init() {
  const T = {};
  let t = performance.now();
  memfs = new WASM.MemFS({ compileStreaming: async n => (await compile(n)).mod, hostWrite, memfsFilename: 'memfs' });
  await memfs.ready;
  T.memfs = performance.now() - t; t = performance.now();
  const tarBuf = await getBytes('sysroot');
  new WASM.Tar(tarBuf).untar(memfs);
  T.sysroot = performance.now() - t; t = performance.now();
  const c = await compile('clang'); clangMod = c.mod; T.clangFetch = c.fetchMs; T.clangCompile = c.compileMs;
  const l = await compile('lld'); lldMod = l.mod; T.lldFetch = l.fetchMs; T.lldCompile = l.compileMs;
  return T;
}

async function runApp(mod, ...args) {
  cur = { out: '', err: '' };
  const app = new WASM.App(mod, memfs, ...args);
  let trap = null;
  try { await app.run(); } catch (e) { trap = String(e && e.message || e); }
  return { code: app.exitCode, out: cur.out, err: cur.err, trap };
}

const CLANG_BASE = ['-cc1', '-emit-obj', '-disable-free', '-isysroot', '/', '-internal-isystem', '/include',
  '-internal-isystem', '/lib/clang/8.0.1/include', '-ferror-limit', '19', '-fmessage-length', '80', '-O0'];

/* Compila un .c a .o. flags: p. ej. ['-w'] o ['-Wall','-Wextra','-Werror'] */
async function compileC(name, src, flags) {
  memfs.addFile(name + '.c', src);
  const t = performance.now();
  const r = await runApp(clangMod, 'clang', ...CLANG_BASE, ...flags, '-o', name + '.o', '-x', 'c', name + '.c');
  return { ok: r.code === 0 && !r.trap, diag: r.err + r.out + (r.trap ? '\n' + r.trap : ''), ms: performance.now() - t };
}
async function link(objs, wasm) {
  const t = performance.now();
  const r = await runApp(lldMod, 'wasm-ld', '--no-threads', '--export-dynamic', '-z', 'stack-size=1048576',
    '-Llib/wasm32-wasi', 'lib/wasm32-wasi/crt1.o', ...objs, '-lc', '-o', wasm);
  return { ok: r.code === 0 && !r.trap, diag: r.err + r.out + (r.trap ? '\n' + r.trap : ''), ms: performance.now() - t };
}
const mods = {};
function load(wasm) { mods[wasm] = WebAssembly.compile(memfs.getFileContents(wasm).slice()); return mods[wasm]; }

self.onmessage = async ev => {
  const { id, rid, data } = ev.data;
  try {
    if (id === 'init') { post('init', { rid, T: await init() }); }
    else if (id === 'build') {
      // data: { name, src, flags, extra: [{name, src, flags}] }
      const out = { steps: [] };
      for (const [hn, hs] of Object.entries(data.headers || {})) memfs.addFile(hn, hs);
      const objs = [];
      /* En el tester real stdout va a un fichero: printf va con búfer completo y write() directo.
         WASI lo deja sin búfer; este constructor lo iguala. */
      const pre = await compileC('xs_init', '#include <stdio.h>\n__attribute__((constructor)) static void xs_init(void){ setvbuf(stdout, 0, _IOFBF, 4096); }\n', ['-w']);
      if (!pre.ok) { out.ok = false; out.steps.push({ what: 'xs_init', ...pre }); post('build', { rid, out }); return; }
      objs.push('xs_init.o');
      for (const f of data.files) {
        const r = await compileC(f.name, f.src, f.flags);
        out.steps.push({ what: 'clang ' + f.name + '.c', ...r });
        if (!r.ok) { out.ok = false; post('build', { rid, out }); return; }
        objs.push(f.name + '.o');
      }
      const r = await link(objs, data.wasm);
      out.steps.push({ what: 'wasm-ld ' + data.wasm, ...r });
      out.ok = r.ok;
      if (r.ok) await load(data.wasm);
      post('build', { rid, out });
    } else if (id === 'run') {
      const t = performance.now();
      const mod = await mods[data.wasm];
      const r = await runApp(mod, 'prog', ...data.args);
      post('run', { rid, r: { ...r, ms: performance.now() - t } });
    }
  } catch (e) { post('error', { rid, message: String(e && e.stack || e) }); }
};
