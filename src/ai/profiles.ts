// Perfiles de bot: DOS EJES ORTOGONALES —estilo × habilidad— que se resuelven en
// un `BotBehavior` (los knobs concretos que consulta ai/bot.ts al decidir). No hay
// nada atado a un personaje aquí: es una biblioteca de comportamientos reutilizable
// (los 12 del elenco hoy; los minions/jefes del story mode mañana). Módulo puro,
// sin dependencias (ni de core/): estilo fija tendencias, habilidad limita capacidad.
//
// REGLA DE ORO: resolveBehavior({ style: 'balanced', skill: 'expert' }) reproduce
// EXACTAMENTE la política "seria" histórica (fold ≥2-shanten, ukeire cerca de tenpai,
// defensa suji, riichi siempre, pon yakuhai/mano-abierta, sin ruido). Así el bot por
// defecto no cambia y los tests existentes siguen verdes.

/** Estilo de juego: la "identidad" del bot, independiente de su nivel. */
export type StyleId =
  | 'balanced' | 'attacker' | 'defender' | 'speedster' | 'purist' | 'chaotic'

/** Nivel de competencia (la dificultad global lo fija para los rivales). */
export type SkillId = 'novice' | 'intermediate' | 'expert'

/** Un bot = un estilo con un nivel. Inmutable y serializable. */
export interface BotProfile {
  readonly style: StyleId
  readonly skill: SkillId
}

/** El bot por defecto: el jugador experto equilibrado de siempre. */
export const DEFAULT_PROFILE: BotProfile = Object.freeze({
  style: 'balanced',
  skill: 'expert',
})

/** Sofisticación defensiva: sin defensa < solo genbutsu < genbutsu+suji. */
export type Defense = 'none' | 'genbutsu' | 'suji'
/** Apetito de llamadas: nunca < solo yakuhai < mejora (histórico) < ávido. */
export type CallPolicy = 'never' | 'yakuhai' | 'improve' | 'greedy'
/** Al llegar a tenpai cerrado: declara riichi o se queda damaten. */
export type RiichiPolicy = 'always' | 'damaten'

/** Knobs concretos que bot.ts lee al decidir. Resueltos de estilo × habilidad. */
export interface BotBehavior {
  /** Desempatar descartes por ukeire real cerca de tenpai (si no, centralidad). */
  readonly useUkeire: boolean
  /** Hasta dónde sabe leer la seguridad al doblarse. */
  readonly defense: Defense
  /** Se dobla bajo amenaza cuando el shanten propio ≥ esto (Infinity = nunca). */
  readonly foldFromShanten: number
  readonly callPolicy: CallPolicy
  readonly riichiPolicy: RiichiPolicy
  /** Prob. [0,1] de elegir un descarte al azar entre los de mínimo shanten. */
  readonly noise: number
}

// --- tendencias por estilo -----------------------------------------------------------

interface StyleTraits {
  foldFromShanten: number
  wantDefense: Defense
  callPolicy: CallPolicy
  riichiPolicy: RiichiPolicy
  noiseAdd: number
}

const STYLE_TRAITS: Record<StyleId, StyleTraits> = {
  // el equilibrado = comportamiento histórico exacto
  balanced: { foldFromShanten: 2, wantDefense: 'suji', callPolicy: 'improve', riichiPolicy: 'always', noiseAdd: 0 },
  // empuja: no se dobla jamás y llama para acelerar
  attacker: { foldFromShanten: Infinity, wantDefense: 'suji', callPolicy: 'improve', riichiPolicy: 'always', noiseAdd: 0 },
  // cauto: se dobla pronto, calla la mano (damaten) y solo llama yakuhai
  defender: { foldFromShanten: 1, wantDefense: 'suji', callPolicy: 'yakuhai', riichiPolicy: 'damaten', noiseAdd: 0 },
  // velocidad: llama de todo para tenpai rápido, riichi siempre
  speedster: { foldFromShanten: 3, wantDefense: 'suji', callPolicy: 'greedy', riichiPolicy: 'always', noiseAdd: 0 },
  // purista: mano cerrada, nunca llama; busca riichi/menzen
  purist: { foldFromShanten: 2, wantDefense: 'suji', callPolicy: 'never', riichiPolicy: 'always', noiseAdd: 0 },
  // impredecible: llama mucho y mete ruido en los descartes
  chaotic: { foldFromShanten: 3, wantDefense: 'suji', callPolicy: 'greedy', riichiPolicy: 'always', noiseAdd: 0.15 },
}

// --- techos por habilidad ------------------------------------------------------------

interface SkillCaps {
  useUkeire: boolean
  defenseCap: Defense
  noiseBase: number
}

const SKILL_CAPS: Record<SkillId, SkillCaps> = {
  novice: { useUkeire: false, defenseCap: 'none', noiseBase: 0.25 },
  intermediate: { useUkeire: true, defenseCap: 'genbutsu', noiseBase: 0.06 },
  expert: { useUkeire: true, defenseCap: 'suji', noiseBase: 0 },
}

const DEF_ORDER: Record<Defense, number> = { none: 0, genbutsu: 1, suji: 2 }
const minDefense = (a: Defense, b: Defense): Defense =>
  DEF_ORDER[a] <= DEF_ORDER[b] ? a : b

/** Combina estilo (tendencias) y habilidad (techos) en knobs concretos. */
export function resolveBehavior(p: BotProfile): BotBehavior {
  const s = STYLE_TRAITS[p.style]
  const k = SKILL_CAPS[p.skill]
  // la habilidad capa la sofisticación defensiva que el estilo querría tener
  const defense = minDefense(s.wantDefense, k.defenseCap)
  // sin capacidad defensiva (novato) no se dobla, sea cual sea el estilo
  const foldFromShanten = defense === 'none' ? Infinity : s.foldFromShanten
  return {
    useUkeire: k.useUkeire,
    defense,
    foldFromShanten,
    callPolicy: s.callPolicy,
    riichiPolicy: s.riichiPolicy,
    noise: Math.min(1, k.noiseBase + s.noiseAdd),
  }
}

/** Comportamiento del bot por defecto (candado: debe igualar la política histórica). */
export const DEFAULT_BEHAVIOR: BotBehavior = resolveBehavior(DEFAULT_PROFILE)
