// Cálculo de shanten: nº mínimo de intercambios (robo+descarte) hasta tenpai.
// -1 = mano completa, 0 = tenpai. Cubre forma estándar (4 grupos + par),
// chiitoitsu y kokushi; el shanten de la mano es el mínimo de las tres.
//
// Estándar: búsqueda exhaustiva de descomposiciones en grupos (tríos/corridas)
// y bloques parciales (pares/taatsu), maximizando  valor = 2·grupos + parciales
// + par;  shanten = 2·gruposNecesarios − valor. Con llamadas (melds) abiertas,
// gruposNecesarios = 4 − melds y solo aplica la forma estándar.
//
// Memoizado: ukeire lo invoca ~34 veces por descarte candidato.

import type { Tile34 } from './tile'

/** Conteo por tipo: array de 34 con 0..4 copias. */
export function countsOf(tiles: readonly Tile34[]): number[] {
  const c = new Array<number>(34).fill(0)
  for (const t of tiles) {
    if (t < 0 || t > 33) throw new Error(`Tile34 fuera de rango: ${t}`)
    c[t]!++
  }
  return c
}

// --- forma estándar ----------------------------------------------------------

/** Máx de 2·grupos + parciales(capado) + par, sobre todas las descomposiciones. */
function bestValue(c: number[], needSets: number): number {
  let best = 0

  const dfs = (start: number, sets: number, taatsu: number, pairs: number): void => {
    let i = start
    while (i < 34 && c[i] === 0) i++

    if (i === 34) {
      const hasPair = pairs > 0 ? 1 : 0
      // pares extra sirven como taatsu (candidatos a trío)
      const partials = Math.min(taatsu + Math.max(0, pairs - 1), needSets - sets)
      const value = 2 * sets + partials + hasPair
      if (value > best) best = value
      return
    }

    const canRun = i < 27
    const r = i % 9 // 0-based dentro del palo

    if (sets < needSets) {
      // trío
      if (c[i]! >= 3) {
        c[i]! -= 3
        dfs(i, sets + 1, taatsu, pairs)
        c[i]! += 3
      }
      // corrida i, i+1, i+2
      if (canRun && r <= 6 && c[i + 1]! > 0 && c[i + 2]! > 0) {
        c[i]!--; c[i + 1]!--; c[i + 2]!--
        dfs(i, sets + 1, taatsu, pairs)
        c[i]!++; c[i + 1]!++; c[i + 2]!++
      }
    }
    // par (como EL par o como candidato a trío)
    if (c[i]! >= 2) {
      c[i]! -= 2
      dfs(i, sets, taatsu, pairs + 1)
      c[i]! += 2
    }
    // taatsu adyacente (ryanmen/penchan) y con hueco (kanchan)
    if (canRun && sets + taatsu < needSets) {
      if (r <= 7 && c[i + 1]! > 0) {
        c[i]!--; c[i + 1]!--
        dfs(i, sets, taatsu + 1, pairs)
        c[i]!++; c[i + 1]!++
      }
      if (r <= 6 && c[i + 2]! > 0) {
        c[i]!--; c[i + 2]!--
        dfs(i, sets, taatsu + 1, pairs)
        c[i]!++; c[i + 2]!++
      }
    }
    // dejar las copias restantes de i como flotantes
    dfs(i + 1, sets, taatsu, pairs)
  }

  dfs(0, 0, 0, 0)
  return best
}

const memo = new Map<string, number>()
const MEMO_LIMIT = 200_000

/** Shanten de forma estándar. `melds` = grupos ya llamados (abiertos/kan). */
export function shantenStandard(counts: readonly number[], melds = 0): number {
  const needSets = 4 - melds
  const key = counts.join('') + needSets
  const hit = memo.get(key)
  if (hit !== undefined) return hit

  const s = needSets * 2 - bestValue(counts.slice(), needSets)
  if (memo.size >= MEMO_LIMIT) memo.clear()
  memo.set(key, s)
  return s
}

// --- chiitoitsu ---------------------------------------------------------------

/** 7 pares distintos. Solo mano cerrada. Un cuarteto no da dos pares. */
export function shantenChiitoi(counts: readonly number[]): number {
  let pairs = 0
  let kinds = 0
  for (const n of counts) {
    if (n > 0) kinds++
    if (n >= 2) pairs++
  }
  return 6 - pairs + Math.max(0, 7 - kinds)
}

// --- kokushi ------------------------------------------------------------------

const TERMINALS_HONORS: readonly Tile34[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]

/** 13 huérfanos + par de uno de ellos. Solo mano cerrada. */
export function shantenKokushi(counts: readonly number[]): number {
  let kinds = 0
  let hasPair = false
  for (const t of TERMINALS_HONORS) {
    const n = counts[t]!
    if (n > 0) kinds++
    if (n >= 2) hasPair = true
  }
  return 13 - kinds - (hasPair ? 1 : 0)
}

// --- combinado -----------------------------------------------------------------

/**
 * Shanten de la mano: mínimo de las tres formas (chiitoi/kokushi solo si la
 * mano está cerrada). `counts` debe sumar 13−3·melds o 14−3·melds fichas.
 */
export function shanten(counts: readonly number[], melds = 0): number {
  if (counts.length !== 34) throw new Error('counts debe tener 34 posiciones')
  let sum = 0
  for (const n of counts) {
    if (n < 0 || n > 4) throw new Error(`conteo inválido: ${n}`)
    sum += n
  }
  const total = sum + 3 * melds
  if (total !== 13 && total !== 14) {
    throw new Error(`mano de ${sum} fichas con ${melds} melds (total ${total})`)
  }

  let s = shantenStandard(counts, melds)
  if (melds === 0) {
    s = Math.min(s, shantenChiitoi(counts), shantenKokushi(counts))
  }
  return s
}

/** Conveniencia: shanten directamente desde una lista de fichas. */
export function shantenOfTiles(tiles: readonly Tile34[], melds = 0): number {
  return shanten(countsOf(tiles), melds)
}
