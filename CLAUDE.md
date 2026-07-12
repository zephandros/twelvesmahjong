# RIICHI · 咲 (TwelvesMahjong)

Riichi mahjong single-player, offline, instalable. Referencia estética y de flujo:
**Saki Portable (PSP)** — riichi estándar con personajes, retratos alrededor de la mesa
y momentos dramáticos de victoria. Para uso personal, sin monetizar.

El plan completo vive en
`C:\Users\Alejandro\.claude\plans\quiero-hacer-un-juego-buzzing-hoare.md`.
El plan de integración de assets (`raw/`) vive en
`C:\Users\Alejandro\.claude\plans\revisa-claude-md-contexto-es-generic-melody.md`.

## Universo Twelves

Los personajes pertenecen a **Twelves**, universo de creación propia del usuario.
El mundo se llama **Kovalet**; sus 12 figuras centrales son **los 12 Movimientos**,
representados por los 12 personajes jugables (slugs canónicos en
`src/ui/characters.ts`: alice, bartleby, cyrano, dante, dorian, jekyll, dracula,
hamlet, huck, celestina, defarge, pinocchio).

## Git

Repo **local, sin remoto** por ahora (se conectará a GitHub más adelante).
Autor: `zephandro <twelvesrpg@gmail.com>` (config `--local`). **`raw/` está en
`.gitignore`** — pesa ~110 MB y tiene respaldo externo; no debe entrar al repo.

## Stack

- **TypeScript + Vite**, sin framework de UI. La UI es DOM + CSS transforms.
- **PWA** (`vite-plugin-pwa`): service worker + manifest → instalable y offline.
- **vitest** para tests. El núcleo se testea sin DOM.
- Distribución: host estático (GitHub Pages). El SW **no** funciona sobre `file://`.

Comandos: `npm run dev` · `npm run build` · `npm test`.

## Arquitectura

Núcleo **puro y determinista**: un reducer `(state, action) => state` sobre un RNG
semillado. Una partida = `seed + log de acciones` → tests sin UI, IA que simula
bifurcando el estado, y replays casi gratis.

```
src/core/   # sin DOM, determinista, cero dependencias
src/ai/     # bots
src/ui/     # DOM + CSS; un nodo por ficha, movido con transform
```

**Un nodo DOM por ficha, persistente.** Nunca se recrea el DOM; mover una ficha es
cambiar su `transform` y la transición CSS anima sola. Por eso no hace falta framework.

**Renderer de fichas detrás de una interfaz** (`ui/tile-view.ts`): hoy `BoxRenderer`
(caja + etiqueta); cuando lleguen los assets, `SpriteRenderer`, sin tocar `core/`.
**No se genera arte de fichas** — lo proporciona el usuario.

## Notación de fichas (canónica — la misma del mockup)

`m` pinzu-no, `p`, `s`, `z`. `Tile34` es el índice 0..33:

```
 0..8   1m..9m
 9..17  1p..9p
18..26  1s..9s
27..30  E, S, W, N          (z1..z4)
31..33  haku, hatsu, chun   (z5..z7)
```

`TileId` 0..135 identifica copias concretas (necesario para aka dora y para saber qué
ficha exacta se descartó/llamó). Aka dora = copias **16 / 52 / 88** (5m / 5p / 5s rojo).

**Regla de oro:** cualquier orden externo (assets, mockup) se traduce a este índice
**en el borde del sistema**, jamás dentro de `core/`.

## Trampas conocidas del material de referencia

Ver el plan para el detalle. Resumen:

1. **Vientos de asiento cruzados en el mockup.** El turno es E→S→W→N: 南 a la derecha,
   西 enfrente (arriba), 北 a la izquierda. El HTML de referencia los tiene mal.
   → El mapeo asiento↔viento↔pantalla vive **solo** en `src/core/seat.ts`.
