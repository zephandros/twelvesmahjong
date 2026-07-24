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
representados por los 12 personajes jugables (slugs canónicos y **orden canónico**
en `src/ui/characters.ts`, roster 2026-07-19: alice, dorian, jekyll, celestina,
dracula, macbeth, ahab, defarge, irene, huck, scheherazade, pinocchio; salieron
bartleby, cyrano y hamlet). Jekyll tiene un arte alterno **hyde**
(`public/portraits/hyde*.jpg`, no es CharacterId): mientras su riichi está vivo,
el panel y la pantalla de victoria muestran a Mr. Hyde.

## Git

Remoto: `origin git@github-zephandros:zephandros/twelvesmahjong.git` (rama `main`).
Autor: `zephandro <twelvesrpg@gmail.com>` (config `--local`). **`raw/` está en
`.gitignore`** — pesa ~110 MB y tiene respaldo externo; no debe entrar al repo.
El juego está **publicado en https://twelvesmahjong.com** (Cloudflare; `dist/` va
al host, no al repo).

## Stack

- **TypeScript + Vite**, sin framework de UI. La UI es DOM + CSS transforms.
- **PWA** (`vite-plugin-pwa`): service worker + manifest → instalable y offline.
  Precache ~3.2 MB (código, fuentes, fichas SVG, retratos, sfx, voces); la **música**
  (~109 MB, 31 temas) queda **fuera del precache** y va por `runtimeCaching`
  (CacheFirst + rangeRequests, cache `tm-music`; `maxEntries` con holgura sobre el nº de
  temas — si se queda corto, el LRU desaloja temas ya oídos y se pierde el offline). **Auditoría offline (A7): pasa** —
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

**La promesa del determinismo ya está cobrada** (2026-07-22): `core/replay.ts` define
`GameLog = { seed, rules, hands: Action[][] }` y `replay(log)` reconstruye la partida
entera con `newGame` + `reduce` + `advanceGame`. De ahí sale el guardado
(`ui/persist.ts`, clave `tm-save-v1`), y de ahí saldrán los replays.

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
Todos los font-stacks de `styles.css` acaban en `'Kosugi'` (su subset trae
todos los glifos del i18n): los kanji se pintan offline en cualquier idioma.

## Habilidades (能力)

Saki tiene habilidades sobrenaturales. v1 juega riichi estricto, pero `src/core/hooks.ts`
define puntos de intercepción (no-op en v1): `onBuildWall`, `beforeDraw`,
`onCallOpportunity`, `onWin`. Son funciones puras de `(state, rng)` → no rompen
determinismo ni replays. Añadir una habilidad = escribir un `Ability`, no refactorizar.

## Estilos y dificultad de bots (2026-07-22)

Los bots ya no juegan todos igual. **`src/ai/profiles.ts`** define DOS EJES ORTOGONALES
—`StyleId` × `SkillId`— que `resolveBehavior(profile)` funde en un `BotBehavior` (los
knobs que consulta `ai/bot.ts`: `useUkeire`, `defense` none/genbutsu/suji,
`foldFromShanten`, `callPolicy` never/yakuhai/improve/greedy, `riichiPolicy`
always/damaten, `noise`). Módulo puro, sin deps. **Regla de oro**:
`resolveBehavior({style:'balanced',skill:'expert'})` = `DEFAULT_BEHAVIOR` reproduce
EXACTAMENTE la política histórica → el bot por defecto no cambió y los tests viejos
siguen verdes. `tests/profiles.test.ts` lo ata. Estilos: balanced, attacker, defender,
speedster, purist, chaotic. Habilidades: novice (sin ukeire/defensa, con ruido) <
intermediate (genbutsu) < expert (suji, sin ruido); la habilidad **capa** la capacidad
que el estilo querría (novice nunca dobla, sea cual sea el estilo).

- **`ai/bot.ts`**: `botTurnAction`/`botReaction(…, behavior = DEFAULT_BEHAVIOR)` (firmas
  retrocompatibles) + `makePolicy(profile): BotPolicy`. `SMART_POLICY` (sim) = `makePolicy(
  DEFAULT_PROFILE)`. El `noise` es lo ÚNICO que usa el `rng` del bot.
