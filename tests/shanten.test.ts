import { describe, it, expect } from 'vitest'
import { parseHand } from '../src/core/tile'
import { countsOf, shanten, shantenChiitoi, shantenKokushi } from '../src/core/shanten'
import { ukeire, discardOptions } from '../src/core/ukeire'
import { makeRng, type Rng } from '../src/core/rng'

const sh = (hand: string, melds = 0) => shanten(countsOf(parseHand(hand)), melds)

// ============================================================================
// Verificador INDEPENDIENTE de mano completa (estructura distinta al motor):
// referencia para validar shanten == -1 y la exactitud de 0 y 1.
// ============================================================================

/** ¿14 fichas forman mano estándar (4 grupos + par), chiitoi o kokushi? */
function refIsAgari(counts: readonly number[]): boolean {
  return refStandard(counts) || refChiitoi(counts) || refKokushi(counts)
}

function refStandard(counts: readonly number[]): boolean {
  for (let p = 0; p < 34; p++) {
    if (counts[p]! >= 2) {
      const c = counts.slice()
      c[p]! -= 2
      if (refAllSets(c, 0)) return true
    }
  }
  return false
}

function refAllSets(c: number[], i: number): boolean {
  while (i < 34 && c[i] === 0) i++
  if (i === 34) return true
  if (c[i]! >= 3) {
    c[i]! -= 3
    if (refAllSets(c, i)) { c[i]! += 3; return true }
    c[i]! += 3
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1]! > 0 && c[i + 2]! > 0) {
    c[i]!--; c[i + 1]!--; c[i + 2]!--
    if (refAllSets(c, i)) { c[i]!++; c[i + 1]!++; c[i + 2]!++; return true }
    c[i]!++; c[i + 1]!++; c[i + 2]!++
  }
  return false
}

function refChiitoi(counts: readonly number[]): boolean {
  let pairs = 0
  for (const n of counts) {
    if (n === 2) pairs++
    else if (n !== 0) return false
  }
  return pairs === 7
}

const TH = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]
function refKokushi(counts: readonly number[]): boolean {
  let kinds = 0
  let hasPair = false
  let total = 0
  for (let t = 0; t < 34; t++) {
    const n = counts[t]!
    total += n
    if (n > 0 && !TH.includes(t)) return false
    if (n > 0) kinds++
    if (n >= 2) hasPair = true
  }
  return total === 14 && kinds === 13 && hasPair
}

/** ¿13 fichas en tenpai? (∃ robo que completa) — solo referencia de test. */
function refIsTenpai(counts: readonly number[]): boolean {
  const c = counts.slice()
  for (let t = 0; t < 34; t++) {
    if (c[t]! >= 4) continue
    c[t]!++
    if (refIsAgari(c)) { c[t]!--; return true }
    c[t]!--
  }
  return false
}

// --- generadores aleatorios (semillados: deterministas) ----------------------

/** Mano completa aleatoria (counts de 14): par + 4 grupos. */
function randomWinningCounts(rng: Rng): number[] {
  for (;;) {
    const c = new Array<number>(34).fill(0)
    c[Math.floor(rng() * 34)]! += 2
    for (let b = 0; b < 4; b++) {
      if (rng() < 0.55) {
        const suit = Math.floor(rng() * 3)
        const start = suit * 9 + Math.floor(rng() * 7)
        c[start]!++; c[start + 1]!++; c[start + 2]!++
      } else {
        c[Math.floor(rng() * 34)]! += 3
      }
    }
    if (c.every((n) => n <= 4)) return c
  }
}

/** Aplica k intercambios aleatorios (quita una ficha presente, añade otra). */
function mutate(counts: readonly number[], k: number, rng: Rng): number[] {
  const c = counts.slice()
  for (let i = 0; i < k; i++) {
    let out: number
    do out = Math.floor(rng() * 34)
    while (c[out]! === 0)
    let inn: number
    do inn = Math.floor(rng() * 34)
    while (c[inn]! >= 4)
    c[out]!--
    c[inn]!++
  }
  return c
}

// ============================================================================
// Tests
// ============================================================================

