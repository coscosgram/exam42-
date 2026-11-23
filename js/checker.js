/* Comprobación básica de código C, sin compilar. Funciones puras (sin DOM). */
const LIBC_HEADERS = {
  write: 'unistd.h', read: 'unistd.h', close: 'unistd.h',
  malloc: 'stdlib.h', calloc: 'stdlib.h', realloc: 'stdlib.h', free: 'stdlib.h', atoi: 'stdlib.h',
  atol: 'stdlib.h', exit: 'stdlib.h', abs: 'stdlib.h', labs: 'stdlib.h', qsort: 'stdlib.h',
  rand: 'stdlib.h', srand: 'stdlib.h', strtol: 'stdlib.h',
  strlen: 'string.h', strcpy: 'string.h', strncpy: 'string.h', strcat: 'string.h', strncat: 'string.h',
  strcmp: 'string.h', strncmp: 'string.h', strchr: 'string.h', strrchr: 'string.h', strstr: 'string.h',
  strdup: 'string.h', strcspn: 'string.h', strspn: 'string.h', strpbrk: 'string.h',
  memcpy: 'string.h', memmove: 'string.h', memset: 'string.h', memcmp: 'string.h',
  printf: 'stdio.h', fprintf: 'stdio.h', sprintf: 'stdio.h', snprintf: 'stdio.h', puts: 'stdio.h',
  putchar: 'stdio.h', putc: 'stdio.h', fputs: 'stdio.h', scanf: 'stdio.h', sscanf: 'stdio.h',
  getchar: 'stdio.h', gets: 'stdio.h', fgets: 'stdio.h', perror: 'stdio.h',
  isalpha: 'ctype.h', isdigit: 'ctype.h', isalnum: 'ctype.h', isspace: 'ctype.h', isupper: 'ctype.h',
  islower: 'ctype.h', isprint: 'ctype.h', toupper: 'ctype.h', tolower: 'ctype.h',
  sqrt: 'math.h', pow: 'math.h', itoa: 'stdlib.h'
};
const CONTROL = new Set(['if', 'while', 'for', 'switch', 'return', 'sizeof', 'else', 'do', 'case']);

/* Quita comentarios, cadenas y caracteres. Devuelve {text, errors}. Conserva los saltos de línea. */
function stripCode(code) {
  let out = '', i = 0, line = 1; const errors = [];
  const n = code.length;
  while (i < n) {
    const c = code[i], d = code[i + 1];
    if (c === '/' && d === '/') { while (i < n && code[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      const start = line; i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) { if (code[i] === '\n') { line++; out += '\n'; } i++; }
      if (i >= n) errors.push({ line: start, msg: 'Comentario /* sin cerrar.' });
      i += 2; continue;
    }
    if (c === '"' || c === "'") {
      const q = c, start = line; let closed = false; i++;
      while (i < n) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === '\n') break;
        if (code[i] === q) { closed = true; i++; break; }
        i++;
      }
      if (!closed) errors.push({ line: start, msg: q === '"' ? 'Cadena " sin cerrar.' : "Carácter ' sin cerrar." });
      out += q === '"' ? '""' : "' '"; continue;
    }
    if (c === '\n') line++;
    out += c; i++;
  }
  return { text: out, errors };
}

function balanceErrors(stripped) {
  const pairs = { ')': '(', '}': '{', ']': '[' }, stack = [], errs = [];
  let line = 1;
  for (const c of stripped) {
    if (c === '\n') line++;
    else if ('({['.includes(c)) stack.push({ c, line });
    else if (pairs[c]) {
      const top = stack.pop();
      if (!top || top.c !== pairs[c]) { errs.push({ line, msg: `Sobra o no coincide «${c}».` }); return errs; }
    }
  }
  if (stack.length) { const t = stack[stack.length - 1]; errs.push({ line: t.line, msg: `«${t.c}» sin cerrar.` }); }
  return errs;
}

function allowedFns(sub) {
  const m = sub.match(/Allowed functions:\s*([\s\S]*?)\n-{5,}/);
  if (!m) return [];
  return m[1].split(/[,\s]+/).filter(x => /^\w+$/.test(x) && x.toLowerCase() !== 'none');
}