- **Estilo ↔ personaje**: `CHARACTER_STYLES: Record<CharacterId, StyleId>` en
  `ui/characters.ts` (config editable, exhaustiva en compilación). NO está atado por
  lógica: el story mode dará a los minions/jefes su propio perfil sin pasar por esta tabla.
- **Dificultad global**: `Settings.difficulty` ('easy'|'normal'|'hard', default normal;
  `skillFor()` → SkillId). Cycler en la sección REGLAS del modal AJUSTES **solo en la
  portada** (`menu.ts`; el menú in-game de `hud.ts` NO lo lleva), claves
  `hud.rules.difficulty` + `settings.difficulty.*`. Nota: el default histórico equivalía a
  `expert`; con `normal` los rivales por defecto son algo más blandos — "Difícil" recupera
  la fuerza de siempre.
- **Controlador**: una `BotPolicy` por asiento rival (estilo del personaje + habilidad de
  la dificultad) y **un RNG por bot** (`makeRng(botSeed ^ SALT[seat])`) para que el ruido
  de cada estilo sea independiente. La dificultad **viaja en el guardado** (`SavedGame.
  difficulty`, lectura tolerante → 'normal') para que reanudar conserve la fuerza; el
  replay no usa el RNG, así que **afinar los perfiles nunca rompe un guardado**.

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
| `raw/font/` | Insumos de fuentes: `_kosugi-full.ttf` (lo baja fetch-fonts.mjs) + `Murencho/` (Murecho, **obsoleta** desde el cambio a Lexend/Belanosima/Kosugi) | Hecho |
| `raw/icons/` | 9 SVG Lucide (menu, x, arrow-big-left, play/pause/skip-\*/volume-\*) para botones de UI | Hecho (assets:icons) |
| `raw/logo/` | Logo de marca: `favicon.ico` + `favicon-16/32.png`, `logo-192/512.png` (emblema de fichas con 十二), `banner-classic-1600x670.png` (logotipo, insumo de la imagen social) y `banner-emblem-1200x300.png` (sin uso) | Hecho (assets:logo) |
| `raw/music/` | 31 temas mp3 (roster 2026-07-21: se retiró el lote inicial de 8 con variante `_Alt` y entraron 20 nuevos). **Es la fuente de verdad**: el pipeline poda de `public/music/` todo lo que no esté aquí | Horneados en `public/music/` (assets:audio) |
| `raw/portraits/` | PNG originales de retratos, 3 aspectos por personaje (`{base}_9_16` tablero/victoria · `_1_1` rejilla de selección · `_3_4` asientos de selección; + `jekyll_hyde_portrait.png` solo 9:16; los `*_cut_in.png` de alice/irene/scheherezade son del enfoque antiguo de cuerpo completo y **no se usan**; + `{slug}_cut_{fierce,sharp}.png` 2:1 de los cut-ins, y `alice_cut_calm.png` que quedó sin uso al descartarse `calm`) | Horneados en `public/portraits/`; de los cut-ins solo **alice** (2/26) |
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
  `public/music/{slug-kebab}.m4a`, `public/sfx/tile-click-{nota}.m4a`,
  `public/voices/{slug}_{call}.m4a` (+ `{slug}_alt_{call}.m4a`). En **música** el kebab
  se come los apóstrofos (`Geppetto's Workshop` → `geppettos-workshop`), las variantes
  `_Alt` **no se hornean** (el catálogo no las usa) y **se podan los huérfanos**: dar de
  baja un tema = sacar su mp3 de `raw/music/` (o moverlo a un subdirectorio, que
  `readdirSync` no es recursivo) + quitarlo del catálogo, y relanzar. Las voces se renombran
  con un parser tolerante + **tabla de actores** (Takumi→dracula, Henry→jekyll); el
  script **falla si algún personaje con voz no tiene las 6 llamadas**. Al añadir voces
  de un personaje nuevo: se dejan en `raw/voices/`, se añade el actor a `ACTORS` del
  script y el slug a `VOICED` en `src/ui/audio/catalog.ts`.
- **Fuentes** — `npm run assets:fonts` (`scripts/fetch-fonts.mjs` +
  `scripts/subset-jp.py`; requiere Python + fontTools + brotli) → woff2 en
  `public/fonts/`: Lexend variable + Belanosima 400 (slices latinos de
  Google Fonts) + `kosugi-subset.woff2`. La lista de glifos JP vive en
  `scripts/jp_glyphs.py`: **al añadir kanji nuevos a la UI, ampliarla y relanzar**.
  El subset de Kosugi verifica el cmap y **falla** si algún glifo pedido no acaba
  en el woff2 (Kosugi es la única fuente CJK, sin fallback).
