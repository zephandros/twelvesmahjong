import { describe, it, expect } from 'vitest'
import type { TileId } from '../src/core/tile'
import { parseTile } from '../src/core/tile'
import type { Meld, MeldKind } from '../src/core/meld'
import type { WinContext } from '../src/core/win'
import { scoreWin, basePoints, limitOf } from '../src/core/score'
import { makeRng, type Rng } from '../src/core/rng'

// ============================================================================
// Helpers: construcción de contextos con TileIds (con aka: '0m'/'0p'/'0s')
// ============================================================================

const AKA_TYPES = new Set([4, 13, 22])

/** Notación → TileIds. '0x' = la copia aka; el resto evita las copias aka. */
function handIds(notation: string): TileId[] {
  const out: TileId[] = []
  const next: Record<number, number> = {}
  let digits = ''
  for (const ch of notation) {
    if (ch >= '0' && ch <= '9') { digits += ch; continue }
    for (const d of digits) {
      if (d === '0') {
        out.push(parseTile(`0${ch}`) << 2) // copia 0 = aka
      } else {
        const t = parseTile(`${d}${ch}`)
        const k = next[t] ?? (AKA_TYPES.has(t) ? 1 : 0)
        if (k > 3) throw new Error(`más de 4 copias de ${d}${ch}`)
        out.push((t << 2) | k)
        next[t] = k + 1
      }
    }
    digits = ''
  }
  return out
}

const meld = (kind: MeldKind, s: string): Meld => ({ kind, tiles: handIds(s) })

interface CtxOpts {
  concealed: string
  win: string
  melds?: Meld[]
  tsumo?: boolean
  dealer?: boolean
  seat?: string
  round?: string
  riichi?: 0 | 1 | 2
  ippatsu?: boolean
  dora?: string[]
  ura?: string[]
  honba?: number
  sticks?: number
  haitei?: boolean
  houtei?: boolean
  rinshan?: boolean
  chankan?: boolean
  tenhou?: boolean
  chiihou?: boolean
}

function ctx(o: CtxOpts): WinContext {
  const dealer = o.dealer ?? false
  return {
    concealed: handIds(o.concealed),
    winTile: handIds(o.win)[0]!,
    melds: o.melds ?? [],
    tsumo: o.tsumo ?? false,
    dealer,
    seatWind: parseTile(o.seat ?? (dealer ? '1z' : '2z')),
    roundWind: parseTile(o.round ?? '1z'),
    riichi: o.riichi ?? 0,
    ippatsu: o.ippatsu ?? false,
    doraIndicators: (o.dora ?? []).map((s) => handIds(s)[0]!),
    uraIndicators: (o.ura ?? []).map((s) => handIds(s)[0]!),
    honba: o.honba ?? 0,
    riichiSticks: o.sticks ?? 0,
    haitei: o.haitei ?? false,
    houtei: o.houtei ?? false,
    rinshan: o.rinshan ?? false,
    chankan: o.chankan ?? false,
    tenhou: o.tenhou ?? false,
    chiihou: o.chiihou ?? false,
  }
}

const yakuIds = (r: NonNullable<ReturnType<typeof scoreWin>>) => r.yaku.map((y) => y.id).sort()

// ============================================================================
// Vectores (calculados a mano, componente a componente)
// ============================================================================

