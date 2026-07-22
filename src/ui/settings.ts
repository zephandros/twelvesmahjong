// Ajustes de presentación del jugador, persistidos en localStorage. El núcleo
// del juego NO los toca: son preferencias (volúmenes, tema de mesa, dorso de
// ficha). loadSettings nunca lanza: ante datos corruptos vuelve a DEFAULTS.

import type { Locale } from './i18n'
import type { MatchLength, RuleSet } from '../core/rules-config'
import { DEFAULT_RULES, UMA_PRESETS } from '../core/rules-config'

export type TableTheme = 'green' | 'red' | 'blue' | 'wood'
export type TileBack = 'amber' | 'green' | 'red' | 'blue' | 'charcoal'
export type VolumeChannel = 'master' | 'music' | 'sfx' | 'voices'
/** 'auto' = seguir al navegador en cada arranque (hasta que el usuario elija). */
export type Language = Locale | 'auto'

export interface Settings {
  volumes: Record<VolumeChannel, number> // 0..1
  /** Mute del canal de música (reproductor in-game); no toca volumes.music. */
  musicMuted: boolean
  tableTheme: TableTheme
  tileBack: TileBack
  language: Language
  /** Mostrar la tira de esperas/furiten del humano cuando está tenpai. */
  showWaits: boolean
  /** Reglamento de la PRÓXIMA partida; una en curso conserva el suyo. */
  rules: RuleSet
}

export const DEFAULTS: Settings = {
  volumes: { master: 0.8, music: 0.6, sfx: 0.9, voices: 1 },
  musicMuted: false,
  tableTheme: 'green',
  tileBack: 'amber',
  language: 'auto',
  showWaits: true,
  rules: DEFAULT_RULES,
}

/** Valores admitidos de los ajustes numéricos de reglas (los ofrece el cycler). */
export const START_POINTS: readonly number[] = [25000, 30000]

const KEY = 'tm-settings-v1'
const THEMES: readonly TableTheme[] = ['green', 'red', 'blue', 'wood']
const BACKS: readonly TileBack[] = ['amber', 'green', 'red', 'blue', 'charcoal']
const LANGUAGES: readonly Language[] = ['auto', 'es', 'en', 'ja']

const LENGTHS: readonly MatchLength[] = ['tonpuusen', 'hanchan']

const clamp01 = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback

/**
 * Reglamento guardado, campo a campo. Cualquier valor que no reconozca vuelve
 * al de DEFAULT_RULES: un guardado de una versión con otras reglas no debe
 * poder colar un reglamento imposible al núcleo.
 */
function readRules(raw: unknown): RuleSet {
  const p = (raw ?? {}) as Partial<RuleSet>
  const uma = UMA_PRESETS.find((u) => u.every((v, i) => v === p.uma?.[i]))
  return {
    length: LENGTHS.includes(p.length as MatchLength)
      ? (p.length as MatchLength)
      : DEFAULT_RULES.length,
    startPoints: START_POINTS.includes(p.startPoints as number)
      ? (p.startPoints as number)
      : DEFAULT_RULES.startPoints,
    returnPoints:
      typeof p.returnPoints === 'number' && Number.isFinite(p.returnPoints)
        ? p.returnPoints
        : DEFAULT_RULES.returnPoints,
    uma: uma ?? DEFAULT_RULES.uma,
    aka: bool(p.aka, DEFAULT_RULES.aka),
    kuitan: bool(p.kuitan, DEFAULT_RULES.kuitan),
    nagashiMangan: bool(p.nagashiMangan, DEFAULT_RULES.nagashiMangan),
    agariYame: bool(p.agariYame, DEFAULT_RULES.agariYame),
    tobi: bool(p.tobi, DEFAULT_RULES.tobi),
  }
}

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
      musicMuted: typeof p.musicMuted === 'boolean' ? p.musicMuted : DEFAULTS.musicMuted,
      tableTheme: THEMES.includes(p.tableTheme as TableTheme)
        ? (p.tableTheme as TableTheme)
        : DEFAULTS.tableTheme,
      tileBack: BACKS.includes(p.tileBack as TileBack)
        ? (p.tileBack as TileBack)
        : DEFAULTS.tileBack,
      language: LANGUAGES.includes(p.language as Language)
        ? (p.language as Language)
        : DEFAULTS.language,
      showWaits: typeof p.showWaits === 'boolean' ? p.showWaits : DEFAULTS.showWaits,
      rules: readRules(p.rules),
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