- **Iconos** — `npm run assets:icons` (`scripts/build-icons.mjs`, devDep svgo) lee
  `raw/icons/*.svg` (Lucide, stroke=currentColor) y emite
  `src/ui/icons.generated.ts` (**commiteado**; `ICONS`/`IconName` tipados). Se
  inyectan inline vía innerHTML: heredan el color del botón y no tocan el
  precache. Añadir un icono = soltar el SVG en `raw/icons/` y relanzar.
- **Retratos** — `npm run assets:portraits` (`scripts/bake-portraits.ps1`, PowerShell +
  System.Drawing) lee de `raw/portraits/` (fuente real; `../Resources/Portraits` quedó
  obsoleta) → `public/portraits/{slug}.jpg` (720px) + `{slug}-t.jpg` (264px) `-sq` `-seat`,
  y las viñetas de cut-in `{slug}-cut-{expr}.jpg` (760px, ver sección de cut-ins). La
  tabla `$roster` mapea slug→patrón de archivo; al cambiar el roster, actualizarla.
- **Logo de marca** — `npm run assets:logo` (`scripts/bake-logo.ps1`, PowerShell +
  System.Drawing como el de retratos; Windows-only) lee `raw/logo/` →
  `public/favicon.ico`, `public/icons/{favicon-16,favicon-32,icon-192,icon-512,
  icon-maskable-512,apple-touch-icon-180}.png` y `public/og/cover.jpg` (1200×630).
  El **maskable** se genera aparte: el emblema al **72 %** sobre un degradado que
  replica su propio fondo (`#0F0B07`→`#0B0805`), para que la ficha frontal caiga
  dentro de la zona segura del 80 % que recortan los lanzadores Android. La imagen
  social sale del banner escalado por alto y **recortado** al centro (2.39:1 → 1.91:1).

## Decisiones de assets (2026-07-12)

- **Título**: el juego se llama **Mahjong Twelves** (麻雀トウェルブス).
- **Menú principal** (reestructurado 2026-07-22): botones **apilados en vertical y del
  mismo ancho**. Sin partida guardada, **JUGAR** (primary) + **OPCIONES**; con partida
  guardada, **CONTINUAR** (primary) + **NUEVO JUEGO** + **OPCIONES**. NUEVO JUEGO
  descarta el guardado y por eso **confirma en dos pasos sobre el propio botón**
  (`.is-armed`; tocar fuera lo desarma). **OPCIONES** es un hub (`buildHubCard`) con
  **AJUSTES · ESTADÍSTICAS · AYUDA**: cada pantalla se abre encima y al cerrarla el hub
  sigue visible (el apilado sale del orden de inserción en el stage, no de z-index).
  **AYUDA es el nuevo nombre del glosario** — mismo `ui/glossary.ts` (hoy solo la lista
  de yaku), pensado para admitir tutoriales como secciones. AJUSTES abre un modal
  **idéntico al menú in-game del tablero** (`.tm-menu-ov`: idioma, tema de mesa, dorso,
  esperas + 4 sliders de volumen) pero **sin la opción de salir y CON la sección
  REGLAS**; cierra con la equis. Los cyclers de tema/dorso escriben
  en `stage.dataset.table/back` (sin vista previa en la portada, no hay mesa/fichas).
  El subtítulo de portada (`menu.tagline`) interpola la duración elegida y se repinta
  al cambiarla.
  **Gate "Toca para continuar"** (`menu.tap-start`, texto **en lugar de los botones**):
  en la **primera visita** de la sesión la portada monta bloqueada (`.tm-menu.is-locked`
  oculta los botones y muestra el prompt); hasta el primer toque (o Enter/Espacio) no
  suena nada. Al tocar aparecen los botones y arranca su canción exclusiva **Invitation
  to the Glass Hall** (`MENU_TRACK`) y, a **1.0 s**, el clip de portada
  (`voices/title.m4a`: la VA de Alice —Sameno— dice "Mahjong Twelves"). **Al volver a la
  portada** (desde selección o partida) **no hay gate**: los botones ya están y
  `MENU_TRACK` suena de inmediato (crossfade desde el tema de la mesa). El flag de módulo
  `started` en `menu.ts` distingue primera visita de retorno. La **selección de
  personaje** tiene su propio tema exclusivo, **Curious Decisions** (`SELECT_TRACK`,
  fuera de `GAME_TRACKS` como el del menú). Los **29 temas** restantes suenan en partida
  (elección con `Math.random`, jamás con el RNG semillado del core), todos en el mismo
  pool: aunque varios títulos evoquen a un personaje concreto, **no hay temas por
  personaje** (decisión 2026-07-21). **Salir de una
  partida** (botón de abandono del menú in-game o botón de la pantalla de resultados,
  reetiquetado a **MENÚ** / `hud.to-menu`) vuelve a la **portada**, no a la selección de
  personaje (`main.ts`: 3.er arg de `startGame` = `toMenu`).
