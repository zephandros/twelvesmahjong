// Catálogo de audio: nombres canónicos y URLs de public/{music,sfx,voices}.
// Escrito a mano (set fijo y pequeño; nada de manifiestos fetch-eados en
// runtime). tests/audio-assets.test.ts ata cada URL a un archivo real →
// catálogo y pipeline (scripts/build-audio.mjs) no pueden divergir en silencio.

import type { CharacterId } from '../characters'

// --- música ------------------------------------------------------------------

/** Tema exclusivo del menú principal (decisión de usuario). */
export const MENU_TRACK = 'invitation-to-the-glass-hall'

/** Tema exclusivo de la pantalla de selección de personaje. */
export const SELECT_TRACK = 'curious-decisions'

/** Los temas de partida (elección con Math.random, NUNCA con el RNG del core). */
export const GAME_TRACKS: readonly string[] = [
  'velvet-matchmaker',
  'whispered-favors',
  'velvet-fault-line',
  'two-reflections',
  'beautiful-decay',
  'paper-lantern-parade',
  'rabbit-hole-rondo',
  'teacup-tide',
  'paper-koi-parade',
  'candlelit-nocturne',
  'celesta-street-parade',
  'court-of-cards',
  'downriver-drift',
  'geppettos-workshop',
  'list-in-glass',
  'march-of-ashes',
  'music-box-boulevard',
  'needle-name',
  'puppet-steps',
  'qanun-moonline',
  'raftside-sunday',
  'red-queen-carousel',
  'string-of-pine',
  'strings-attached',
  'thanes-descent',
  'the-womans-wink',
  'thousandth-night',
  'velvet-coffin-tango',
  'velvet-parlour',
]

export const musicUrl = (track: string): string => `music/${track}.m4a`

/**
 * Títulos legibles de cada tema (nombres propios en inglés; no pasan por i18n).
 * El reproductor in-game los muestra; el test de assets exige que cubran
 * exactamente MENU_TRACK + SELECT_TRACK + GAME_TRACKS.
 */
export const MUSIC_TITLES: Readonly<Record<string, string>> = {
  'invitation-to-the-glass-hall': 'Invitation to the Glass Hall',
  'curious-decisions': 'Curious Decisions',
  'velvet-matchmaker': 'Velvet Matchmaker',
  'whispered-favors': 'Whispered Favors',
  'velvet-fault-line': 'Velvet Fault Line',
  'two-reflections': 'Two Reflections',
  'beautiful-decay': 'Beautiful Decay',
  'paper-lantern-parade': 'Paper Lantern Parade',
  'rabbit-hole-rondo': 'Rabbit Hole Rondo',
  'teacup-tide': 'Teacup Tide',
  'paper-koi-parade': 'Paper Koi Parade',
  'candlelit-nocturne': 'Candlelit Nocturne',
  'celesta-street-parade': 'Celesta Street Parade',
  'court-of-cards': 'Court of Cards',
  'downriver-drift': 'Downriver Drift',
  'geppettos-workshop': "Geppetto's Workshop",
  'list-in-glass': 'List in Glass',
  'march-of-ashes': 'March of Ashes',
  'music-box-boulevard': 'Music-Box Boulevard',
  'needle-name': 'Needle & Name',
  'puppet-steps': 'Puppet Steps',
  'qanun-moonline': 'Qanun Moonline',
  'raftside-sunday': 'Raftside Sunday',
  'red-queen-carousel': 'Red Queen Carousel',
  'string-of-pine': 'String of Pine',
  'strings-attached': 'Strings Attached',
  'thanes-descent': "Thane's Descent",
  'the-womans-wink': "The Woman's Wink",
  'thousandth-night': 'Thousandth Night',
  'velvet-coffin-tango': 'Velvet Coffin Tango',
  'velvet-parlour': 'Velvet Parlour',
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
 * build-audio.mjs). Roster 2026-07-19: los 12 tienen VA. Solo la voz principal
 * se usa; las variantes _alt, si existieran, se publican pero no se usan.
 */
export const VOICED: ReadonlySet<CharacterId> = new Set<CharacterId>([
  'alice', 'dorian', 'jekyll', 'celestina', 'dracula', 'macbeth',
  'ahab', 'defarge', 'irene', 'huck', 'scheherazade', 'pinocchio',
])

export const voiceUrl = (slug: CharacterId, call: CallKind): string =>
  `voices/${slug}_${call}.m4a`

/** Clip de portada: la VA de Alice diciendo "Mahjong Twelves". Suena en el menú. */
export const TITLE_VOICE_URL = 'voices/title.m4a'
