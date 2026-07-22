// Reglamento de una partida. Es un objeto inmutable que viaja dentro de
// HandState y llega al WinContext: el núcleo no lee ajustes de ningún sitio
// global, se los pasan. Serializable a JSON (va dentro del guardado).
//
// Uma y oka se expresan en UNIDADES DE 1000 (los "puntos de tabla" con los que
// se anuncia un resultado: +30.0 / −15.5), no en puntos de mesa.

/** Duración: ronda de Este (4 oya) o Este + Sur (8 oya). */
export type MatchLength = 'tonpuusen' | 'hanchan'

export interface RuleSet {
  readonly length: MatchLength
  /** Puntos con los que arranca cada asiento. */
  readonly startPoints: number
  /** Puntos de retorno; la oka del 1º es (returnPoints − startPoints)·4. */
  readonly returnPoints: number
  /** Bonificación por puesto (1º..4º), en unidades de 1000. */
  readonly uma: readonly [number, number, number, number]
  /** Los cincos rojos cuentan como dora (y se pintan rojos). */
  readonly aka: boolean
  /** Tanyao con la mano abierta. */
  readonly kuitan: boolean
  /** Mangan por descartar solo terminales/honores sin que nadie llame. */
  readonly nagashiMangan: boolean
  /** El oya que gana (o queda tenpai) la última mano yendo 1º cierra la partida. */
  readonly agariYame: boolean
  /** La partida acaba si alguien baja de 0 puntos. */
  readonly tobi: boolean
}

/** Presets de uma del cycler de ajustes (el primero = sin uma). */
export const UMA_PRESETS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 0, 0],
  [15, 5, -5, -15],
  [20, 10, -10, -20],
  [30, 10, -10, -30],
]

/** Reglamento por defecto: tonpuusen estilo Tenhou. */
export const DEFAULT_RULES: RuleSet = Object.freeze({
  length: 'tonpuusen',
  startPoints: 25000,
  returnPoints: 30000,
  uma: UMA_PRESETS[1]!,
  aka: true,
  kuitan: true,
  nagashiMangan: true,
  agariYame: true,
  tobi: true,
} as const)
