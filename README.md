# Examshell · Rango 02

Simulador del examen de 42 (Rango 02: niveles 0–3, 55 ejercicios) pensado para el móvil. **Compila y prueba tu C dentro del navegador** (clang en WebAssembly): sin servidor, sin cuentas, sin IA.

- **Examen**: 4 niveles seguidos, un ejercicio al azar por nivel, cronómetro.
- **Práctica libre**, **Ordenar líneas** y **Rellenar huecos** (sin teclado).
- **Probar**: compila con `-Wall -Wextra -Werror` y compara la salida de tu programa con la de la solución de referencia en todos los casos del tester.
- **Comprobar**: revisión instantánea sin compilar (funciones permitidas, firma, variables sin usar…).
- PWA: la primera vez que pulsas «Probar» se descargan ~18 MB (compilador); queda en caché y funciona sin conexión. «Añadir a pantalla de inicio» desde el navegador.

## Publicar en GitHub Pages

1. Crea un repositorio y sube **todo el contenido de esta carpeta** a la raíz.
2. *Settings → Pages → Deploy from a branch → main / (root)*.
3. Abre `https://TU_USUARIO.github.io/TU_REPO/` en el móvil.

Es todo estático; también vale cualquier otro hosting estático (HTTPS obligatorio para el service worker). Para probar en local: `python3 -m http.server` y abre `http://localhost:8000`.

## Regenerar los datos

`python3 -I tools/build_data.py RUTA_A_42_examshell data/rank02.json` (necesita gcc). Genera enunciados, soluciones y salidas esperadas a partir del repositorio original.

## Autoría

Los ejercicios, las soluciones de referencia y el código de las pruebas (`tester.sh`, `main.c`) son obra de **terminal-42s** (https://github.com/terminal-42s/42_examshell). Esta app sólo los reempaqueta para ejecutarlos en el navegador; el mérito del contenido es suyo.

## Limitaciones conocidas

- Clang 8 (WASI, 32 bits) no es gcc: los avisos coinciden en casi todo (la excepción, «variable asignada pero no usada», la cubre el comprobador básico). En pruebas con 159 variantes erróneas de las soluciones, el veredicto coincidió con gcc en 156; en 3 casos con comportamiento indefinido «Probar» dio por buena una solución que gcc rechaza.
- Límite de 3 s por caso; si tu programa no termina se reinicia el compilador.
- `ft_range` (solución de referencia del repo original) usa `abs()` aunque el enunciado sólo permite `malloc`; el comprobador lo señala.

## Créditos y licencias

Ver `THIRD_PARTY.md`. Los ejercicios y casos proceden de https://github.com/terminal-42s/42_examshell; ese repositorio no declara licencia: **pide permiso a sus autores antes de publicar los datos de `data/rank02.json`** o quítalos y genera los tuyos con `tools/build_data.py`.