describe('score: vectores de puntuación', () => {
  it('pinfu tsumo no-oya: 2 han 20 fu → 400/700 (total 1500)', () => {
    const r = scoreWin(ctx({ concealed: '123m567m23444p56s', win: '7s', tsumo: true }))!
    expect(yakuIds(r)).toEqual(['pinfu', 'tsumo'])
    expect(r.han).toBe(2)
    expect(r.fu).toBe(20)
    expect(r.fromDealer).toBe(700)
    expect(r.fromEach).toBe(400)
    expect(r.total).toBe(1500)
  })

  it('chiitoi ron no-oya: 2 han 25 fu → 1600', () => {
    const r = scoreWin(ctx({ concealed: '1199m3377p558s22z', win: '8s' }))!
    expect(yakuIds(r)).toEqual(['chiitoi'])
    expect(r.fu).toBe(25)
    expect(r.ron).toBe(1600)
  })

  it('yakuhai chun abierto, ron: 1 han 30 fu → 1000', () => {
    const r = scoreWin(
      ctx({ concealed: '234m567p2388s', win: '4s', melds: [meld('pon', '777z')] }),
    )!
    expect(yakuIds(r)).toEqual(['yakuhai-chun'])
    expect(r.han).toBe(1)
    expect(r.fu).toBe(30) // 20 + trío abierto de honor 4 = 24 → 30
    expect(r.ron).toBe(1000)
  })

  it('toitoi + sanankou + honroutou por ron: 6 han 60 fu, haneman 12000', () => {
    const r = scoreWin(ctx({ concealed: '111999m11199p11z', win: '9p' }))!
    expect(yakuIds(r)).toEqual(['honroutou', 'sanankou', 'toitoi'])
    expect(r.han).toBe(6)
    // 20 +10 menzen-ron +8+8+8 (ankou TH) +4 (trío TH abierto por ron) +2 (par E ronda)
    expect(r.fu).toBe(60)
    expect(r.limit).toBe('haneman')
    expect(r.ron).toBe(12000)
    expect(r.yaku.some((y) => y.id === 'chanta')).toBe(false)
  })

  it('la misma mano por tsumo es suuankou: yakuman 32000', () => {
    const r = scoreWin(ctx({ concealed: '111999m11199p11z', win: '9p', tsumo: true }))!
    expect(yakuIds(r)).toEqual(['suuankou'])
    expect(r.yakuman).toBe(1)
    expect(r.limit).toBe('yakuman')
    expect(r.fromDealer).toBe(16000)
    expect(r.fromEach).toBe(8000)
    expect(r.total).toBe(32000)
  })

  it('suuankou de oya por tsumo: 16000 de cada uno (48000)', () => {
    const r = scoreWin(
      ctx({ concealed: '111999m11199p11z', win: '9p', tsumo: true, dealer: true }),
    )!
    expect(r.fromEach).toBe(16000)
    expect(r.total).toBe(48000)
  })

  it('kokushi por ron no-oya: yakuman 32000', () => {
    const r = scoreWin(ctx({ concealed: '19m19p19s1234567z', win: '1m' }))!
    expect(yakuIds(r)).toEqual(['kokushi'])
    expect(r.yakuman).toBe(1)
    expect(r.ron).toBe(32000)
  })

  it('riichi + ippatsu + tsumo + pinfu: 4 han 20 fu → 1300/2600 (5200)', () => {
    const r = scoreWin(
      ctx({ concealed: '123m567m23444p56s', win: '7s', tsumo: true, riichi: 1, ippatsu: true }),
    )!
    expect(yakuIds(r)).toEqual(['ippatsu', 'pinfu', 'riichi', 'tsumo'])
    expect(r.han).toBe(4)
    expect(r.total).toBe(5200)
  })

  it('…y con un ura dora pasa a mangan 8000', () => {
    const r = scoreWin(
      ctx({
        concealed: '123m567m23444p56s', win: '7s', tsumo: true,
        riichi: 1, ippatsu: true, ura: ['4s'], // indicador 4s → ura = 5s (hay 1)
      }),
    )!
    expect(r.han).toBe(5)
    expect(r.limit).toBe('mangan')
    expect(r.total).toBe(8000)
  })

  it('el ura no cuenta sin riichi', () => {
    const r = scoreWin(
      ctx({ concealed: '123m567m23444p56s', win: '7s', tsumo: true, ura: ['4s'] }),
    )!
    expect(r.han).toBe(2) // solo pinfu + tsumo
  })

  it('tanyao + tsumo + aka: 3 han 30 fu → 1000/2000 (4000)', () => {
    const r = scoreWin(ctx({ concealed: '234567m23405p66s', win: '6s', tsumo: true }))!
    expect(yakuIds(r)).toEqual(['aka', 'tanyao', 'tsumo'])
    expect(r.han).toBe(3)
    expect(r.fu).toBe(30) // 20 + 2 tsumo + 4 ankou simple = 26 → 30
    expect(r.total).toBe(4000)
  })

  it('mano abierta sin yaku → null; con houtei gana', () => {
    const base: CtxOpts = {
      concealed: '123p456p7899s', win: '9s', melds: [meld('pon', '222m')],
    }
    expect(scoreWin(ctx(base))).toBeNull()
    const r = scoreWin(ctx({ ...base, houtei: true }))!
    expect(yakuIds(r)).toEqual(['houtei'])
  })

  it('par de viento doble suma 4 fu (2+2): 42 → 50 fu', () => {
    const r = scoreWin(
      ctx({
        concealed: '999m234p567p23s11z', win: '4s',
        dealer: true, riichi: 1, // oya: 1z es asiento Y ronda
      }),
    )!
    expect(r.han).toBe(1)
    expect(r.fu).toBe(50) // 20 +10 menzen-ron +8 ankou TH +2+2 par doble = 42 → 50
    expect(r.ron).toBe(2400)
  })

  it('honba y palos de riichi: ron 2400 + 2 honba + 1 palo = 4000', () => {
    const r = scoreWin(
      ctx({
        concealed: '999m234p567p23s11z', win: '4s',
        dealer: true, riichi: 1, honba: 2, sticks: 1,
      }),
    )!
    expect(r.ron).toBe(3000) // 2400 + 2×300
    expect(r.total).toBe(4000) // + 1000 del palo
  })

  it('ankan de haku: conserva menzen (+10 ron) y da 32 fu → 70 fu', () => {
    const r = scoreWin(
      ctx({ concealed: '234m567p2388s', win: '4s', melds: [meld('ankan', '5555z')] }),
    )!
    expect(yakuIds(r)).toEqual(['yakuhai-haku'])
    expect(r.fu).toBe(70) // 20 +10 menzen-ron +32 ankan TH = 62 → 70
    expect(r.ron).toBe(2300)
  })

  it('chinitsu cerrado + pinfu: 7 han, haneman 12000', () => {
    const r = scoreWin(ctx({ concealed: '123m234m567m78m99m', win: '9m' }))!
    expect(yakuIds(r)).toEqual(['chinitsu', 'pinfu'])
    expect(r.han).toBe(7)
    expect(r.limit).toBe('haneman')
    expect(r.ron).toBe(12000)
  })

  it('chinitsu abierto (kuisagari 5 han): mangan 8000', () => {
    const r = scoreWin(
      ctx({ concealed: '234m567m78m99m', win: '9m', melds: [meld('chi', '123m')] }),
    )!
    expect(yakuIds(r)).toEqual(['chinitsu'])
    expect(r.han).toBe(5)
    expect(r.limit).toBe('mangan')
    expect(r.ron).toBe(8000)
  })

  it('chanta abierto + yakuhai de ronda: 2 han 40 fu → 2600', () => {
    const r = scoreWin(
      ctx({
        concealed: '789m111s111z2z', win: '2z',
        melds: [meld('chi', '123p')],
      }),
    )!
    expect(yakuIds(r)).toEqual(['chanta', 'yakuhai-round'])
    expect(r.han).toBe(2)
    // 20 + 8 (111s ankou TH) + 8 (111z ankou TH) + 2 tanki + 2 par asiento(2z) = 40
    expect(r.fu).toBe(40)
    expect(r.ron).toBe(2600)
  })

  it('tenhou: yakuman situacional del oya', () => {
    const r = scoreWin(
      ctx({
        concealed: '123m567m23444p56s', win: '7s',
        tsumo: true, dealer: true, tenhou: true,
      }),
    )!
    expect(yakuIds(r)).toEqual(['tenhou'])
    expect(r.yakuman).toBe(1)
    expect(r.total).toBe(48000)
  })
})

