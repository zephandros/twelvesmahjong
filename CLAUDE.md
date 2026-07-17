# Mahjong Twelves · 麻雀トウェルブス (TwelvesMahjong)

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
`src/ui/characters.ts`: alice, bartleby, cyrano, scheherazade, dorian, jekyll,
dracula, hamlet, huck, celestina, defarge, pinocchio).

## Git

Repo **local, sin remoto** por ahora (se conectará a GitHub más adelante).
Autor: `zephandro <twelvesrpg@gmail.com>` (config `--local`). **`raw/` está en
`.gitignore`** — pesa ~110 MB y tiene respaldo externo; no debe entrar al repo.

## Stack

- **TypeScript + Vite**, sin framework de UI. La UI es DOM + CSS transforms.
- **PWA** (`vite-plugin-pwa`): service worker + manifest → instalable y offline.
  Precache ~3.2 MB (código, fuentes, fichas SVG, retratos, sfx, voces); la **música**
  (~62 MB, 18 temas) queda **fuera del precache** y va por `runtimeCaching`
  (CacheFirst + rangeRequests, cache `tm-music`). **Auditoría offline (A7): pasa** —
  con el servidor parado la partida es 100% jugable; lo único que falta offline es la
  música aún no escuchada (se cachea al primer play). Presupuesto de precache <15 MB.
- **vitest** para tests. El núcleo se testea sin DOM.
- Distribución: host estático (GitHub Pages). El SW **no** funciona sobre `file://`.

Comandos: `npm run dev` · `npm run build` · `npm test`. Assets: `npm run assets:tiles`
· `assets:audio` (requiere ffmpeg) · `assets:fonts` (requiere Python + fontTools)
· `assets:i18n` (CSV de traducciones → módulo TS; solo node).

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

## i18n (es / en / ja)

**Fuente de verdad: `i18n/strings.csv`** (`key|context|es|en|ja`, separador **pipe**
para no entrecomillar comas; celda en/ja vacía = fallback a es). `npm run assets:i18n` lo compila a
`src/ui/i18n-strings.generated.ts` (commiteado; claves tipadas `MsgKey`) y **valida**:
claves, placeholders `{x}` consistentes, y que todo glifo CJK/kana de las 3 columnas
esté en `GLYPHS` de `scripts/jp_glyphs.py`. Runtime: `src/ui/i18n.ts` (`t(key, params)`,
`setLocale`, `detectLocale`); idioma en `Settings.language` (`'auto'` = navegador,
fallback es); `?lang=es|en|ja` fuerza sin persistir. **core/ nunca produce texto**:
devuelve ids (`YakuId`, `Limit`, `AbortReason`, `windName`) y la UI traduce
`yaku.${id}`… — el tipo `DerivedKeyCheck` de i18n.ts rompe el typecheck si el CSV
pierde una clave derivada. Los módulos de UI **no resuelven `t()` en top-level**
(guardan claves; el cambio de idioma en caliente re-pinta). Nombres/epítetos de
personajes: `char.<id>.*` + helpers `charName`/`charEpithet`. `src/debug/` queda fuera.

**Flujo del traductor**: editar `i18n/strings.csv` → `npm run assets:i18n` (si aborta
por glifos: ampliar `GLYPHS` en `scripts/jp_glyphs.py` y `npm run assets:fonts`) →
`npm test` (integridad + frescura del generado) → commitear CSV + generado (+ woff2).
Todos los font-stacks de `styles.css` acaban en `'Noto Serif JP'` (su subset trae
todos los glifos del i18n): los kanji se pintan offline en cualquier idioma.

## Habilidades (能力)

Saki tiene habilidades sobrenaturales. v1 juega riichi estricto, pero `src/core/hooks.ts`
define puntos de intercepción (no-op en v1): `onBuildWall`, `beforeDraw`,
`onCallOpportunity`, `onWin`. Son funciones puras de `(state, rng)` → no rompen
determinismo ni replays. Añadir una habilidad = escribir un `Ability`, no refactorizar.

## Layout

Espacio de diseño fijo **1920×1080** (16:9), escalado con `min(vw/1920, vh/1080)` y
letterbox centrado (`layout.ts`). Coordenadas copiadas del mockup Figma del usuario
(`raw/code/index.tsx`): **mesa 4:3 de 1440×1080 centrada** (x 240..1680), 4 paneles de
personaje 240×540 en las esquinas, centro 180×180 en (960,540), molinete de descartes.
Tres tamaños de ficha: mano propia 68×90, descartes/melds 45×60, manos rivales 45×30.
El mapeo asiento↔borde↔esquina vive SOLO en `seat.ts` (trampa 1). Móvil: `landscape`.
`src/debug/board.ts` (`?debug=board`) quedó con coordenadas viejas (1280×720) — pendiente.

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
| `raw/portraits/` | PNG originales de retratos (fuente del bake; **Dante fuera, Scheherazade dentro**) | Horneados en `public/portraits/` |
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
  PATH: `winget install Gyan.FFmpeg`, luego reabrir la shell para refrescar el PATH).
  Todo a AAC-LC `.m4a` con loudnorm (`-vn` descarta la carátula embebida de los mp3);
  idempotente (escribe a temporal y renombra al éxito; `--force` regenera) →
  `public/music/{slug-kebab}.m4a` (+ `-alt`), `public/sfx/tile-click-{nota}.m4a`,
  `public/voices/{slug}_{call}.m4a` (+ `{slug}_alt_{call}.m4a`). Las voces se renombran
  con un parser tolerante + **tabla de actores** (Takumi→dracula, Henry→jekyll); el
  script **falla si algún personaje con voz no tiene las 6 llamadas**. Al añadir voces
  de un personaje nuevo: se dejan en `raw/voices/`, se añade el actor a `ACTORS` del
  script y el slug a `VOICED` en `src/ui/audio/catalog.ts`.
