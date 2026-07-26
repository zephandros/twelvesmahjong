// Identidad de bot de cada personaje: los ids canónicos y el estilo que juega
// cada uno. Vive en ai/ y NO en ui/ porque el árbitro del multijugador (el
// Durable Object del Worker) necesita esta tabla y no puede importar ui/, que
// arrastra i18n y localStorage.
//
// `ui/characters.ts` reexporta ambas cosas, así que para el resto de la app
// nada ha cambiado de sitio.

import type { StyleId } from './profiles'

/** Slug canónico de personaje (id de CHARACTERS). */
export type CharacterId =
  | 'alice' | 'dorian' | 'jekyll' | 'celestina' | 'dracula' | 'macbeth'
  | 'ahab' | 'defarge' | 'irene' | 'huck' | 'scheherazade' | 'pinocchio'

// Estilo de juego de cada personaje (su "identidad" como bot). Es CONFIG, no lógica:
// el reparto se edita aquí libremente. La habilidad NO va aquí —la fija la dificultad
// global de los rivales (Settings.difficulty); el story mode dará a los minions/jefes
// su propio perfil (estilo + habilidad) sin pasar por esta tabla. `Record` exhaustivo:
// olvidar un personaje es error de tipos, sin test extra.
export const CHARACTER_STYLES: Record<CharacterId, StyleId> = {
  alice: 'balanced', // curiosa, sin sesgo
  dorian: 'attacker', // vanidoso, empuja
  jekyll: 'chaotic', // doble naturaleza (Hyde)
  celestina: 'defender', // intrigante, cauta
  dracula: 'attacker', // depredador
  macbeth: 'chaotic', // ambición que se desboca
  ahab: 'attacker', // persecución obsesiva
  defarge: 'defender', // venganza paciente
  irene: 'speedster', // aguda, eficiente
  huck: 'speedster', // improvisador ágil
  scheherazade: 'purist', // teje valor sin prisa (mano cerrada)
  pinocchio: 'chaotic', // errático
}

/** Orden canónico del roster (2026-07-19): alimenta la rejilla de selección. */
export const CHARACTER_IDS: readonly CharacterId[] = [
  'alice', 'dorian', 'jekyll', 'celestina', 'dracula', 'macbeth',
  'ahab', 'defarge', 'irene', 'huck', 'scheherazade', 'pinocchio',
]

export function isCharacterId(s: unknown): s is CharacterId {
  return typeof s === 'string' && (CHARACTER_IDS as readonly string[]).includes(s)
}