- **Voces** (**los 12** personajes tienen voz; los raw se nombran por seiyuu, no por
  personaje): **Sameno → Alice**, **Hadou → Dorian**, **Koichi Yashiro → Jekyll**,
  **Yukari → Celestina**, **Takumi → Drácula**, **Sawaro → Macbeth**,
  **Henry → Ahab**, **Aya → Defarge**, **Chiichan → Irene**, **Reiji Kudo → Huck**,
  **Shizuka → Scheherazade**, **Toa Seo → Pinocho** (roster 2026-07-19: Koichi Yashiro
  pasó de Bartleby a Jekyll, Henry de Jekyll a Ahab; Sawaro e Chiichan son nuevos).
  Hideki (Hamlet), Peter (Cyrano) y actores sueltos (Haru, Sakura) quedan sin mapear
  (se saltan con aviso). Solo la voz principal se usa; las
  variantes `_Alt` (si las hay) se procesan pero quedan sin usar. El clip `Sameno_Alice`
  sigue **sin usar** (prototipo de "di tu nombre al elegir personaje", pendiente); el
  pipeline lo salta vía `IGNORE` con aviso. Al asignar/cambiar un actor: mapearlo en
  `ACTORS` (build-audio.mjs) y `VOICED` (catalog.ts).
- **Campanas**: `bell_01` = clic de UI (menú/selección); `bell_02` = alerta de llamada
  en partida (chi/pon/kan/riichi/ron), junto a la voz del personaje.
- **Click de ficha**: aleatorio entre un set de **4 notas según el tema de mesa** (para
  no cansar con el mismo sonido): mesa `wood` → {c2, d2, e2, f2}; el resto → {f2, g2,
  a2, b2}. Sin repetir la última nota sonada.
- **Fuentes** (cambio total 2026-07-17): solo 3 familias — **Lexend** para títulos
  (`--title`: logo, victoria, selección, títulos de modales), **Belanosima** para
  acciones/submenús y el resto de la UI (`--ui`), **Kosugi** para todo el japonés
  (`--jp` y cierre CJK de todos los stacks; cobertura verificada, incluye 發搶槓).
  Retiradas: Murecho, Cormorant Garamond, EB Garamond, Noto Serif JP (antes ya
  Rajdhani y Teko). Los stacks `--display`/`--serif`/`--display-serif` desaparecieron.
  **Belanosima NUNCA en negrita** (regla del usuario): solo existe el face 400,
  ningún texto `--ui` lleva `font-weight` 600/700 y `b, strong { font-weight: 400 }`
  neutraliza la negrita UA. Kosugi solo trae peso 400 (el bold CJK de `--jp` es
  sintético; los pesos sobre Lexend sí se usan); Lexend/Belanosima no traen
  itálica (se eliminó todo `font-style: italic`). Los **números** (contador del
  muro, marcadores de paneles, deltas, puntos de victoria) van en **Lexend Light
  300**. En la selección de personaje los textos pequeños usan Lexend y el nombre
  va **embebido en la tarjeta/marco** (abajo-derecha, degradado como la banda de
  info de los paneles). Logo de portada en dos líneas:
  TWELVES (Lexend Bold) sobre MAHJONG (Belanosima 400, tracking 0.2em), claves i18n
  `menu.title-main`/`menu.title-sub`. El TTF completo de Kosugi (insumo del subset,
  ~2 MB) vive en `raw/font/`, nunca en `public/`.