const norm = s => s.replace(/\s+/g, ' ').replace(/\s*\*\s*/g, ' *').replace(/\* /g, '*').trim();
function paramTypes(list) {
  const t = list.trim();
  if (t === '' || t === 'void') return [];
  const parts = []; let depth = 0, cur = '';
  for (const ch of t) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch; }
  parts.push(cur);
  return parts.map(p => {
    if (/\(\s*\*/.test(p)) return norm(p.replace(/\(\s*\*\s*\w*\s*\).*$/, '(*)'));
    p = norm(p);
    // quita el nombre final del parámetro si lo hay
    let ty = p;
    if (/\b[A-Za-z_]\w*$/.test(p) && /[\s*]/.test(p)) ty = p.replace(/\b[A-Za-z_]\w*$/, '').trim();
    return ty.replace(/\s+/g, ' ');
  });
}

/* Prototipo esperado, tomado del enunciado. */
function protoFromSub(sub, name) {
  const re = new RegExp('^[ \\t]*([A-Za-z_][\\w \\t\\*]*?)\\b' + name + '\\s*\\(((?:[^()]|\\([^()]*\\))*)\\)\\s*;?\\s*$', 'm');
  const m = sub.match(re);
  if (!m) return null;
  const ret = norm(m[1]);
  if (/^(Write|The|If|\$>)/.test(ret)) return null;
  return { ret, params: paramTypes(m[2]) };
}


/* Variables locales declaradas pero nunca leídas. gcc las rechaza con -Wall -Werror
   (-Wunused-variable y -Wunused-but-set-variable). clang 8 sólo conoce la primera. */
function unusedLocals(clean) {
  const res = [];
  // cuerpos de función: bloque { } de primer nivel precedido por ')'
  let depth = 0, start = -1, before = '';
  const bodies = [];
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '{') { if (depth === 0) { start = i; before = clean.slice(Math.max(0, i - 400), i).trimEnd(); } depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start >= 0) { if (before.endsWith(')')) bodies.push(clean.slice(start + 1, i)); start = -1; } }
  }
  const declRe = /(?<=^|[;{}])\s*((?:const\s+|unsigned\s+|signed\s+|static\s+|struct\s+\w+\s+)*(?:int|char|short|long|float|double|size_t|t_\w+|unsigned)\b[^;{}]*);/g;
  for (const body of bodies) {
    const decls = [];
    for (const m of body.matchAll(declRe)) {
      const stmtStart = m.index + m[0].indexOf(m[1]);
      let depthP = 0, cur = '', parts = [];
      for (const ch of m[1]) { if ('([{'.includes(ch)) depthP++; if (')]}'.includes(ch)) depthP--; if (ch === ',' && !depthP) { parts.push(cur); cur = ''; } else cur += ch; }
      parts.push(cur);
      parts.forEach((p, k) => {
        let d = p.split('=')[0];
        if (k === 0) d = d.replace(/^\s*(?:(?:const|unsigned|signed|static|struct\s+\w+|int|char|short|long|float|double|size_t|t_\w+)\s*\**\s*)+/, '');
        if (d.includes('(')) return;
        const id = (d.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])*\s*$/) || [])[1];
        if (id) decls.push({ id, from: stmtStart, to: stmtStart + m[1].length + 1 });
      });
    }
    for (const dcl of decls) {
      const rest = body.slice(0, dcl.from) + ' '.repeat(dcl.to - dcl.from) + body.slice(dcl.to);
      const re = new RegExp('\\b' + dcl.id + '\\b', 'g');
      let n = 0, reads = 0;
      for (const m of rest.matchAll(re)) {
        n++;
        const pre = rest.slice(0, m.index).trimEnd(), post = rest.slice(m.index + dcl.id.length);
        const atStmt = pre === '' || /[;{}]$/.test(pre);
        const isWrite = (atStmt && /^\s*(?:=(?!=)|[-+*\/%|&^]=|\+\+|--)/.test(post)) ||
                        (/(\+\+|--)$/.test(pre) && /^\s*;/.test(post) && (pre.length === 2 || /[;{}]$/.test(pre.slice(0, -2).trimEnd())));
        if (!isWrite) reads++;
      }
      if (n === 0) res.push({ id: dcl.id, kind: 'unused' });
      else if (reads === 0) res.push({ id: dcl.id, kind: 'set' });
    }
  }
  return res;
}

