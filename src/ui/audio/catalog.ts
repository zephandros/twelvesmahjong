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

export const sfxClickUrl = (note: ClickNote): string => `sfx/tile-click-${note}.m4a`

// --- voces -------------------------------------------------------------------

export type CallKind = 'chi' | 'pon' | 'kan' | 'riichi' | 'ron' | 'tsumo'

/**
 * Personajes con voz grabada. El resto quedan mudos. Takumi→dracula y
 * Henry→jekyll (decisión de usuario; el mapeo de actores vive en el pipeline).
 * Solo la voz principal se usa; las variantes _alt se publican pero no se usan.
 */
export const VOICED: ReadonlySet<CharacterId> = new Set<CharacterId>([
  'alice', 'celestina', 'defarge', 'dracula', 'jekyll',
])

export const voiceUrl = (slug: CharacterId, call: CallKind): string =>
  `voices/${slug}_${call}.m4a`
