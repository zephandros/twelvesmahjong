// Elenco de Twelves: personajes literarios como jugadores de mahjong.
// Los retratos se hornean desde Resources/Portraits con
// scripts/bake-portraits.ps1 → public/portraits/{id}.jpg (+ -t.jpg miniatura).

export interface Character {
  readonly id: string
  readonly name: string
  /** Epíteto corto para la barra de nombre de la pantalla de victoria. */
  readonly epithet: string
}

/** Slug canónico de personaje (id de CHARACTERS). */
export type CharacterId =
  | 'alice' | 'bartleby' | 'cyrano' | 'scheherazade' | 'dorian' | 'jekyll'
  | 'dracula' | 'hamlet' | 'huck' | 'celestina' | 'defarge' | 'pinocchio'

export const CHARACTERS: readonly Character[] = [
  { id: 'alice', name: 'Alice', epithet: 'Wonderland' },
  { id: 'bartleby', name: 'Bartleby', epithet: 'El escribiente' },
  { id: 'cyrano', name: 'Cyrano', epithet: 'Bergerac' },
  { id: 'scheherazade', name: 'Scheherazade', epithet: 'Mil y una noches' },
  { id: 'dorian', name: 'Dorian', epithet: 'El retrato' },
  { id: 'jekyll', name: 'Jekyll', epithet: 'Dos caras' },
  { id: 'dracula', name: 'Drácula', epithet: 'Nosferatu' },
  { id: 'hamlet', name: 'Hamlet', epithet: 'Dinamarca' },
  { id: 'huck', name: 'Huck', epithet: 'El Mississippi' },
  { id: 'celestina', name: 'Celestina', epithet: 'La alcahueta' },
  { id: 'defarge', name: 'Mme. Defarge', epithet: 'La tejedora' },
  { id: 'pinocchio', name: 'Pinocho', epithet: 'Sin hilos' },
]

export const portraitUrl = (c: Character): string => `portraits/${c.id}.jpg`
export const thumbUrl = (c: Character): string => `portraits/${c.id}-t.jpg`

/** Roster de una partida: personaje por asiento (0 = humano). */
export type Roster = readonly [Character, Character, Character, Character]