- **Antique Parlour (A6)**: fondo de salón oscuro + mesa 4:3 (`.tm-board`) con marco de
  madera; **temas de fieltro** (green/red/blue/wood) y **5 dorsos de ficha** seleccionables
  desde el **menú in-game**, aplicados
  vía `[data-table]`/`[data-back]` en `.tm-stage` y persistidos en Settings. Layout portado
  al mockup Figma 1920×1080 (ver Layout). El botón de menú y el reproductor de música son
  pastillas de 24px ancladas al marco de la mesa (bandas superior/inferior, esquina
  derecha); el puesto (1ro/1st/1位, Lexend Bold con sufijo en superíndice) va
  arriba-derecha del retrato y el dealer se marca con la insignia roja 親 junto a la
  insignia de viento (`hud.dealer` en i18n). Pantalla de victoria (1B): mismo diseño,
  reescalada a 1920×1080 (`.tm-win` = caja 1280×720 centrada ×1.5). Único fleco:
  `?debug=board` con coordenadas viejas (página de depuración, no afecta al juego).

## Cut-ins y ritmo de las llamadas (2026-07-21)

Las llamadas ya no se anuncian solo con voz: cada canto abre un **beat** que
**congela el motor** mientras se explica la jugada. El gate vive en
`ui/controller.ts` (`runBeat`/`beatFor`; `scheduleStep()` corta en seco si hay beat
vivo) y las duraciones están en la tabla **`BEAT`**, junto a `DELAY` — es el único
sitio donde se afina el ritmo. Un clic o Enter/Espacio/Escape **salta** el beat
entero; mientras corre, un overlay a pantalla completa atrapa el puntero (además de
permitir el salto, evita descartar una ficha sin querer).

| Canto | Beat |
|---|---|
| chi · pon · kan | viñeta 750 ms |
| riichi | viñeta 750 ms → **destello** de la ficha declarada 550 ms |
| ron · tsumo | viñeta 900 ms → **destape** de la mesa + destello de la ganadora 1400 ms → pantalla de victoria |

Detalles que ya salen del motor: en **ron** la ficha ganadora sigue en el pond del
que descartó (`executeCall` solo la retira en pon/chi/kan), y en **tsumo** la robada
ya se dibuja separada por el hueco. El destello va por `TileId` y **nunca** por
índice del pond: `riichiIndex` no se fija hasta que el descarte se resuelve. La
victoria se anuncia desde `end.winner`, no desde quien actuó (atamahane, y el ron que
resuelve el `pass` de un tercero). En un **chankan** salen los dos cantos, カン y
luego ロン: son dos cantos distintos, no un duplicado.

El destello es una bandera `flash` más en `Placement` (`ui/geometry.ts`), propagada a
`is-flash` en `ui/tile-layer.ts` como `highlight`/`dim`.

### La viñeta (`ui/cut-in.ts`)

Viñeta de cómic **480×240 (2:1)** anclada a la **esquina del asiento que canta**. La
esquina sale de `cornerOf(relSeat(seat, human))` — `core/seat.ts`, único punto de
verdad (trampa 1); aquí no se razona sobre orientación. La forma es un **trapecio en
SVG**, no `clip-path`: un mismo `<path>` hace de recorte y de trazo dorado (con
`border` sobre CSS el borde se engorda de forma desigual en la diagonal, y `polygon()`
no redondea esquinas). Una forma base + dos banderas (`flipX`/`flipY`) dan las cuatro
variantes, con el corte apuntando siempre al centro de la mesa. Constantes con nombre
arriba del módulo: `W`/`H`, `SLANT` (0.34), `RADIUS`, `CUTIN_POS`, `ENTER_DX`.

**El rótulo es HTML sobre el SVG, así que el trapecio NO lo recorta**: el inset de
56 px es lo que mantiene su esquina superior dentro de la diagonal. Bajarlo (o subir
la fuente) saca el texto del marco. Textos en `cutin.<call>` del CSV.

### Arte de los cut-ins — **por tandas** (20/26; faltan celestina, huck y pinocchio)

Enfoque acordado (2026-07-21, tras descartar el cuerpo completo sobre blanco al estilo
Saki Portable, que Midjourney no da bien): **viñeta 2:1 con el rostro en otra
expresión**, al estilo Mahjong Soul. **2 expresiones por personaje** (había una tercera,
`calm`, descartada el mismo día: para chi/pon/kan la cara tensa funciona mejor que una
neutra):