describe('score: límites y bases', () => {
  it('tabla de basePoints y límites', () => {
    expect(basePoints(1, 30)).toBe(240)
    expect(basePoints(2, 25)).toBe(400)
    expect(basePoints(4, 30)).toBe(1920) // 7700 en ron: sin kiriage mangan
    expect(basePoints(4, 40)).toBe(2000) // cap mangan
    expect(basePoints(3, 70)).toBe(2000) // cap mangan
    expect(basePoints(5, 30)).toBe(2000)
    expect(basePoints(6, 30)).toBe(3000)
    expect(basePoints(8, 30)).toBe(4000)
    expect(basePoints(11, 30)).toBe(6000)
    expect(basePoints(13, 30)).toBe(8000) // kazoe
    expect(basePoints(0, 0, 2)).toBe(16000) // yakuman doble apilado

    expect(limitOf(4, 30, 0)).toBeNull()
    expect(limitOf(4, 40, 0)).toBe('mangan')
    expect(limitOf(13, 30, 0)).toBe('kazoe')
    expect(limitOf(0, 0, 1)).toBe('yakuman')
  })
})

// ============================================================================
// Propiedad: toda mano ganadora aleatoria con riichi puntúa coherentemente
// ============================================================================

function randomWinningTiles(rng: Rng): number[] {
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
    if (c.every((n) => n <= 4)) {
      const tiles: number[] = []
      c.forEach((n, t) => { for (let i = 0; i < n; i++) tiles.push(t) })
      return tiles
    }
  }
}

