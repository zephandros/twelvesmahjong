// Elenco de Twelves: personajes literarios como jugadores de mahjong.
// Los retratos se hornean desde raw/portraits con
// scripts/bake-portraits.ps1 → public/portraits/{id}.jpg (+ -t.jpg miniatura).
// Nombre y epíteto visibles viven en i18n/strings.csv (char.<id>.name/.epithet);
// aquí solo quedan los ids canónicos.

import { t } from './i18n'
import { CHARACTER_IDS, type CharacterId } from '../ai/roster'

// El id canónico y el estilo de bot de cada personaje viven en ai/roster.ts: el
// árbitro del multijugador los necesita y no puede importar este módulo, que
// arrastra i18n. Se reexportan para que el resto de la app siga importándolos
// desde aquí, como documenta CLAUDE.md.
export { CHARACTER_STYLES, isCharacterId, type CharacterId } from '../ai/roster'

export interface Character {
  readonly id: CharacterId
}

// Orden canónico del roster (2026-07-19): alimenta la rejilla de selección.
export const CHARACTERS: readonly Character[] = CHARACTER_IDS.map((id) => ({ id }))

/** Nombre mostrado, en el locale activo. Con `alt`, el de la forma alterna. */
export const charName = (c: Character, alt?: AltForm): string => t(`char.${alt?.id ?? c.id}.name`)
/** Epíteto corto para la barra de nombre de la pantalla de victoria. */
export const charEpithet = (c: Character, alt?: AltForm): string =>
  t(`char.${alt?.id ?? c.id}.epithet`)

// Cada personaje tiene cuatro horneados por contexto (bake-portraits.ps1):
/** 9:16 grande — arte de la pantalla de victoria. */
export const portraitUrl = (c: Character): string => `portraits/${c.id}.jpg`
/** 9:16 miniatura — paneles de esquina del tablero. */
export const thumbUrl = (c: Character): string => `portraits/${c.id}-t.jpg`
/** 1:1 — tarjetas de la rejilla de selección. */
export const squareUrl = (c: Character): string => `portraits/${c.id}-sq.jpg`
/** 3:4 — marcos de asiento de la selección. */
export const seatUrl = (c: Character): string => `portraits/${c.id}-seat.jpg`

// --- formas alternas ---
// Jekyll se transforma en Mr. Hyde mientras su riichi está vivo: cambian el arte
// (9:16 y miniatura, horneados por bake-portraits.ps1) y los textos (char.hyde.*).
// Un AltId NO es un CharacterId: no entra en el roster ni en la selección, y por
// eso solo existen los dos horneados que usan el panel y la pantalla de victoria.

/** Slug de una forma alterna (claves i18n char.<id>.name/.epithet). */
export type AltId = 'hyde'

export interface AltForm {
  readonly id: AltId
  readonly portrait: string
  readonly thumb: string
}

const ALT_FORMS: Partial<Record<CharacterId, AltForm>> = {
  jekyll: { id: 'hyde', portrait: 'portraits/hyde.jpg', thumb: 'portraits/hyde-t.jpg' },
}

/** ¿Este personaje tiene forma alterna? (evita trabajo por frame en el HUD) */
export const hasAltForm = (c: Character): boolean => ALT_FORMS[c.id] !== undefined
/** Forma alterna activa, o undefined si muestra su forma base. */
export const altForm = (c: Character, riichi: number): AltForm | undefined =>
  riichi > 0 ? ALT_FORMS[c.id] : undefined

/** Roster de una partida: personaje por asiento (0 = humano). */
export type Roster = readonly [Character, Character, Character, Character]
