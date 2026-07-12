// PRNG semillado y determinista (mulberry32). Todo el azar del juego pasa por
// aquí: misma semilla → misma partida → replays gratis. Escrito de nuevo para
// este motor (no se reutiliza código de otros juegos).

/** Devuelve un número en [0, 1). */
export type Rng = () => number

export function makeRng(seed: number): Rng {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates in place. Devuelve el mismo array. */
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = arr[i]!
    arr[i] = arr[j]!
    arr[j] = a
  }
  return arr
}
