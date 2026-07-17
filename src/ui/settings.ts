// Ajustes de presentación del jugador, persistidos en localStorage. El núcleo
// del juego NO los toca: son preferencias (volúmenes, tema de mesa, dorso de
// ficha). loadSettings nunca lanza: ante datos corruptos vuelve a DEFAULTS.

import type { Locale } from './i18n'

export type TableTheme = 'green' | 'red' | 'blue' | 'wood'
export type TileBack = 'amber' | 'green' | 'red' | 'blue' | 'charcoal'
export type VolumeChannel = 'master' | 'music' | 'sfx' | 'voices'
/** 'auto' = seguir al navegador en cada arranque (hasta que el usuario elija). */
export type Language = Locale | 'auto'

export interface Settings {
  volumes: Record<VolumeChannel, number> // 0..1
  tableTheme: TableTheme
  tileBack: TileBack
  language: Language
}

export const DEFAULTS: Settings = {
  volumes: { master: 0.8, music: 0.6, sfx: 0.9, voices: 1 },
  tableTheme: 'green',
  tileBack: 'amber',
  language: 'auto',
}

const KEY = 'tm-settings-v1'
const THEMES: readonly TableTheme[] = ['green', 'red', 'blue', 'wood']
const BACKS: readonly TileBack[] = ['amber', 'green', 'red', 'blue', 'charcoal']
const LANGUAGES: readonly Language[] = ['auto', 'es', 'en', 'ja']

const clamp01 = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null

/** Lee y valida los ajustes; rellena huecos con DEFAULTS. Nunca lanza. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(DEFAULTS)
    const p = JSON.parse(raw) as Partial<Settings>
    const v = (p.volumes ?? {}) as Partial<Record<VolumeChannel, number>>
    return {
      volumes: {
        master: clamp01(v.master) ?? DEFAULTS.volumes.master,
        music: clamp01(v.music) ?? DEFAULTS.volumes.music,
        sfx: clamp01(v.sfx) ?? DEFAULTS.volumes.sfx,
        voices: clamp01(v.voices) ?? DEFAULTS.volumes.voices,
      },
      tableTheme: THEMES.includes(p.tableTheme as TableTheme)
        ? (p.tableTheme as TableTheme)
        : DEFAULTS.tableTheme,
      tileBack: BACKS.includes(p.tileBack as TileBack)
        ? (p.tileBack as TileBack)
        : DEFAULTS.tileBack,
      language: LANGUAGES.includes(p.language as Language)
        ? (p.language as Language)
        : DEFAULTS.language,
    }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

/** Fija un volumen en el objeto de ajustes, clampeado a 0..1. */
export function setVolumeSetting(s: Settings, ch: VolumeChannel, v: number): void {
  s.volumes[ch] = Math.min(1, Math.max(0, v))
}

/** Persiste los ajustes. Silencioso si localStorage no está disponible. */
export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* modo privado / cuota: los ajustes valen solo esta sesión */
  }
}
