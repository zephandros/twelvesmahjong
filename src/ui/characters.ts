// Elenco de Twelves: personajes literarios como jugadores de mahjong.
// Los retratos se hornean desde Resources/Portraits con
// scripts/bake-portraits.ps1 → public/portraits/{id}.jpg (+ -t.jpg miniatura).
// Nombre y epíteto visibles viven en i18n/strings.csv (char.<id>.name/.epithet);
// aquí solo quedan los ids canónicos.

import { t } from './i18n'

/** Slug canónico de personaje (id de CHARACTERS). */
export type CharacterId =
  | 'alice' | 'bartleby' | 'cyrano' | 'scheherazade' | 'dorian' | 'jekyll'
  | 'dracula' | 'hamlet' | 'huck' | 'celestina' | 'defarge' | 'pinocchio'

export interface Character {
  readonly id: CharacterId
}

export const CHARACTERS: readonly Character[] = [
  { id: 'alice' },
  { id: 'bartleby' },
  { id: 'cyrano' },
  { id: 'scheherazade' },
  { id: 'dorian' },
  { id: 'jekyll' },
  { id: 'dracula' },
  { id: 'hamlet' },
  { id: 'huck' },
  { id: 'celestina' },
  { id: 'defarge' },
  { id: 'pinocchio' },
]

/** Nombre mostrado, en el locale activo. */
export const charName = (c: Character): string => t(`char.${c.id}.name`)
/** Epíteto corto para la barra de nombre de la pantalla de victoria. */
export const charEpithet = (c: Character): string => t(`char.${c.id}.epithet`)

export const portraitUrl = (c: Character): string => `portraits/${c.id}.jpg`
export const thumbUrl = (c: Character): string => `portraits/${c.id}-t.jpg`

/** Roster de una partida: personaje por asiento (0 = humano). */
export type Roster = readonly [Character, Character, Character, Character]