function checkCode(code, ex) {
  const res = [];
  const add = (level, text) => res.push({ level, text });
  if (!code.trim()) { add('err', 'El archivo está vacío.'); return res; }

  const st = stripCode(code);
  st.errors.forEach(e => add('err', `Línea ${e.line}: ${e.msg}`));
  const bal = balanceErrors(st.text);
  bal.forEach(e => add('err', `Línea ${e.line}: ${e.msg}`));
  const clean = st.text;

  const refHasMain = /\bmain\s*\(/.test(ex.ref);
  const codeHasMain = /\bmain\s*\(/.test(clean);
  if (refHasMain) {
    if (!codeHasMain) add('err', 'Falta la función main: este ejercicio es un programa.');
    else add('ok', 'Tiene función main (es un programa).');
  } else if (codeHasMain) {
    add('err', 'Defines main, pero el tester ya compila con su propio main.c. Da «multiple definition of main». Bórralo.');
  } else {
    // función requerida
    const name = ex.name;
    const defRe = new RegExp('(^|\\n)[ \\t]*([A-Za-z_][\\w \\t\\*]*?)\\b' + name + '\\s*\\(((?:[^()]|\\([^()]*\\))*)\\)\\s*(\\{|\\n|$)');
    const dm = clean.match(defRe);
    if (!dm) add('err', `No encuentro la definición de ${name}(…). El nombre debe ser exactamente ese.`);
    else {
      add('ok', `Define ${name}.`);
      const want = protoFromSub(ex.sub, name);
      if (want) {
        const gotRet = norm(dm[2]).replace(/^(static|extern)\s+/, '');
        const gotParams = paramTypes(dm[3]);
        const sameRet = gotRet.replace(/\s/g, '') === want.ret.replace(/\s/g, '');
        const sameP = gotParams.length === want.params.length &&
          gotParams.every((p, i) => p.replace(/\s/g, '') === want.params[i].replace(/\s/g, ''));
        if (!sameRet || !sameP) add('warn', `La firma pedida es «${want.ret} ${name}(${want.params.join(', ')})». La tuya parece distinta; si no coincide, no compila con el main.c del tester.`);
        else add('ok', 'La firma coincide con el enunciado.');
      }
    }
  }

  // funciones de libc
  const allowed = new Set(allowedFns(ex.sub));
  const defined = new Set();
  for (const m of clean.matchAll(/\b(?:int|char|void|long|short|unsigned|float|double|size_t|static|t_list|struct\s+\w+)\b[\s\*]*\b([A-Za-z_]\w*)\s*\(/g)) defined.add(m[1]);
  const used = new Set();
  for (const m of clean.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const f = m[1];
    if (CONTROL.has(f) || defined.has(f) || f === 'main') continue;
    if (LIBC_HEADERS[f]) used.add(f);
  }
  const bad = [...used].filter(f => !allowed.has(f));
  bad.forEach(f => add('err', `Usas «${f}», que no está en las funciones permitidas${allowed.size ? ' (' + [...allowed].join(', ') + ')' : ' (ninguna)'}.`));
  if (!bad.length && used.size) add('ok', 'Sólo usas funciones permitidas.');
  if (!used.size && !bad.length && !allowed.size) add('ok', 'No usas ninguna función externa, como pide el enunciado.');

  // cabeceras necesarias
  const includes = new Set([...code.matchAll(/#\s*include\s*[<"]([^>"]+)[>"]/g)].map(m => m[1]));
  const needHdr = new Map();
  [...used].filter(f => allowed.has(f)).forEach(f => {
    const h = LIBC_HEADERS[f];
    if (!includes.has(h)) { if (!needHdr.has(h)) needHdr.set(h, []); needHdr.get(h).push(f); }
  });
  needHdr.forEach((fs, h) => add('err', `Falta #include <${h}> para ${fs.join(', ')}. Con -Werror da error de declaración implícita.`));

  // main.c del tester ya incluye cabeceras propias (ft_list.h): avisa si falta
  for (const h of Object.keys(ex.headers || {})) {
    if (/\b(t_list|t_point)\b/.test(clean) && !includes.has(h) && h !== 'list.h' && !/t_list\s*;|}\s*t_list/.test(clean)) {
      add('warn', `Usas tipos de ${h} pero no lo incluyes con #include "${h}".`);
      break;
    }
  }

  unusedLocals(clean).forEach(u => add('err', u.kind === 'unused'
    ? `La variable «${u.id}» está declarada y no se usa. Con -Wall -Wextra -Werror no compila.`
    : `La variable «${u.id}» se asigna pero nunca se lee. gcc la rechaza con -Wall -Werror (-Wunused-but-set-variable).`));
  if (!res.some(r => r.level === 'err')) add('ok', 'Sin errores básicos de estructura.');
  return res;
}

if (typeof module !== 'undefined') module.exports = { unusedLocals, checkCode, allowedFns, stripCode, protoFromSub, paramTypes };