| Expresión | Cantos |
|---|---|
| `sharp` — tensa | `chi`, `pon`, `kan`, `riichi` |
| `fierce` — triunfal | `ron`, `tsumo` |

- **Nomenclatura**: `raw/portraits/{base}_cut_{expr}.png`, donde `{base}` puede ser el
  **slug canónico** (`alice_cut_sharp.png`) **o** la base de `$roster` sin `_portrait`
  (`scheherezade_cut_sharp.png`, con la z del resto de sus archivos). El script prueba
  las dos, así que vale cualquiera — y con `huck` valdrán tanto `huck_` como
  `huckleberry_`. Origen 2:1; 1536×768 va sobrado.
- Son **13, no 12**: `hyde` tiene arte propio (`hyde_cut_{expr}.png`) o el cut-in
  contradice al panel de esquina, que ya lo saca con el riichi vivo. → **26 piezas**.
- `npm run assets:portraits` (`bake-portraits.ps1`) → `public/portraits/{id}-cut-{expr}.jpg`
  a 760 px (~55 KB c/u; 26 ≈ 1,4 MB, al precache solos). **Faltar no es error**: el
  script las salta e imprime al final cuántas van y cuáles faltan. Ojo: **no poda
  huérfanos** (a diferencia del pipeline de audio), así que si se retira una expresión
  hay que borrar su `.jpg` de `public/portraits/` a mano.
- **`HAS_CUT_IN` en `ui/cut-in.ts` es el interruptor**: quien esté ahí usa su viñeta de
  expresión; quien no, cae al retrato 9:16 (`{id}.jpg`, recortado desde arriba). Añadir
  un personaje = soltar sus 3 PNG, relanzar el horneado y meter el id en el set.
  `tests/cutin-assets.test.ts` ata el set al disco: declarar a alguien sin hornear
  rompe el test en vez de dar una imagen rota en mitad de un cut-in.
- Los `*_cut_in.png` que quedan en `raw/portraits/` (alice, irene, scheherezade) son
  del enfoque antiguo de cuerpo completo: **no sirven**.
- **Orientación: TODAS las viñetas se dibujan mirando a la IZQUIERDA.** En las esquinas
  izquierdas (`bl` = el jugador, `tl` = su kami) eso dejaría al personaje mirando fuera
  de la mesa, así que `cut-in.ts` **las espeja** ahí (`transform` sobre la `<image>`, no
  sobre el `<g>`, para no espejar el recorte ni el velo). Consecuencia para el arte: **no
  metas texto, insignias ni nada asimétrico legible** en la viñeta — se verá del revés
  la mitad de las veces. El retrato 9:16 de reserva NO se espeja: su encuadre no se
  dibujó con esta regla.
- Encuadre: el trapecio se come el **34 % de un lado** en diagonal y el rótulo ocupa
  una esquina inferior (inset de 56 px) → la cara conviene centrada-alta, nunca pegada
  a los bordes.

## SEO y metadatos (2026-07-21)

**Origen canónico: `https://twelvesmahjong.com`** (apex, **sin `www`** — ese host no
tiene registro DNS). Aparece en cuatro sitios y `tests/seo-assets.test.ts` verifica que
no se desincronicen: `index.html` (canonical + `og:*`), `public/robots.txt` (línea
`Sitemap:`), `public/sitemap.xml` (`<loc>`) y la constante `ORIGIN` del propio test.
Cambiar de dominio = tocar esos cuatro.

- **`index.html`** lleva title/description, canonical, Open Graph + Twitter card
  (`og:image` **absoluta** a `/og/cover.jpg`: los rastreadores sociales no resuelven
  rutas relativas), iconos, metas de PWA iOS y un **JSON-LD `VideoGame`**. Sin
  `aggregateRating`: no hay reseñas y fabricarlas es motivo de penalización.
- **Bloque `.tm-boot`** dentro de `#app`: el único texto que ve un rastreador que no
  ejecute JS (párrafos en es/en/ja + `<noscript>`), y de paso pantalla de carga con
  marca. **`main.ts` lo borra solo** — `toMenu()` hace `app.innerHTML = ''`; las ramas
  `?debug=` lo limpian explícitamente. Su CSS va **en línea** en el `<head>` (styles.css
  lo inyecta el bundle, así que en dev llegaría tarde) y usa `system-ui`, para que el
  japonés no dependa del subset de Kosugi.
