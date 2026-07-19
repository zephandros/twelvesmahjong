// Catálogo de audio: nombres canónicos y URLs de public/{music,sfx,voices}.
// Escrito a mano (set fijo y pequeño; nada de manifiestos fetch-eados en
// runtime). tests/audio-assets.test.ts ata cada URL a un archivo real →
// catálogo y pipeline (scripts/build-audio.mjs) no pueden divergir en silencio.

import type { CharacterId } from '../characters'

// --- música ------------------------------------------------------------------

/** Tema exclusivo del menú principal (decisión de usuario). */
export const MENU_TRACK = 'invitation-to-the-glass-hall'

/** Los 8 temas de partida (elección con Math.random, NUNCA con el RNG del core). */
export const GAME_TRACKS: readonly string[] = [
  'aristocratic-hunger',
  'bathroom-decadence',
  'bathroom-wonder',
  'ceremonial-silence',
  'clockwork-silence',
  'clockwork-waltz',
  'the-royal-shuffle',
  'tiled-room-echoes',
]

export const musicUrl = (track: string): string => `music/${track}.m4a`

/**
 * Títulos legibles de cada tema (nombres propios en inglés; no pasan por i18n).
 * El reproductor in-game los muestra; el test de assets exige que cubran
 * exactamente MENU_TRACK + GAME_TRACKS.
 */
export const MUSIC_TITLES: Readonly<Record<string, string>> = {
  'invitation-to-the-glass-hall': 'Invitation to the Glass Hall',
  'aristocratic-hunger': 'Aristocratic Hunger',
  'bathroom-decadence': 'Bathroom Decadence',
  'bathroom-wonder': 'Bathroom Wonder',
  'ceremonial-silence': 'Ceremonial Silence',
  'clockwork-silence': 'Clockwork Silence',
  'clockwork-waltz': 'Clockwork Waltz',
  'the-royal-shuffle': 'The Royal Shuffle',
  'tiled-room-echoes': 'Tiled Room Echoes',
}

// --- sfx (click de ficha) ----------------------------------------------------

/** Las 7 notas del click; el subset que suena depende del tema de mesa. */
export type ClickNote = 'a2' | 'b2' | 'c2' | 'd2' | 'e2' | 'f2' | 'g2'

/**
 * Sets de click por tema de mesa (decisión de usuario, para no cansar con el
 * mismo sonido). Mesa `wood` usa notas graves; el resto, agudas. El runtime
 * elige aleatoria entre las 4 sin repetir la última.
 */
export const CLICK_NOTES: Record<string, readonly ClickNote[]> = {
  wood: ['c2', 'd2', 'e2', 'f2'],
  default: ['f2', 'g2', 'a2', 'b2'],
}

/** Notas de click para un tema de mesa (fallback al set por defecto). */
export const clickNotesFor = (theme: string): readonly ClickNote[] =>
  CLICK_NOTES[theme] ?? CLICK_NOTES['default']!

export const sfxClickUrl = (note: ClickNote): string => `sfx/tile-click-${note}.m4a`

/** Campana de clic de UI (menú/selección). */
export const UI_CLICK_URL = 'sfx/bell-01.m4a'
/** Campana de alerta de llamada en partida (chi/pon/kan/riichi/ron). */
export const ALERT_URL = 'sfx/bell-02.m4a'

// --- voces -------------------------------------------------------------------

export type CallKind = 'chi' | 'pon' | 'kan' | 'riichi' | 'ron' | 'tsumo'

/**
 * Personajes con voz grabada (el mapeo actor→personaje vive en el pipeline,
 * build-audio.mjs). irene, macbeth y ahab (roster 2026-07-19) aún no tienen VA:
 * quedan mudos hasta que lleguen sus voces. Solo la voz principal se usa; las
 * variantes _alt, si existieran, se publican pero no se usan.
 */
export const VOICED: ReadonlySet<CharacterId> = new Set<CharacterId>([
  'alice', 'scheherazade', 'dorian', 'jekyll', 'dracula',
  'huck', 'celestina', 'defarge', 'pinocchio',
])

export const voiceUrl = (slug: CharacterId, call: CallKind): string =>
  `voices/${slug}_${call}.m4a`

/** Clip de portada: la VA de Alice diciendo "Mahjong Twelves". Suena en el menú. */
export const TITLE_VOICE_URL = 'voices/title.m4a'
