// Pipeline de audio: raw/{music,sound_effects,voices} → public/{music,sfx,voices}
//
// Todo a AAC-LC .m4a con loudnorm (hardware decode universal, Safari incluido).
// Requiere ffmpeg en PATH (herramienta de sistema, no devDep):
//   winget install Gyan.FFmpeg
//
// Idempotente: salta lo ya generado salvo --force. Uso: npm run assets:audio
//
// La música PODA: raw/music es la fuente de verdad, así que todo .m4a de
// public/music sin mp3 detrás se borra. Dar de baja un tema = sacar su mp3 de
// raw/music (o moverlo a un subdirectorio, que readdirSync no es recursivo) y
// relanzar. sfx y voces no se podan (sus nombres no vienen del raw 1:1).
//
// Renombrado canónico (la traducción de nombres externos vive AQUÍ, borde del
// sistema — regla de oro de CLAUDE.md):
//  - música:  "Invitation to the Glass Hall.mp3" → invitation-to-the-glass-hall.m4a
//             "Geppetto's Workshop.mp3"          → geppettos-workshop.m4a
//             "..._Alt.mp3"                      → se salta (las variantes alt no
//                                                  se usan en el juego)
//  - sfx:     tile_click_a2.wav                    → tile-click-a2.m4a (nota intacta)
//  - voces:   parser tolerante + TABLA DE ACTORES  → {slug}_{call}.m4a (+ _alt_)
//    Los raw mezclan Alice_Voice_Chii / Alice_Alt_Voice_Chi /
//    Celestina_Voice_Alt_Kan / Henry_Chi / Takumi_Chii. Actor = primer token
//    vía tabla; "Alt" en cualquier posición → variante; call = último token
//    normalizado (Chii→chi). Takumi→dracula, Henry→ahab, Koichi→jekyll (tabla ACTORS).

import { spawnSync } from 'node:child_process'
import { readdirSync, mkdirSync, existsSync, renameSync, rmSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = join(ROOT, 'raw')
const PUB = join(ROOT, 'public')
const FORCE = process.argv.includes('--force')

// --- ffmpeg ------------------------------------------------------------------

function ffmpegOrDie() {
  const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  if (r.error || r.status !== 0) {
    console.error(
      'ffmpeg no está en PATH. Instálalo y reintenta:\n' +
      '  winget install Gyan.FFmpeg\n' +
      '(o una build estática de https://www.gyan.dev/ffmpeg/builds/ en el PATH)',
    )
    process.exit(1)
  }
}

/** Transcodifica src→dst con los filtros dados. Aborta si ffmpeg falla. */
function encode(src, dst, args) {
  if (existsSync(dst) && !FORCE) {
    console.log(`  · ${dst.slice(PUB.length + 1)} (existe, salto)`)
    return
  }
  // Escribe a un temporal y renombra al éxito: un fallo nunca deja un .m4a
  // corrupto que la comprobación de "existe" saltaría en el siguiente run.
  // -vn descarta carátulas embebidas (los mp3 traen cover art h264/mjpeg que
  // el contenedor m4a rechaza); solo queremos el stream de audio.
  const tmp = `${dst}.tmp.m4a`
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vn', ...args, tmp],
    { encoding: 'utf8' },
  )
  if (r.status !== 0) {
    rmSync(tmp, { force: true })
    console.error(`ffmpeg falló en ${src}\n${r.stderr}`)
    process.exit(1)
  }
  renameSync(tmp, dst)
  console.log(`  ✓ ${dst.slice(PUB.length + 1)}`)
}

// perfiles de codificación
const MUSIC = ['-c:a', 'aac', '-b:a', '128k', '-ac', '2',
  '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-movflags', '+faststart']
const VOICE = ['-c:a', 'aac', '-b:a', '96k', '-ac', '1',
  '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-movflags', '+faststart']
const SFX = ['-c:a', 'aac', '-b:a', '96k', '-ac', '1',
  '-af', 'alimiter=limit=-3dB', '-movflags', '+faststart']

// --- helpers de nombre -------------------------------------------------------

// Los apóstrofos se comen en vez de volverse guion: "Geppetto's Workshop" →
// geppettos-workshop, no geppetto-s-workshop.
const kebab = (s) => s.toLowerCase().replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// --- música ------------------------------------------------------------------

function buildMusic(out) {
  console.log('música:')
  mkdirSync(out, { recursive: true })
  const expected = new Set()
  let alts = 0
  for (const file of readdirSync(join(RAW, 'music')).filter((f) => f.endsWith('.mp3'))) {
    const stem = file.replace(/\.mp3$/, '')
    // Las variantes _Alt no las usa el catálogo: no se hornean (el mp3 sigue en raw).
    if (/_Alt$/i.test(stem)) {
      alts++
      continue
    }
    const name = `${kebab(stem)}.m4a`
    expected.add(name)
    encode(join(RAW, 'music', file), join(out, name), MUSIC)
  }
  if (alts) console.log(`  · ${alts} variante(s) _Alt saltada(s) (sin uso en el juego)`)
  prune(out, expected)
}

/** Borra de `dir` todo .m4a que no esté en `expected` (raw manda). */
function prune(dir, expected) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.m4a'))) {
    if (expected.has(file)) continue
    unlinkSync(join(dir, file))
    console.log(`  ✗ ${file} (huérfano, borrado)`)
  }
}

// --- sfx ---------------------------------------------------------------------

