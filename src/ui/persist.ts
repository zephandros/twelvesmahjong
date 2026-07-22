// Partida en curso guardada en localStorage. Igual que settings.ts: nunca
// lanza — ante datos corruptos o de otra versión devuelve null y se juega de
// cero. El estado se guarda como LOG DE ACCIONES (ver core/replay.ts), no como
// volcado del estado: es una fracción del tamaño y sobrevive a cambios
// internos de HandState.

import type { GameLog } from '../core/replay'
import { replay } from '../core/replay'
import type { GameState } from '../core/game'
import type { CharacterId } from './characters'

const KEY = 'tm-save-v1'
const VERSION = 1

export interface SavedGame {
  v: number
  log: GameLog
  /** Personaje de cada asiento (0 = humano). */
  roster: CharacterId[]
  /** Semilla del RNG de los bots, para que la partida siga igual de variada. */
  botSeed: number
  savedAt: number
}

/** Guarda la partida en curso. Silencioso si localStorage no está disponible. */
export function saveGame(save: Omit<SavedGame, 'v' | 'savedAt'>): void {
  try {
    const full: SavedGame = { ...save, v: VERSION, savedAt: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(full))
  } catch {
    /* modo privado / cuota: esta partida no se podrá reanudar */
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nada que hacer */
  }
}

/** Lee el guardado y valida su forma (no lo reproduce). null si no sirve. */
export function loadSave(): SavedGame | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<SavedGame>
    if (p.v !== VERSION) return null
    if (!p.log || typeof p.log.seed !== 'number' || !Array.isArray(p.log.hands)) return null
    if (!Array.isArray(p.roster) || p.roster.length !== 4) return null
    if (typeof p.botSeed !== 'number') return null
    return p as SavedGame
  } catch {
    return null
  }
}

export function hasSave(): boolean {
  return loadSave() !== null
}

/**
 * Reproduce el guardado. Devuelve null (y BORRA el guardado) si el log no se
 * puede reproducir: es preferible perder una partida corrupta a dejar un botón
 * CONTINUAR que revienta cada vez que se pulsa.
 */
export function restoreGame(save: SavedGame): GameState | null {
  try {
    const g = replay(save.log)
    return g.finished ? null : g
  } catch {
    clearSave()
    return null
  }
}
