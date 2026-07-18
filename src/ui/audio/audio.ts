// Runtime de audio: música de fondo (streaming + crossfade), efectos de click
// y voces de personaje. Híbrido por latencia:
//  - sfx/voces: Web Audio (decodeAudioData + AudioBufferSourceNode).
//  - música:   HTMLAudioElement + MediaElementSource (streaming, sin cargar
//              MB en RAM), dos players para crossfade.
// Autoplay: nada suena hasta el primer gesto (unlockAudio, disparado en main.ts);
// una pista pedida antes del gesto queda en cola. Al sonar una voz, la música
// hace ducking. Selección de pista/click con Math.random — NUNCA el RNG del core.

import { DEFAULTS, type Settings, type VolumeChannel } from '../settings'
import type { CharacterId } from '../characters'
import {
  musicUrl, sfxClickUrl, clickNotesFor, voiceUrl, TITLE_VOICE_URL,
  UI_CLICK_URL, ALERT_URL, CLICK_NOTES, VOICED, type ClickNote, type CallKind,
} from './catalog'

const MUSIC_FADE_MS = 1500
const DUCK_LEVEL = 0.35

// --- estado del módulo (singleton) -------------------------------------------

let ctx: AudioContext | null = null
let master: GainNode
let musicGain: GainNode
let musicDuck: GainNode
let sfxGain: GainNode
let voicesGain: GainNode

let settings: Settings = structuredClone(DEFAULTS)
let unlocked = false // ha habido un gesto del usuario
let pendingMusic: string | null = null
let pendingStinger: { fn: () => void; afterMs: number } | null = null
let currentTrack: string | null = null
let currentVoice: AudioBufferSourceNode | null = null
let lastClickNote: ClickNote | null = null
let stingerTimer: ReturnType<typeof setTimeout> | null = null

const buffers = new Map<string, Promise<AudioBuffer>>()

interface MusicPlayer {
  el: HTMLAudioElement
  fade: GainNode
}
let players: [MusicPlayer, MusicPlayer] | null = null
let active = 0
let musicPaused = false

// Oyentes del reproductor: se avisa al cambiar pista, pausa o mute.
const musicListeners = new Set<() => void>()
function notifyMusic(): void {
  for (const cb of musicListeners) cb()
}

// --- inicialización ----------------------------------------------------------

/** Crea el grafo (una vez) y aplica los volúmenes. Idempotente. */
export function initAudio(s: Settings): void {
  settings = s
  if (ctx) {
    applyVolumes()
    return
  }
  ctx = new AudioContext()
  master = ctx.createGain()
  master.connect(ctx.destination)
  musicGain = ctx.createGain()
  musicGain.connect(master)
  musicDuck = ctx.createGain() // 1.0 normal; baja a DUCK_LEVEL con las voces
  musicDuck.connect(musicGain)
  sfxGain = ctx.createGain()
  sfxGain.connect(master)
  voicesGain = ctx.createGain()
  voicesGain.connect(master)
  players = [makePlayer(), makePlayer()]
  applyVolumes()

  // precarga los sfx pequeños (clicks + campanas), ya precacheados por el SW
  for (const note of new Set(Object.values(CLICK_NOTES).flat())) {
    void loadBuffer(sfxClickUrl(note))
  }
  void loadBuffer(UI_CLICK_URL)
  void loadBuffer(ALERT_URL)
  // si ya hubo un gesto, arranca lo que estuviera en cola
  if (unlocked) resumeAndFlush()
}

function makePlayer(): MusicPlayer {
  const el = new Audio()
  el.loop = true
  el.preload = 'auto'
  const src = ctx!.createMediaElementSource(el)
  const fade = ctx!.createGain()
  fade.gain.value = 0
  src.connect(fade)
  fade.connect(musicDuck)
  return { el, fade }
}

// Los sliders guardan su posición 0..1 en Settings; la ganancia real sigue una
// curva perceptual (Weber-Fechner): con copia lineal, el tramo 0-20% da saltos
// bruscos y el 80-100% apenas se nota. x² ≈ 40 dB de rango útil y gain(0)=0
// exacto. Solo aplica a los canales de usuario; ducking y fades son relativos.
const VOLUME_CURVE = 2
function perceptualGain(x: number): number {
  return Math.pow(x, VOLUME_CURVE)
}

