#!/usr/bin/env python3
"""Genera data/rank02.json a partir de un clon de terminal-42s/42_examshell.

Uso:  python3 -I tools/build_data.py RUTA_AL_CLON data/rank02.json

Para cada ejercicio del rango 02 lee el enunciado (sub.txt), la solución de
referencia, el main.c y las cabeceras, extrae del tester los argumentos de cada
caso y precalcula con gcc la salida esperada. Necesita gcc y bash.
Atención (seguridad): compila y ejecuta las soluciones de referencia del repositorio.
"""
import os, re, json, subprocess, tempfile, shutil, sys

CAP = 20000  # máximo de caracteres de salida guardados por caso

def rd(p):
    with open(p, encoding="utf-8", errors="replace") as f:
        return f.read()

def main(repo, out_path):
    root = os.path.join(repo, ".resources", "rank02")
    data = []
    for lvl in range(4):
        ld = os.path.join(root, f"level{lvl}")
        for name in sorted(os.listdir(ld)):
            d = os.path.join(ld, name)
            if not os.path.isdir(d):
                continue
            sub = rd(os.path.join(d, "sub.txt"))
            ref = rd(os.path.join(d, name + ".c"))
            mainc = rd(os.path.join(d, "main.c")) if os.path.exists(os.path.join(d, "main.c")) else None
            headers = {h: rd(os.path.join(d, h)) for h in sorted(os.listdir(d)) if h.endswith(".h")}
            calls = []
            for t in sorted(x for x in os.listdir(d) if x.startswith("tester") and x.endswith(".sh")):
                for line in rd(os.path.join(d, t)).splitlines():
                    m = re.match(r'^\s*\./out1(.*?)\s*>\s*out1\.txt', line)
                    if m:
                        calls.append(m.group(1).strip())
            seen = []
            for c in (calls or [""]):
                if c not in seen:
                    seen.append(c)
            tmp = tempfile.mkdtemp(prefix="ref_")
            srcs = [os.path.join(d, name + ".c")] + ([os.path.join(d, "main.c")] if mainc is not None else [])
            r = subprocess.run(["gcc", "-w", "-I", d, "-o", os.path.join(tmp, "ref")] + srcs, capture_output=True, text=True)
            tests = []
            if r.returncode == 0:
                for c in seen:
                    try:
                        p = subprocess.run(["bash", "-c", f"./ref {c}"], cwd=tmp, capture_output=True, text=True, timeout=5)
                        out, trunc = p.stdout, len(p.stdout) > CAP
                    except subprocess.TimeoutExpired:
                        out, trunc = "(timeout)", False
                    tests.append({"args": c, "out": out[:CAP], "trunc": trunc})
            else:
                print("NO COMPILA", name, r.stderr[:200], file=sys.stderr)
            shutil.rmtree(tmp, ignore_errors=True)
            data.append({"name": name, "level": lvl, "sub": sub, "ref": ref, "main": mainc,
                         "headers": headers, "tests": tests})
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("[\n" + ",\n".join(json.dumps(e, ensure_ascii=False) for e in data) + "\n]\n")
    print(len(data), "ejercicios;", sum(len(e["tests"]) for e in data), "casos;",
          sum(1 for e in data for t in e["tests"] if t["trunc"]), "salidas truncadas")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