- **Fuentes** — `npm run assets:fonts` (`scripts/fetch-fonts.mjs` + `scripts/subset-murecho.py`
  + `scripts/subset-jp.py`; requiere Python + fontTools + brotli) → woff2 en
  `public/fonts/`. La lista de glifos JP vive en `scripts/jp_glyphs.py` (compartida
  por ambos subsets): **al añadir kanji nuevos a la UI, ampliarla y relanzar**.
  El subset de Murecho verifica el cmap y falla si pierde glifos (los que Murecho
  no trae —發搶槓— los cubre el fallback Noto).
- **Retratos** — `scripts/bake-portraits.ps1` (PowerShell + System.Drawing, ya existente)
  lee de `raw/portraits/` (fuente real; `../Resources/Portraits` quedó obsoleta) →
  `public/portraits/{slug}.jpg` (720px) + `{slug}-t.jpg` (264px). La tabla `$roster`
  mapea slug→patrón de archivo; al cambiar el roster, actualizarla.

## Decisiones de assets (2026-07-12)

- **Título**: el juego se llama **Mahjong Twelves** (麻雀トウェルブス).
- **Menú principal**: pantalla de portada (título, partida libre, sliders de volumen).
  Su canción exclusiva es **Invitation to the Glass Hall**; a los **1.5 s** de que
  entra suena el clip de portada (`voices/title.m4a`: la VA de Alice —Sameno— dice
  "Mahjong Twelves"). Los otros 8 temas suenan en partida (elección con `Math.random`,
  jamás con el RNG semillado del core).
- **Voces** (los **12** personajes tienen voz; los raw se nombran por seiyuu, no por
  personaje): **Sameno → Alice**, **Hadou → Dorian**, **Henry → Jekyll**,
  **Takumi → Drácula**, **Hideki → Hamlet**, **Yukari → Celestina**, **Peter → Cyrano**,
  **Shizuka → Scheherazade**, **Koichi Yashiro → Bartleby**, **Aya → Defarge**,
  **Reiji Kudo → Huck**, **Toa Seo → Pinocho**. Solo la voz principal se usa; las
  variantes `_Alt` (si las hay) se procesan pero quedan sin usar. El clip `Sameno_Alice`
  sigue **sin usar** (prototipo de "di tu nombre al elegir personaje", pendiente); el
  pipeline lo salta vía `IGNORE` con aviso. Al asignar/cambiar un actor: mapearlo en
  `ACTORS` (build-audio.mjs) y `VOICED` (catalog.ts).
- **Campanas**: `bell_01` = clic de UI (menú/selección); `bell_02` = alerta de llamada
  en partida (chi/pon/kan/riichi/ron), junto a la voz del personaje.
- **Click de ficha**: aleatorio entre un set de **4 notas según el tema de mesa** (para
  no cansar con el mismo sonido): mesa `wood` → {c2, d2, e2, f2}; el resto → {f2, g2,
  a2, b2}. Sin repetir la última nota sonada.
- **Fuentes**: **Murecho** reemplaza Rajdhani (`--ui`) y encabeza `--jp`. Cobertura
  verificada: a Murecho le faltan **發搶槓**, así que el subset de Noto Serif JP se
  queda **permanentemente** de fallback en `--jp` (los pinta Noto en serif; asumido).
  **Cormorant Garamond + EB Garamond** auto-alojadas (`--display-serif` / `--serif`)
  para el look Antique Parlour. **A6 hecho**: `--display` = Cormorant y **Teko retirada**
  (sin `@font-face` ni descarga). El TTF completo de Noto (insumo del subset, 13 MB)
  vive en `raw/font/`, nunca en `public/`.
- **Antique Parlour (A6)**: fondo de salón oscuro + mesa 4:3 (`.tm-board`) con marco de
  madera; **temas de fieltro** (green/red/blue/wood) y **5 dorsos de ficha** seleccionables
  desde el **menú in-game** (botón ☰ en el panel del jugador — ya no es barra), aplicados
  vía `[data-table]`/`[data-back]` en `.tm-stage` y persistidos en Settings. Layout portado
  al mockup Figma 1920×1080 (ver Layout). Pantalla de victoria (1B): mismo diseño,
  reescalada a 1920×1080 (`.tm-win` = caja 1280×720 centrada ×1.5). Único fleco:
  `?debug=board` con coordenadas viejas (página de depuración, no afecta al juego).

## Alcance v1

Partida libre (フリー対局): elegir personaje + 3 rivales, tonpuusen (ronda de Este),
aka dora, yaku + fu completos, IA por ukeire, pantalla de tsumo/ron. Sin habilidades.