function applyVolumes(): void {
  if (!ctx) return
  master.gain.value = perceptualGain(settings.volumes.master)
  musicGain.gain.value = settings.musicMuted ? 0 : perceptualGain(settings.volumes.music)
  sfxGain.gain.value = perceptualGain(settings.volumes.sfx)
  voicesGain.gain.value = perceptualGain(settings.volumes.voices)
}

// --- desbloqueo de autoplay --------------------------------------------------

/** Marca que hubo un gesto del usuario; arranca la música en cola. */
export function unlockAudio(): void {
  unlocked = true
  if (ctx) resumeAndFlush()
}

/** ¿El contexto está sonando ya? (main.ts deja de escuchar gestos cuando sí). */
export function audioRunning(): boolean {
  return ctx?.state === 'running'
}

function resumeAndFlush(): void {
  if (!ctx) return
  void ctx.resume()
  if (pendingMusic) {
    const t = pendingMusic
    const st = pendingStinger
    pendingMusic = null
    pendingStinger = null
    playMusic(t, st ? { stinger: st.fn, stingerAfterMs: st.afterMs } : undefined)
  }
}

// --- música ------------------------------------------------------------------

/**
 * Reproduce una pista con crossfade. `stinger` (con `stingerAfterMs`) es un
 * one-shot ligado a ESTA pista: se dispara cuando la música empieza de verdad
 * y se cancela si la pista cambia o se para antes (lo usa el menú para el clip
 * de portada a los 1.5 s). Si el track ya está en cola pre-gesto, el stinger
 * viaja con él y se agenda al desbloquear.
 */
export function playMusic(
  track: string,
  opts?: { crossfadeMs?: number; stinger?: () => void; stingerAfterMs?: number },
): void {
  if (!ctx || !players) return
  if (track === currentTrack) return
  clearStinger()
  if (!unlocked) {
    pendingMusic = track
    pendingStinger = opts?.stinger
      ? { fn: opts.stinger, afterMs: opts.stingerAfterMs ?? 0 }
      : null
    notifyMusic()
    return
  }
  const fadeMs = opts?.crossfadeMs ?? MUSIC_FADE_MS
  currentTrack = track
  musicPaused = false

  const outgoing = players[active]!
  active = 1 - active
  const incoming = players[active]!

  fadeOut(outgoing, fadeMs)
  incoming.el.src = musicUrl(track)
  incoming.el.currentTime = 0
  rampGain(incoming.fade.gain, 0, 0)
  void incoming.el
    .play()
    .then(() => {
      rampGain(incoming.fade.gain, 1, fadeMs)
      if (opts?.stinger) {
        stingerTimer = setTimeout(opts.stinger, opts.stingerAfterMs ?? 0)
      }
    })
    .catch(() => {
      /* autoplay rechazado: quedará a la espera del próximo gesto */
    })
  notifyMusic()
}

export function stopMusic(fadeMs = 800): void {
  currentTrack = null
  pendingMusic = null
  pendingStinger = null
  musicPaused = false
  clearStinger()
  if (players) for (const p of players) fadeOut(p, fadeMs)
  notifyMusic()
}

/** Pista que suena (o encolada pre-gesto), para el reproductor in-game. */
export function getCurrentTrack(): string | null {
  return currentTrack ?? pendingMusic
}

/**
 * Pausa/reanuda la pista actual (congela el HTMLAudioElement activo; el punto
 * de reproducción se conserva). Un playMusic posterior — p. ej. siguiente /
 * anterior — arranca sonando. Devuelve el nuevo estado de pausa.
 */
export function toggleMusicPause(): boolean {
  if (players && currentTrack) {
    const el = players[active]!.el
    if (musicPaused) void el.play()
    else el.pause()
    musicPaused = !musicPaused
    notifyMusic()
  }
  return musicPaused
}

export function isMusicPaused(): boolean {
  return musicPaused
}

/** Mute del canal de música sin pisar settings.volumes.music. */
export function setMusicMuted(muted: boolean): void {
  settings.musicMuted = muted
  applyVolumes()
  notifyMusic()
}

