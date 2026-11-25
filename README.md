# Examshell · Rango 02

**Español** · [English](#english)

Simulador del examen de 42 (Rango 02: niveles 0–3, 55 ejercicios) pensado para el móvil. **Compila y prueba tu C dentro del navegador** (clang en WebAssembly): sin servidor, sin cuentas, sin IA.

Creada por [@coscosgram](https://github.com/coscosgram).

## Qué hace

- **Examen**: 4 etapas seguidas, un ejercicio al azar por nivel, cronómetro, racha de días y récord.
- **Práctica libre**, **Ordenar líneas** y **Rellenar huecos** (sin teclado).
- **Probar**: compila con `-Wall -Wextra -Werror` y compara la salida de tu programa con la de la solución de referencia en todos los casos del tester.
- **Comprobar**: revisión instantánea sin compilar (funciones permitidas, firma, variables sin usar…).
- Editor con resaltado de sintaxis de C y barra de símbolos pensada para el teclado del móvil.
- PWA: la primera vez que pulsas «Probar» se descargan ~18 MB (el compilador); queda en caché y funciona sin conexión. Se puede añadir a la pantalla de inicio.
- Tema claro/oscuro según el sistema.

## Autoría

- **App** (interfaz, integración del compilador, comprobador estático, modos de práctica): [@coscosgram](https://github.com/coscosgram).
- **Ejercicios, soluciones de referencia y código de las pruebas** (`tester.sh`, `main.c`): obra de **terminal-42s**, del repositorio [terminal-42s/42_examshell](https://github.com/terminal-42s/42_examshell). Esta app sólo los reempaqueta para ejecutarlos en el navegador; el mérito del contenido es suyo.
- Compilador: [wasm-clang](https://github.com/binji/wasm-clang) (binji), clang/LLVM 8 — Apache-2.0.
- Detalle de licencias de terceros en [`THIRD_PARTY.md`](THIRD_PARTY.md).

## Regenerar los datos

```sh
python3 -I tools/build_data.py RUTA_A_42_examshell data/rank02.json
```

Necesita `gcc`. Genera enunciados, soluciones y salidas esperadas a partir del repositorio original.

## Limitaciones conocidas

- Clang 8 (WASI, 32 bits) no es gcc. Los avisos coinciden en casi todo; la excepción, «variable asignada pero no usada», la cubre el comprobador básico. En pruebas con 159 variantes erróneas de las soluciones, el veredicto coincidió con gcc en 156; en 3 casos con comportamiento indefinido «Probar» dio por buena una solución que gcc rechaza.
- Límite de 3 s por caso; si tu programa no termina se reinicia el compilador.
- La solución de referencia de `ft_range` en el repo original usa `abs()` aunque el enunciado sólo permite `malloc`; el comprobador lo señala.

---

## English

<a id="english"></a>

A mobile-first simulator of the 42 School exam (Rank 02: levels 0–3, 55 exercises). **It compiles and tests your C right in the browser** (clang in WebAssembly): no server, no accounts, no AI.

Created by [@coscosgram](https://github.com/coscosgram).

### Features

- **Exam**: 4 consecutive stages, one random exercise per level, timer, day streak and best time.
- **Free practice**, **Order the lines** and **Fill the gaps** (no keyboard needed).
- **Probar** (Run): compiles with `-Wall -Wextra -Werror` and compares your program's output with the reference solution's on every tester case.
- **Comprobar** (Check): instant check without compiling (allowed functions, signature, unused variables…).
- Editor with C syntax highlighting and a symbol bar designed for phone keyboards.
- PWA: the first time you press "Probar" it downloads ~18 MB (the compiler); it is cached and works offline. Can be added to the home screen.
- Light/dark theme following the system.

### Credits

- **App** (UI, compiler integration, static checker, practice modes): [@coscosgram](https://github.com/coscosgram).
- **Exercises, reference solutions and test code** (`tester.sh`, `main.c`): by **terminal-42s**, from [terminal-42s/42_examshell](https://github.com/terminal-42s/42_examshell). This app only repackages them to run in the browser; the credit for the content is theirs.
- Compiler: [wasm-clang](https://github.com/binji/wasm-clang) (binji), clang/LLVM 8 — Apache-2.0.
- Third-party license details in [`THIRD_PARTY.md`](THIRD_PARTY.md).

### Regenerating the data

```sh
python3 -I tools/build_data.py PATH_TO_42_examshell data/rank02.json
```

Requires `gcc`. Generates statements, solutions and expected outputs from the original repository.

### Known limitations

- Clang 8 (WASI, 32-bit) is not gcc. Warnings match in almost every case; the exception, "variable set but not used", is covered by the basic checker. Tested on 159 faulty variants of the solutions, the verdict matched gcc in 156; in 3 undefined-behaviour cases "Probar" accepted a solution that gcc rejects.
- 3 s limit per case; if your program does not terminate, the compiler is restarted.
- The reference solution of `ft_range` in the original repo uses `abs()` although the statement only allows `malloc`; the checker flags it.
