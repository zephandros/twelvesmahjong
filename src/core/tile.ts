// Modelo de fichas. Índice CANÓNICO — cualquier orden externo se traduce a este,
// en el borde del sistema, nunca aquí dentro. Ver CLAUDE.md.
//
//  Tile34 (0..33):
//   0..8   1m..9m
//   9..17  1p..9p
//  18..26  1s..9s
//  27..30  E, S, W, N          (z1..z4)
//  31..33  haku, hatsu, chun   (z5..z7)
//
//  TileId (0..135): identifica la copia concreta. tile34 = tileId >> 2.
//  Aka dora = las copias 16 / 52 / 88 (el 0.º ejemplar de 5m / 5p / 5s).

export type Tile34 = number // 0..33
export type TileId = number // 0..135

export type Suit = 'm' | 'p' | 's' | 'z'
export const SUITS: readonly Suit[] = ['m', 'p', 's', 'z'] as const

export const TILE34_COUNT = 34
export const TILEID_COUNT = 136

// --- construcción / descomposición de Tile34 -------------------------------

/** Suit + rank (1-based) → Tile34. `z` usa rank 1..7 (E,S,W,N,haku,hatsu,chun). */
export function tile34(suit: Suit, rank: number): Tile34 {
  switch (suit) {
    case 'm': return rank - 1
    case 'p': return 8 + rank
    case 's': return 17 + rank
    case 'z': return 26 + rank
  }
}

export function suitOf(t: Tile34): Suit {
  if (t < 9) return 'm'
  if (t < 18) return 'p'
  if (t < 27) return 's'
  return 'z'
}

/** Rango 1-based dentro del palo. Para 'z' devuelve 1..7. */
export function rankOf(t: Tile34): number {
  if (t < 9) return t + 1
  if (t < 18) return t - 8
  if (t < 27) return t - 17
  return t - 26
}

export const isHonor = (t: Tile34): boolean => t >= 27
export const isWind = (t: Tile34): boolean => t >= 27 && t <= 30
export const isDragon = (t: Tile34): boolean => t >= 31 && t <= 33
/** Terminal (1 o 9) u honor — relevante para yaku y fu. */
export const isTerminalOrHonor = (t: Tile34): boolean => {
  if (isHonor(t)) return true
  const r = rankOf(t)
  return r === 1 || r === 9
}

// --- TileId / aka dora ------------------------------------------------------

export const tile34Of = (id: TileId): Tile34 => id >> 2

/** Las tres copias rojas, por TileId. */
export const AKA_IDS: readonly TileId[] = [16, 52, 88] as const
export const isAka = (id: TileId): boolean =>
  id === 16 || id === 52 || id === 88

/**
 * Ficha que es dora dado su indicador: siguiente del palo con ciclo 9→1,
 * vientos E→S→W→N→E, dragones haku→hatsu→chun→haku.
 */
export function doraFromIndicator(indicator: Tile34): Tile34 {
  if (indicator < 27) {
    const base = Math.floor(indicator / 9) * 9
    return base + ((indicator - base + 1) % 9)
  }
  if (indicator <= 30) return 27 + ((indicator - 27 + 1) % 4)
  return 31 + ((indicator - 31 + 1) % 3)
}

// --- notación / etiquetas ---------------------------------------------------

/** Etiqueta corta de un Tile34: "1m", "5p", "E", "haku"… (sin distinguir aka). */
export function label34(t: Tile34): string {
  const suit = suitOf(t)
  if (suit !== 'z') return `${rankOf(t)}${suit}`
  return (['E', 'S', 'W', 'N', 'haku', 'hatsu', 'chun'] as const)[rankOf(t) - 1]!
}

/** Etiqueta corta de un TileId, con "0m/0p/0s" para las rojas. */
export function labelId(id: TileId): string {
  if (isAka(id)) {
    const suit = suitOf(tile34Of(id))
    return `0${suit}`
  }
  return label34(tile34Of(id))
}

/** Parsea "1m", "0p" (aka), "z1", "E" → Tile34. Útil para tests y datos. */
export function parseTile(s: string): Tile34 {
  const named: Record<string, Tile34> = {
    E: 27, S: 28, W: 29, N: 30, haku: 31, hatsu: 32, chun: 33,
  }
  if (s in named) return named[s]!
  const m = /^([0-9])([mpsz])$/.exec(s)
  if (!m) throw new Error(`ficha inválida: ${s}`)
  const rank = Number(m[1])
  const suit = m[2] as Suit
  if (suit === 'z') {
    if (rank < 1 || rank > 7) throw new Error(`honor inválido: ${s}`)
    return tile34('z', rank)
  }
  // '0' = aka, cuenta como el 5 del palo a efectos de Tile34.
  return tile34(suit, rank === 0 ? 5 : rank)
}

/**
 * Parsea notación de mano compacta: "123m055p1199s12z" → Tile34[].
 * Dígitos acumulados hasta la letra de palo; '0' = aka (cuenta como 5).
 */
export function parseHand(notation: string): Tile34[] {
  const out: Tile34[] = []
  let digits = ''
  for (const ch of notation) {
    if (ch >= '0' && ch <= '9') {
      digits += ch
    } else if (ch === 'm' || ch === 'p' || ch === 's' || ch === 'z') {
      if (!digits) throw new Error(`palo sin dígitos en: ${notation}`)
      for (const d of digits) out.push(parseTile(`${d}${ch}`))
      digits = ''
    } else if (!/\s/.test(ch)) {
      throw new Error(`carácter inválido '${ch}' en: ${notation}`)
    }
  }
  if (digits) throw new Error(`dígitos sin palo al final de: ${notation}`)
  return out
}