/**
 * Suscribe un oyente a los cambios del reproductor (pista/pausa/mute).
 * Devuelve la función de baja.
 */
export function onMusicChange(cb: () => void): () => void {
  musicListeners.add(cb)
  return () => musicListeners.delete(cb)
}

function clearStinger(): void {
  if (stingerTimer !== null) {
    clearTimeout(stingerTimer)
    stingerTimer = null
  }
}

function fadeOut(p: MusicPlayer, ms: number): void {
  if (!p.el.src) return
  rampGain(p.fade.gain, 0, ms)
  const el = p.el
  window.setTimeout(() => {
    try {
      el.pause()
    } catch {
      /* noop */
    }
  }, ms + 60)
}

// --- efectos de click --------------------------------------------------------

export function playSfx(name: 'tile-click'): void {
  if (!ctx || name !== 'tile-click') return
  const set = clickNotesFor(settings.tableTheme)
  // aleatorio entre las 4 notas del tema, sin repetir la última (menos fatiga)
  const pool = set.length > 1 && lastClickNote ? set.filter((n) => n !== lastClickNote) : set
  if (pool.length === 0) return
  const note = pool[Math.floor(Math.random() * pool.length)]!
  lastClickNote = note
  void oneShot(sfxClickUrl(note), sfxGain)
}

/** Campana de clic de UI (menú/selección). */
export function playUiClick(): void {
  if (!ctx) return
  void oneShot(UI_CLICK_URL, sfxGain)
}

/** Campana de alerta de llamada en partida (chi/pon/kan/riichi/ron). */
export function playAlert(): void {
  if (!ctx) return
  void oneShot(ALERT_URL, sfxGain)
}

// --- voces -------------------------------------------------------------------

/** Voz de llamada del personaje. No-op si el personaje es mudo (no VOICED). */
export function playVoice(slug: CharacterId, call: CallKind): void {
  if (!VOICED.has(slug)) return
  playVoiceUrl(voiceUrl(slug, call))
}

/** Clip de portada ("Mahjong Twelves") sobre la música del menú. */
export function playTitle(): void {
  playVoiceUrl(TITLE_VOICE_URL)
}

/** Reproduce una voz por el canal de voces: una a la vez, con ducking. */
function playVoiceUrl(url: string): void {
  if (!ctx) return
  void (async () => {
    const src = await oneShot(url, voicesGain)
    if (!src) return
    // una voz a la vez: corta la anterior
    if (currentVoice && currentVoice !== src) {
      try {
        currentVoice.stop()
      } catch {
        /* ya terminada */
      }
    }
    duck()
    currentVoice = src
    src.onended = () => {
      if (src === currentVoice) {
        currentVoice = null
        unduck()
      }
    }
  })()
}

function duck(): void {
  if (musicDuck) rampGain(musicDuck.gain, DUCK_LEVEL, 80)
}
function unduck(): void {
  if (musicDuck) rampGain(musicDuck.gain, 1, 400)
}

// --- volúmenes ---------------------------------------------------------------

export function setVolume(ch: VolumeChannel, v: number): void {
  settings.volumes[ch] = Math.min(1, Math.max(0, v))
  applyVolumes()
}

// --- helpers -----------------------------------------------------------------

async function oneShot(url: string, out: GainNode): Promise<AudioBufferSourceNode | null> {
  if (!ctx) return null
  let buf: AudioBuffer
  try {
    buf = await loadBuffer(url)
  } catch {
    return null
  }
  if (!ctx) return null
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(out)
  src.start()
  return src
}

function loadBuffer(url: string): Promise<AudioBuffer> {
  let p = buffers.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((a) => ctx!.decodeAudioData(a))
    p.catch(() => buffers.delete(url)) // permite reintento si falla
    buffers.set(url, p)
  }
  return p
}

function rampGain(g: AudioParam, target: number, ms: number): void {
  if (!ctx) return
  const now = ctx.currentTime
  g.cancelScheduledValues(now)
  g.setValueAtTime(g.value, now)
  if (ms <= 0) g.setValueAtTime(target, now)
  else g.linearRampToValueAtTime(target, now + ms / 1000)
}