- **`public/404.html`**: página autónoma con `noindex` y rutas **absolutas** (el host la
  sirve para cualquier ruta). Su sola existencia hace que Cloudflare Pages devuelva un
  404 real en vez de `index.html` con 200 (soft-404). Ojo: con el SW instalado el
  `navigateFallback` sigue sirviendo `index.html` — el 404 es para rastreadores y
  primeras visitas.
- **Precache**: `og/**` y `404.html` van en `globIgnores` (nadie los mira offline).

Pendiente del lado del hosting (no es código): CNAME `www` → apex con redirección en
Cloudflare, verificación en Search Console / Bing y envío del sitemap.

## Reglamento configurable (2026-07-22)

`core/rules-config.ts` define el **`RuleSet`** (objeto inmutable, serializable) y
`DEFAULT_RULES`. Viaja **dentro de `HandState.rules`** y llega al `WinContext`; el
núcleo no lee ajustes de ningún global, se los pasan.

| Regla | Dónde se lee |
|---|---|
| `length` (tonpuusen/hanchan) | `game.ts`: `lastKyoku` · `roundWindOf` · `kyokuNumber` |
| `agariYame` | `advanceGame`: el renchan de la última mano cierra si el oya va 1º |
| `tobi` | `advanceGame`: fin por puntos negativos |
| `startPoints` · `returnPoints` · `uma` | `initHand` y `core/results.ts` (`finalResults`) |
| `aka` | `score.ts:doraHits` **y** `ui/tile-view.ts` (sin aka, el 5 rojo se pinta normal) |
| `kuitan` | `yaku.ts`, en la única línea de tanyao |
| `nagashiMangan` | `reducer.ts:endExhaustive` |

- **`WinContext.rules` es OPCIONAL** para no romper los ~30 contextos a mano de
  `score.test.ts`; los lectores hacen `ctx.rules ?? DEFAULT_RULES`. Por eso
  `tests/rules-config.test.ts` incluye un caso **que pasa por el reducer**: un olvido
  en `winContextFor` no daría error de tipos, solo ese test lo pilla.
- **Nagashi mangan**: se detecta con `pond.length === discarded.length` (la ficha
  llamada sale del pond visual pero NO del historial, `executeCall`). Sus pagos
  **sustituyen** a los de tenpai/noten; el renchan del oya se sigue decidiendo por
  tenpai. Va como campo `nagashi: Seat[]` dentro del `HandEnd` de tipo `exhaustive`.
- **uma/oka en unidades de 1000**: `raw = (puntos − returnPoints)/1000`, oka completa
  al 1º, empates por índice de asiento. Los palos de riichi que queden sobre la mesa se
  pierden: la suma de totales puede quedar por debajo de la uma, y es correcto.
- Las reglas se eligen **solo en la portada** (OPCIONES → AJUSTES); el menú in-game no
  las muestra. Se persisten en `Settings.rules` con validación campo a campo. Cambiarlas
  **no** invalida una partida guardada: el guardado lleva su propio `RuleSet`.

## Guardado y estadísticas (2026-07-22)

- **`ui/persist.ts`** (`tm-save-v1`): `{ v, log, roster, botSeed, savedAt }`. `apply()`
  del controlador empuja al log **toda** acción aceptada —bots y `draw` automático
  incluidos— y persiste; si alguna se escapara, el replay divergiría en silencio, y de
  eso protege `tests/replay.test.ts` (round-trip contra `ai/sim.ts`).
  **Cerrar la pestaña no borra nada**; sí lo hacen ABANDONAR, NUEVO JUEGO y el fin de
  partida. `restoreGame` descarta y borra un guardado que no se pueda reproducir.
- **`ui/stats.ts`** (`tm-stats-v1`): acumulador con funciones **puras**
  (`recordAction` / `recordHand` / `recordGame`), enganchadas en `apply()` y `showEnd()`.
  `ui/stats-screen.ts` las pinta clonando el patrón de `glossary.ts`.

## Alcance v1

Partida libre (フリー対局): elegir personaje + 3 rivales, tonpuusen o hanchan,
aka dora, yaku + fu completos, IA por ukeire, pantalla de tsumo/ron. Sin habilidades.