describe('shanten: vectores conocidos', () => {
  it('manos completas → -1', () => {
    expect(sh('123456789m12344p')).toBe(-1)
    expect(sh('111222333m44455p')).toBe(-1)
    expect(sh('1199m3377p5588s22z')).toBe(-1) // chiitoi
    expect(sh('19m19p19s12345677z')).toBe(-1) // kokushi
  })

  it('tenpai → 0', () => {
    expect(sh('123456789m1234p')).toBe(0) // tanki/nobetan en pinzu
    expect(sh('123456789m1122p')).toBe(0) // shanpon
    expect(sh('1112345678999m')).toBe(0) // chuuren: espera 9 lados
    expect(sh('1199m3377p5588s2z')).toBe(0) // chiitoi tenpai
    expect(sh('19m19p19s1234567z')).toBe(0) // kokushi 13 lados
  })

  it('1 y 2 shanten estándar', () => {
    expect(sh('123456789m1245p')).toBe(1) // 3 grupos + 2 taatsu sin par
    expect(sh('123456789m147p1s')).toBe(2) // 3 grupos + 4 flotantes
  })

  it('mano dispersa: gana chiitoi (6) a kokushi (7) y estándar (8)', () => {
    const c = countsOf(parseHand('147m258p369s1234z'))
    expect(shantenChiitoi(c)).toBe(6)
    expect(shantenKokushi(c)).toBe(7)
    expect(shanten(c)).toBe(6)
  })

  it('chiitoi: un cuarteto no cuenta como dos pares', () => {
    // 4×1m + 5 pares + 0 → pares útiles 6, tipos 6 → 6-6+1 = 1
    expect(shantenChiitoi(countsOf(parseHand('11113399m1177p55s')))).toBe(1)
  })

  it('manos abiertas (melds > 0): solo forma estándar', () => {
    expect(sh('1145p', 3)).toBe(0) // par + taatsu: tenpai
    expect(sh('1122p', 3)).toBe(0) // shanpon
    expect(sh('55m', 4)).toBe(-1) // 4 llamadas + par = completa
    expect(sh('1478p', 3)).toBe(1) // un taatsu (78p), sin par
  })

  it('valida el tamaño de la mano', () => {
    expect(() => sh('123m')).toThrow(/fichas/)
    expect(() => sh('123456789m12344p', 1)).toThrow(/fichas/)
  })
})

describe('shanten: validación contra verificador independiente', () => {
  it('shanten == -1 ⇔ mano completa (300 manos, ganadoras y mutadas)', () => {
    const rng = makeRng(2024)
    for (let i = 0; i < 300; i++) {
      const k = i % 4 // 0..3 mutaciones
      const c = mutate(randomWinningCounts(rng), k, rng)
      const s = shanten(c)
      expect(s === -1).toBe(refIsAgari(c))
    }
  })

  it('k mutaciones desde mano completa → shanten ≤ k−1 (1-Lipschitz)', () => {
    // cada intercambio cambia el shanten a lo sumo en 1; partimos de -1
    const rng = makeRng(777)
    for (let i = 0; i < 200; i++) {
      const k = 1 + (i % 3)
      const c14 = mutate(randomWinningCounts(rng), k, rng)
      expect(shanten(c14)).toBeLessThanOrEqual(k - 1)
    }
  })

  it('exactitud de shanten 0: coincide con tenpai de referencia (200 manos de 13)', () => {
    const rng = makeRng(31337)
    let checked0 = 0
    for (let i = 0; i < 200; i++) {
      const c14 = mutate(randomWinningCounts(rng), 1 + (i % 3), rng)
      // pasar a 13 quitando la primera ficha presente
      const c = c14.slice()
      c[c.findIndex((n) => n > 0)]!--
      const s = shanten(c)
      expect(s === 0).toBe(refIsTenpai(c)) // 13 fichas nunca dan -1
      if (s === 0) checked0++
    }
    expect(checked0).toBeGreaterThan(10) // el muestreo cubrió el caso
  })

  it('exactitud de shanten 1: no tenpai pero ∃ intercambio → tenpai (60 casos)', () => {
    const rng = makeRng(555)
    let checked = 0
    for (let i = 0; i < 200 && checked < 60; i++) {
      const c14 = mutate(randomWinningCounts(rng), 1 + (i % 2), rng)
      const c = c14.slice()
      c[c.findIndex((n) => n > 0)]!--
      if (shanten(c) !== 1) continue
      checked++
      expect(refIsTenpai(c)).toBe(false)
      // existe un intercambio (descarte+robo) que deja tenpai
      let found = false
      outer: for (let out = 0; out < 34; out++) {
        if (c[out]! === 0) continue
        for (let inn = 0; inn < 34; inn++) {
          if (inn === out || c[inn]! >= 4) continue
          c[out]!--; c[inn]!++
          const t = refIsTenpai(c)
          c[out]!++; c[inn]!--
          if (t) { found = true; break outer }
        }
      }
      expect(found).toBe(true)
    }
    expect(checked).toBe(60)
  })
})

