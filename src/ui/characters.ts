// Elenco de Twelves: personajes literarios como jugadores de mahjong.
// Los retratos se hornean desde raw/portraits con
// scripts/bake-portraits.ps1 → public/portraits/{id}.jpg (+ -t.jpg miniatura).
// Nombre y epíteto visibles viven en i18n/strings.csv (char.<id>.name/.epithet);
// aquí solo quedan los ids canónicos.

import { t } from './i18n'

/** Slug canónico de personaje (id de CHARACTERS). */
export type CharacterId =
  | 'alice' | 'dorian' | 'jekyll' | 'celestina' | 'dracula' | 'macbeth'
  | 'ahab' | 'defarge' | 'irene' | 'huck' | 'scheherazade' | 'pinocchio'

export interface Character {
  readonly id: CharacterId
}

// Orden canónico del roster (2026-07-19): alimenta la rejilla de selección.
export const CHARACTERS: readonly Character[] = [
  { id: 'alice' },
  { id: 'dorian' },
  { id: 'jekyll' },
  { id: 'celestina' },
  { id: 'dracula' },
  { id: 'macbeth' },
  { id: 'ahab' },
  { id: 'defarge' },
  { id: 'irene' },
  { id: 'huck' },
  { id: 'scheherazade' },
  { id: 'pinocchio' },
]

/** Nombre mostrado, en el locale activo. */
export const charName = (c: Character): string => t(`char.${c.id}.name`)
/** Epíteto corto para la barra de nombre de la pantalla de victoria. */
export const charEpithet = (c: Character): string => t(`char.${c.id}.epithet`)

// Cada personaje tiene cuatro horneados por contexto (bake-portraits.ps1):
/** 9:16 grande — arte de la pantalla de victoria. */
export const portraitUrl = (c: Character): string => `portraits/${c.id}.jpg`
/** 9:16 miniatura — paneles de esquina del tablero. */
export const thumbUrl = (c: Character): string => `portraits/${c.id}-t.jpg`
/** 1:1 — tarjetas de la rejilla de selección. */
export const squareUrl = (c: Character): string => `portraits/${c.id}-sq.jpg`
/** 3:4 — marcos de asiento de la selección. */
export const seatUrl = (c: Character): string => `portraits/${c.id}-seat.jpg`

// Retrato alterno de Jekyll: mientras su riichi está vivo se muestra Mr. Hyde
// (decisión de usuario). No es un CharacterId — solo un arte alternativo que
// hornea bake-portraits.ps1 junto al resto.
export const HYDE_PORTRAIT = 'portraits/hyde.jpg'
export const HYDE_THUMB = 'portraits/hyde-t.jpg'

/** Roster de una partida: personaje por asiento (0 = humano). */
export type Roster = readonly [Character, Character, Character, Character]