2. **Honores de los sets SVG en orden no canónico.** Aplica a
   `../Mahjong/tiles_borderless/` y **confirmado también en `raw/tiles/`**:
   `tile_honor_05` es rojo `#870000` (probable 中 chun) y `tile_honor_07` tiene azul
   `#00082d` (probable haku) → dragones invertidos; vientos 01..04 posiblemente con
   S/W intercambiados. Remapear en el pipeline (`scripts/build-tiles.mjs`, tabla
   explícita) con **verificación visual obligatoria** en `?debug=tiles`; nunca
   indexar por nombre de archivo. **Mapeo aplicado** (evidencia: `sodipodi:docname`
   en kanji de cada SVG + verificación de tinta por canvas):
   `honor_01→E · 02→W · 03→S · 04→N · 05→chun · 06→hatsu · 07→haku`.
3. **La mano de ejemplo del mockup es ilegal** (pinfu con pareja de vientos de asiento).
   → Los yaku se derivan **siempre** del motor, nunca se escriben a mano en la vista.

## Habilidades (能力)

Saki tiene habilidades sobrenaturales. v1 juega riichi estricto, pero `src/core/hooks.ts`
define puntos de intercepción (no-op en v1): `onBuildWall`, `beforeDraw`,
`onCallOpportunity`, `onWin`. Son funciones puras de `(state, rng)` → no rompen
determinismo ni replays. Añadir una habilidad = escribir un `Ability`, no refactorizar.

## Layout

Espacio de diseño fijo **1280×720**, escalado con `min(vw/1280, vh/720)`. Las coordenadas
se copian del mockup literalmente. Móvil: `orientation: landscape`. Ver
`../Mahjong/extra_code/Saki Mahjong.dc.html` (geometría exacta) y
`../Mahjong/screenshots/` (render + capturas reales).

## Assets de referencia (en `../Mahjong` y `../Resources`)

| Ruta | Qué es |
|---|---|
| `../Mahjong/extra_code/Saki Mahjong.dc.html` | Mockup con geometría exacta (pantallas 1A tablero, 1B tsumo). |
| `../Mahjong/screenshots/` | Render del mockup + capturas reales de Saki Portable. |
| `../Resources/Portraits/` | 28 retratos del elenco de Twelves (arte de personajes). |
| `../Mahjong/tiles_borderless/` | Set de fichas SVG. **No usar en v1** (ver trampa 2). |

`../CardGame/engine.js` es de otro juego (12 fichas, sin par) — **no reutilizar**.

## Assets crudos (`raw/`) — fuera del repo

Assets definitivos por procesar. `raw/` está en `.gitignore` (respaldo externo).

| Carpeta | Qué es | Estado |
|---|---|---|
| `raw/code/` | Nuevo diseño del tablero "Antique Parlour" (mockup dc.html, pantallas 1A/1B, temas de mesa y dorsos) | Pendiente (fase A6) |
| `raw/font/Murencho/` | Fuente **Murecho** (variable TTF + estáticas + OFL) | Pendiente (fase A2) |
| `raw/music/` | 9 temas × 2 (normal + `_Alt`), mp3 | Pendiente (fase A3) |
| `raw/portraits/` | 24 PNG originales de retratos | **Solo backup** — ya horneados en `public/portraits/` |
| `raw/sound_effects/` | `tile_click_{a2..g2}.wav` — 7 notas musicales del click de ficha | Pendiente (fase A3) |
| `raw/tiles/` | 37 SVGs solo-glifo (man/pin/so 1-9, honor 1-7, aka ×3), viewBox `0 0 139.764 200` | Pendiente (fase A1; ver trampa 2) |
| `raw/voices/` | Voces por llamada (chi/pon/kan/riichi/ron/tsumo), naming inconsistente, elenco incompleto | Pendiente (fase A3) |

## Pipelines de assets (cómo procesar nuevos raws)