describe('ukeire', () => {
  it('cada ficha aceptada baja el shanten exactamente 1; el resto no lo cambia', () => {
    const hands = ['123456789m1245p', '1199m3377p5588s2z', '19m19p19s1234567z', '2357m2357p2357s1z']
    for (const hand of hands) {
      const c = countsOf(parseHand(hand))
      const u = ukeire(c)
      const accepted = new Set(u.accepts.map((a) => a.tile))
      for (let t = 0; t < 34; t++) {
        if (c[t]! >= 4) continue
        const c2 = c.slice()
        c2[t]!++
        const s2 = shanten(c2)
        if (accepted.has(t)) expect(s2).toBe(u.shanten - 1)
        else expect(s2).toBe(u.shanten)
      }
    }
  })

  it('el total respeta las copias restantes', () => {
    const c = countsOf(parseHand('123456789m1234p'))
    const u = ukeire(c)
    for (const a of u.accepts) {
      expect(a.count).toBe(4 - c[a.tile]!)
      expect(a.count).toBeGreaterThan(0)
    }
    expect(u.total).toBe(u.accepts.reduce((s, a) => s + a.count, 0))
  })

  it('kokushi 13 lados acepta exactamente los 13 huérfanos', () => {
    const u = ukeire(countsOf(parseHand('19m19p19s1234567z')))
    expect(u.shanten).toBe(0)
    expect(u.accepts.map((a) => a.tile).sort((x, y) => x - y)).toEqual(TH)
  })

  it('discardOptions ordena por shanten y luego por ukeire', () => {
    const c = countsOf(parseHand('123456789m12345p')) // 14 fichas
    const opts = discardOptions(c)
    for (let i = 1; i < opts.length; i++) {
      const a = opts[i - 1]!.after
      const b = opts[i]!.after
      expect(a.shanten < b.shanten || (a.shanten === b.shanten && a.total >= b.total)).toBe(true)
    }
    // descartar 1p o 5p mantiene tenpai (nobetan 2345p)
    expect(opts[0]!.after.shanten).toBe(0)
  })
})

describe('descenso codicioso: shanten inicial + 1 robos útiles ⇒ mano completa', () => {
  it('20 manos aleatorias llegan a agari con exactamente s+1 mejoras', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = makeRng(seed * 7919)
      // mano inicial: 13 fichas al azar respetando 4 copias
      const c = new Array<number>(34).fill(0)
      for (let n = 0; n < 13; n++) {
        let t: number
        do t = Math.floor(rng() * 34)
        while (c[t]! >= 4)
        c[t]!++
      }
      let s = shanten(c)
      const s0 = s
      let steps = 0
      while (s >= 0) {
        const u = ukeire(c)
        expect(u.shanten).toBe(s)
        expect(u.total).toBeGreaterThan(0) // siempre hay progreso posible
        const draw = u.accepts[0]!.tile
        c[draw]!++
        if (shanten(c) === -1) { steps++; break }
        const best = discardOptions(c)[0]!
        c[best.discard]!--
        s = best.after.shanten
        expect(s).toBe(u.shanten - 1) // el mejor descarte conserva la mejora
        steps++
      }
      expect(steps).toBe(s0 + 1)
    }
  })
})