describe('score: propiedad sobre manos ganadoras aleatorias', () => {
  it('200 manos con riichi: siempre puntúan y los pagos son coherentes', () => {
    const rng = makeRng(20240710)
    for (let i = 0; i < 200; i++) {
      const next: Record<number, number> = {}
      const toId = (t: number): TileId => {
        const k = next[t] ?? (AKA_TYPES.has(t) ? 1 : 0)
        next[t] = k + 1
        // la 4ª copia de un tipo con aka es la propia aka (k solo llega a 3)
        return (t << 2) | (k > 3 ? 0 : k)
      }
      const tiles = randomWinningTiles(rng)
      const win = tiles[tiles.length - 1]!
      const concealed = tiles.slice(0, -1)
      const tsumo = i % 2 === 0
      const r = scoreWin({
        concealed: concealed.map(toId),
        winTile: toId(win),
        melds: [],
        tsumo,
        dealer: i % 4 === 0,
        seatWind: i % 4 === 0 ? 27 : 28,
        roundWind: 27,
        riichi: 1,
        ippatsu: false,
        doraIndicators: [],
        uraIndicators: [],
        honba: 0,
        riichiSticks: 0,
        haitei: false, houtei: false, rinshan: false, chankan: false,
        tenhou: false, chiihou: false,
      })
      expect(r).not.toBeNull()
      expect(r!.han).toBeGreaterThanOrEqual(1)
      if (r!.yakuman === 0) {
        expect(r!.fu === 25 || (r!.fu >= 20 && r!.fu % 10 === 0)).toBe(true)
      }
      expect(r!.total).toBeGreaterThan(0)
      expect(r!.total % 100).toBe(0)
      if (tsumo) {
        if (r!.fromDealer !== undefined) {
          expect(r!.total).toBe(r!.fromDealer + r!.fromEach! * 2)
        } else {
          expect(r!.total).toBe(r!.fromEach! * 3)
        }
      } else {
        expect(r!.total).toBe(r!.ron)
      }
    }
  })
})