Todos los pipelines escriben a `public/` y son idempotentes. Cero dependencias de
runtime; los scripts usan devDeps (svgo) o herramientas de sistema (ffmpeg, Python +
fontTools), documentadas aquí. *(Los comandos `assets:*` se crean en las fases A1–A3;
esta sección se refina con los flags exactos al materializarse cada script.)*

- **Fichas** — `npm run assets:tiles` (`scripts/build-tiles.mjs`, devDep svgo) →
  `public/tiles/{label}.svg` con labels exactos de `labelId()` (`1m..9m`, `E`, `haku`,
  `0m` aka…). Honores SIEMPRE vía tabla de remapeo explícita + verificación visual en
  `?debug=tiles` antes de fijarla. Al añadir SVGs nuevos: van a `raw/tiles/`, se amplía
  la tabla del script y se re-verifica.
- **Audio** — `npm run assets:audio` (`scripts/build-audio.mjs`; requiere **ffmpeg** en
  PATH: `winget install Gyan.FFmpeg`). Todo a AAC-LC `.m4a` con loudnorm →
  `public/music/{slug-kebab}.m4a`, `public/sfx/tile-click-{nota}.m4a`,
  `public/voices/{slug}_{call}.m4a` (+ `{slug}_alt_{call}.m4a`). Las voces se renombran
  con un parser tolerante + **tabla de actores** (Takumi→dracula, Henry→jekyll). Al
  añadir voces de un personaje nuevo: se dejan en `raw/voices/`, se añade el actor a la
  tabla del script y el slug a `VOICED` en `src/ui/audio/catalog.ts`.
- **Fuentes** — `npm run assets:fonts` (`scripts/fetch-fonts.mjs` + `scripts/subset-murecho.py`
  + `scripts/subset-jp.py`; requiere Python + fontTools + brotli) → woff2 en
  `public/fonts/`. La lista de glifos JP vive en `scripts/jp_glyphs.py` (compartida
  por ambos subsets): **al añadir kanji nuevos a la UI, ampliarla y relanzar**.
  El subset de Murecho verifica el cmap y falla si pierde glifos (los que Murecho
  no trae —發搶槓— los cubre el fallback Noto).
- **Retratos** — `scripts/bake-portraits.ps1` (PowerShell + System.Drawing, ya existente)
  → `public/portraits/{slug}.jpg` (720px) + `{slug}-t.jpg` (264px).

## Decisiones de assets (2026-07-12)

- **Menú principal**: se crea pantalla nueva (título, partida libre, ajustes de audio).
  Su canción exclusiva es **Invitation to the Glass Hall**; los otros 8 temas suenan en
  partida (elección con `Math.random`, jamás con el RNG semillado del core).
- **Voces**: **Takumi → Drácula**, **Henry → Jekyll**. Solo la voz principal se usa; las
  variantes `_Alt` se procesan y publican pero quedan sin usar. Personajes sin voz = mudos.
- **Click de ficha**: aleatorio entre un set de **4 notas según el tema de mesa** (para
  no cansar con el mismo sonido): mesa `wood` → {c2, d2, e2, f2}; el resto → {f2, g2,
  a2, b2}. Sin repetir la última nota sonada.
- **Fuentes**: **Murecho** reemplaza Rajdhani (`--ui`) y encabeza `--jp`. Cobertura
  verificada: a Murecho le faltan **發搶槓**, así que el subset de Noto Serif JP se
  queda **permanentemente** de fallback en `--jp` (los pinta Noto en serif; asumido).
  **Cormorant Garamond + EB Garamond** auto-alojadas (`--display-serif` / `--serif`)
  para el look Antique Parlour; `--display` migra a Cormorant en A6 y Teko se retira
  entonces. El TTF completo de Noto (insumo del subset, 13 MB) vive en `raw/font/`,
  nunca en `public/`.

## Alcance v1

Partida libre (フリー対局): elegir personaje + 3 rivales, tonpuusen (ronda de Este),
aka dora, yaku + fu completos, IA por ukeire, pantalla de tsumo/ron. Sin habilidades.