function buildSfx(out) {
  console.log('sfx:')
  mkdirSync(out, { recursive: true })
  const extra = []
  for (const file of readdirSync(join(RAW, 'sound_effects')).filter((f) => f.endsWith('.wav'))) {
    const note = /tile_click_([a-g]\d)/i.exec(file)?.[1]
    if (note) {
      encode(join(RAW, 'sound_effects', file), join(out, `tile-click-${note}.m4a`), SFX)
    } else {
      // sfx nuevo aún sin uso en el juego: se procesa a nombre canónico y se avisa
      const name = kebab(file.replace(/\.wav$/i, ''))
      encode(join(RAW, 'sound_effects', file), join(out, `${name}.m4a`), SFX)
      extra.push(`${name}.m4a`)
    }
  }
  if (extra.length) {
    console.log(`  ⚠ sfx sin usar aún (procesados, por cablear): ${extra.join(', ')}`)
  }
}

// --- voces -------------------------------------------------------------------

// actor (primer token del filename) → slug canónico de personaje.
// Los raw nombran cada clip por su seiyuu, no por el personaje (tabla del usuario).
// Roster 2026-07-19: los 12 personajes tienen VA. koichi (Koichi Yashiro) pasó de
// Bartleby a Jekyll; henry pasó de Jekyll a Ahab; sawaro (Macbeth) y chiichan
// (Irene) son nuevos. hideki (Hamlet), peter (Cyrano) y actores sueltos (haru,
// sakura) quedan en raw/voices sin mapear (se saltan con aviso).
const ACTORS = {
  sameno: 'alice',       // Sameno
  hadou: 'dorian',       // Hadou
  koichi: 'jekyll',      // Koichi Yashiro (antes Bartleby → ahora Jekyll)
  yukari: 'celestina',   // Yukari
  takumi: 'dracula',     // Takumi (voz masculina → Drácula)
  sawaro: 'macbeth',     // Sawaro
  henry: 'ahab',         // Henry (voz masculina; antes Jekyll → ahora Ahab)
  aya: 'defarge',        // Aya
  chiichan: 'irene',     // Chiichan
  reiji: 'huck',         // Reiji Kudo
  shizuka: 'scheherazade', // Shizuka
  toa: 'pinocchio',      // Toa Seo
}
// Clips especiales que NO son voces de llamada (por nombre exacto de archivo,
// sin extensión) → basename de salida en public/voices/.
const SPECIAL = {
  Sameno_Mahjong_Twelves: 'title', // VA de Alice diciendo "Mahjong Twelves" (portada)
}
// Clips a saltar (no son llamadas ni tienen uso aún), por nombre exacto de archivo.
const IGNORE = new Set([
  'Sameno_Alice', // prototipo "di tu nombre al elegir personaje", pendiente
])
const CALLS = { chi: 'chi', chii: 'chi', pon: 'pon', kan: 'kan', riichi: 'riichi', ron: 'ron', tsumo: 'tsumo' }
const CALL_KINDS = ['chi', 'pon', 'kan', 'riichi', 'ron', 'tsumo']

/** "Celestina_Voice_Alt_Kan.mp3" → { slug:'celestina', call:'kan', alt:true } o null si el actor no está mapeado. */
function parseVoice(file) {
  const tokens = file.replace(/\.mp3$/i, '').split('_')
  const actor = tokens[0].toLowerCase()
  const slug = ACTORS[actor]
  if (!slug) return null // actor sin personaje asignado: se salta con aviso
  const alt = tokens.some((t) => /^alt$/i.test(t))
  const call = CALLS[tokens[tokens.length - 1].toLowerCase()]
  if (!call) throw new Error(`llamada desconocida en ${file}`)
  return { slug, call, alt }
}

function buildVoices(out) {
  console.log('voces:')
  mkdirSync(out, { recursive: true })
  const cover = new Map() // slug -> Set(call) de la voz principal
  const skipped = []
  for (const file of readdirSync(join(RAW, 'voices')).filter((f) => f.endsWith('.mp3'))) {
    const stem = file.replace(/\.mp3$/i, '')
    if (SPECIAL[stem]) {
      encode(join(RAW, 'voices', file), join(out, `${SPECIAL[stem]}.m4a`), VOICE)
      continue
    }
    if (IGNORE.has(stem)) {
      skipped.push(file)
      continue
    }
    const parsed = parseVoice(file)
    if (!parsed) {
      skipped.push(file)
      continue
    }
    const { slug, call, alt } = parsed
    const dst = `${slug}${alt ? '_alt' : ''}_${call}.m4a`
    encode(join(RAW, 'voices', file), join(out, dst), VOICE)
    if (!alt) {
      if (!cover.has(slug)) cover.set(slug, new Set())
      cover.get(slug).add(call)
    }
  }
  // verificación: cada actor MAPEADO con las 6 llamadas en su voz principal
  const problems = []
  for (const slug of new Set(Object.values(ACTORS))) {
    const got = cover.get(slug)
    const missing = CALL_KINDS.filter((c) => !got?.has(c))
    if (missing.length) problems.push(`${slug}: faltan ${missing.join(', ')}`)
  }
  if (problems.length) {
    console.error('voces incompletas:\n  ' + problems.join('\n  '))
    process.exit(1)
  }
  console.log(`  cobertura OK: ${[...new Set(Object.values(ACTORS))].join(', ')} × 6 llamadas`)
  if (skipped.length) {
    const actors = [...new Set(skipped.map((f) => f.split('_')[0]))].sort()
    console.log(`  ⚠ ${skipped.length} voces de actores sin mapear (saltadas): ${actors.join(', ')}`)
    console.log('    → asígnalos en ACTORS (script) y VOICED (catalog.ts) cuando decidas su personaje')
  }
}

// --- run ---------------------------------------------------------------------

ffmpegOrDie()
buildMusic(join(PUB, 'music'))
buildSfx(join(PUB, 'sfx'))
buildVoices(join(PUB, 'voices'))
console.log('audio listo.')
