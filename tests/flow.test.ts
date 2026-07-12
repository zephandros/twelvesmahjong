import { describe, it, expect } from 'vitest'
import { parseTile, tile34Of } from '../src/core/tile'
import type { Seat } from '../src/core/seat'
import type { HandState } from '../src/core/state'
import { reduce } from '../src/core/reducer'
import { tsumoScore } from '../src/core/rules'
import { newGame, advanceGame, ranking } from '../src/core/game'
import { simulateFrom } from '../src/ai/sim'
import { start, JUNK1, JUNK2, JUNK3, HERO } from './rig'

const t = parseTile
const yakuIds = (s: HandState): string[] => {
  const e = s.end
  if (!e || (e.type !== 'tsumo' && e.type !== 'ron')) return []
  return e.score.yaku.map((y) => y.id).sort()
}
describe('escenario: double riichi + ippatsu + ittsu + tsumo', () => {
  it('el oya declara double riichi y gana con haneman', () => {
    let { s } = start({
      hands: [HERO, JUNK1, JUNK2, JUNK3],
      draws: ['5z', '1z', '2z', '3z', '1p'],
      dead: '4444z6666z8899s2s8m',
    })
    s = reduce(s, { type: 'draw' }) // oya roba 9z
    s = reduce(s, { type: 'riichi', tile: s.drawn! })
    expect(s.seats[0]!.riichi).toBe(2) // double: primer descarte, sin llamadas
    expect(s.seats[0]!.ippatsu).toBe(true)
    expect(s.seats[0]!.points).toBe(24000)
    expect(s.sticks).toBe(1)

    for (const seat of [1, 2, 3]) {
      expect(s.turn).toBe(seat)
      s = reduce(s, { type: 'draw' })
      s = reduce(s, { type: 'discard', tile: s.drawn! })
    }
    s = reduce(s, { type: 'draw' }) // oya roba 1p
    expect(tsumoScore(s)).not.toBeNull()
    s = reduce(s, { type: 'tsumo' })

    expect(s.end!.type).toBe('tsumo')
    expect(yakuIds(s)).toEqual(['double-riichi', 'ippatsu', 'ittsu', 'tsumo'])
    const score = (s.end as { score: { han: number; fu: number; limit: string | null } }).score
    expect(score.han).toBe(6)
    expect(score.fu).toBe(30)
    expect(score.limit).toBe('haneman')
    expect(s.seats[0]!.points).toBe(43000) // 25000 − 1000 + 18000 + 1000
    expect(s.seats[1]!.points).toBe(19000)
    expect(s.sticks).toBe(0)
  })
})

describe('escenario: furiten temporal', () => {
  it('dejar pasar bloquea el ron hasta el siguiente robo propio', () => {
    let { s } = start({
      hands: [HERO, JUNK1, JUNK2, JUNK3],
      draws: ['7z', '4p', '4p', '1z', '5z', '4p'],
      dead: '4444z6666z8899s2s8m',
    })
    s = reduce(s, { type: 'draw' })
    s = reduce(s, { type: 'discard', tile: s.drawn! }) // oya descarta 9z

    s = reduce(s, { type: 'draw' }) // seat1 roba 4p
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    expect(s.phase).toBe('reaction') // oferta de ron para el oya
    expect(s.reaction!.offers).toEqual([
      expect.objectContaining({ seat: 0, ron: true }),
    ])
    s = reduce(s, { type: 'pass', seat: 0 }) // la deja pasar
    expect(s.seats[0]!.missedRon).toBe(true)
    expect(s.seats[0]!.riichiFuriten).toBe(false)

    s = reduce(s, { type: 'draw' }) // seat2 roba 4p
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    expect(s.phase).toBe('draw') // sin oferta: furiten temporal
    expect(s.reaction).toBeNull()

    s = reduce(s, { type: 'draw' }) // seat3 junk
    s = reduce(s, { type: 'discard', tile: s.drawn! })

    s = reduce(s, { type: 'draw' }) // el oya roba: se limpia el furiten
    expect(s.seats[0]!.missedRon).toBe(false)
    s = reduce(s, { type: 'discard', tile: s.drawn! })

    s = reduce(s, { type: 'draw' }) // seat1 roba el tercer 4p
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    expect(s.phase).toBe('reaction') // la oferta vuelve
    s = reduce(s, { type: 'ron', seat: 0 })
    expect(s.end!.type).toBe('ron')
    const end = s.end as { winner: Seat; from: Seat; chankan: boolean }
    expect(end.winner).toBe(0)
    expect(end.from).toBe(1)
    expect(end.chankan).toBe(false)
    expect(yakuIds(s)).toEqual(['ittsu'])
  })
})

describe('escenario: furiten permanente por descarte propio', () => {
  it('bloquea el ron pero no el tsumo', () => {
    let { s } = start({
      hands: [HERO, JUNK1, JUNK2, JUNK3],
      draws: ['4p', '1p', '1z', '2z', '1p'],
      dead: '4444z6666z8899s2s8m',
    })
    s = reduce(s, { type: 'draw' }) // oya roba 4p (una de sus esperas)
    s = reduce(s, { type: 'discard', tile: s.drawn! }) // y la descarta

    s = reduce(s, { type: 'draw' }) // seat1 roba 1p
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    expect(s.phase).toBe('draw') // sin oferta: furiten de descarte propio
    expect(s.reaction).toBeNull()

    s = reduce(s, { type: 'draw' }) // seat2 junk
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    s = reduce(s, { type: 'draw' }) // seat3 junk
    s = reduce(s, { type: 'discard', tile: s.drawn! })

    s = reduce(s, { type: 'draw' }) // oya roba 1p: tsumo permitido
    expect(tsumoScore(s)).not.toBeNull()
    s = reduce(s, { type: 'tsumo' })
    expect(s.end!.type).toBe('tsumo')
    expect(yakuIds(s)).toContain('tsumo')
  })
})

describe('escenario: furiten de riichi', () => {
  it('dejar pasar en riichi bloquea el ron el resto de la mano', () => {
    let { s } = start({
      hands: [HERO, JUNK1, JUNK2, JUNK3],
      draws: ['7z', '4p', '1z', '2z', '5z', '4p'],
      dead: '4444z6666z8899s2s8m',
    })
    s = reduce(s, { type: 'draw' })
    s = reduce(s, { type: 'riichi', tile: s.drawn! })

    s = reduce(s, { type: 'draw' }) // seat1 roba 4p
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    s = reduce(s, { type: 'pass', seat: 0 }) // la deja pasar EN RIICHI
    expect(s.seats[0]!.missedRon).toBe(true)
    expect(s.seats[0]!.riichiFuriten).toBe(true)

    s = reduce(s, { type: 'draw' }) // seat2 junk
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    s = reduce(s, { type: 'draw' }) // seat3 junk
    s = reduce(s, { type: 'discard', tile: s.drawn! })

    s = reduce(s, { type: 'draw' }) // oya roba: temporal se limpia…
    expect(s.seats[0]!.missedRon).toBe(false)
    expect(s.seats[0]!.riichiFuriten).toBe(true) // …el de riichi no
    s = reduce(s, { type: 'discard', tile: s.drawn! }) // tsumogiri (riichi)

    s = reduce(s, { type: 'draw' }) // seat1 roba otro 4p
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    expect(s.phase).toBe('draw') // jamás vuelve a haber oferta
    expect(s.reaction).toBeNull()
  })

  it('en riichi solo se puede descartar la robada', () => {
    let { s } = start({
      hands: [HERO, JUNK1, JUNK2, JUNK3],
      draws: ['7z', '1z', '2z', '3z', '5z'],
      dead: '4444z6666z8899s2s8m',
    })
    s = reduce(s, { type: 'draw' })
    s = reduce(s, { type: 'riichi', tile: s.drawn! })
    for (const _ of [1, 2, 3]) {
      s = reduce(s, { type: 'draw' })
      s = reduce(s, { type: 'discard', tile: s.drawn! })
    }
    s = reduce(s, { type: 'draw' })
    const fromHand = s.seats[0]!.hand[0]!
    expect(() => reduce(s, { type: 'discard', tile: fromHand })).toThrow(/riichi/)
  })
})

describe('escenario: prioridad pon > chi y kuikae', () => {
  it('el pon de seat3 gana al chi de seat2; kuikae bloqueado', () => {
    let { s } = start({
      hands: [
        '113399m224488s7m', // seat0 junk
        '225588m113377s9m', // seat1 junk
        '24p446688m22668s', // seat2: puede chi 3p (tiene 2p y 4p)
        '333p6677m445599s', // seat3: puede pon 3p (y le sobra un 3p)
      ],
      draws: ['1z', '3p'],
    })
    s = reduce(s, { type: 'draw' }) // seat0 junk
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    s = reduce(s, { type: 'draw' }) // seat1 roba 3p
    s = reduce(s, { type: 'discard', tile: s.drawn! })

    expect(s.phase).toBe('reaction')
    const offers = s.reaction!.offers
    expect(offers.find((o) => o.seat === 2)!.chi).toEqual([t('2p')])
    expect(offers.find((o) => o.seat === 3)!.pon).toBe(true)

    s = reduce(s, { type: 'chi', seat: 2, start: t('2p') })
    s = reduce(s, { type: 'pon', seat: 3 }) // resolución: pon gana

    expect(s.turn).toBe(3)
    expect(s.phase).toBe('discard')
    expect(s.seats[3]!.melds).toHaveLength(1)
    expect(s.seats[3]!.melds[0]!.kind).toBe('pon')
    expect(s.seats[2]!.melds).toHaveLength(0)
    expect(s.anyCall).toBe(true)
    expect(s.seats[1]!.pond).toHaveLength(0) // la ficha llamada salió del pond
    expect(s.seats[1]!.discarded).toEqual([t('3p')]) // el historial queda

    // kuikae: no puede descartar el 3p sobrante
    const spare3p = s.seats[3]!.hand.find((id) => tile34Of(id) === t('3p'))!
    expect(() => reduce(s, { type: 'discard', tile: spare3p })).toThrow(/kuikae/)
    const other = s.seats[3]!.hand.find((id) => tile34Of(id) !== t('3p'))!
    s = reduce(s, { type: 'discard', tile: other })
    expect(s.justCalled).toBeNull()
  })
})

describe('escenario: ankan, dora nuevo y rinshan kaihou', () => {
  it('ankan revela dora, roba del muerto y gana con rinshan', () => {
    let { s } = start({
      hands: ['345m678m99p23s222z', JUNK1, JUNK2, JUNK3],
      draws: ['2z'],
      dead: '4s888p7777z44z5559p',
    })
    s = reduce(s, { type: 'draw' }) // roba el 4º 2z
    s = reduce(s, { type: 'ankan', tile34: t('2z') })

    expect(s.kanCount).toBe(1)
    expect(s.wall.doraRevealed).toBe(2)
    expect(s.wall.rinshanDrawn).toBe(1)
    expect(s.wall.dead).toHaveLength(14) // consumió una y repuso del vivo
    expect(s.rinshan).toBe(true)
    expect(tile34Of(s.drawn!)).toBe(t('4s')) // la ficha de rinshan

    s = reduce(s, { type: 'tsumo' })
    expect(s.end!.type).toBe('tsumo')
    expect(yakuIds(s)).toEqual(['rinshan', 'tsumo'])
    const score = (s.end as { score: { fu: number } }).score
    expect(score.fu).toBe(60) // 20 + 2 tsumo + 32 ankan de honor + 2 kanchan → wait
  })
})

describe('escenario: chankan sobre kokushi', () => {
  it('el shouminkan es robado por ron de chankan (yakuman)', () => {
    let { s } = start({
      hands: [
        '55z113355p24688s', // seat0: par de haku y basura
        JUNK1,
        JUNK2,
        '19m19p19s123467z7z', // seat3: kokushi tenpai esperando 5z
      ],
      draws: ['9m', '5z', '7p', '8p', '9s', '5z'],
    })
    s = reduce(s, { type: 'draw' }) // seat0 junk
    s = reduce(s, { type: 'discard', tile: s.drawn! })

    s = reduce(s, { type: 'draw' }) // seat1 roba 5z
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    expect(s.phase).toBe('reaction') // pon para seat0, ron para seat3
    s = reduce(s, { type: 'pass', seat: 3 }) // kokushi la deja pasar (!)
    s = reduce(s, { type: 'pon', seat: 0 })
    expect(s.seats[3]!.missedRon).toBe(true)
    expect(s.seats[0]!.melds[0]!.kind).toBe('pon')

    // seat0 descarta; la rueda avanza hasta que seat3 roba (limpia furiten)
    const junk = s.seats[0]!.hand.find((id) => tile34Of(id) !== t('5z'))!
    s = reduce(s, { type: 'discard', tile: junk })
    for (const _ of [1, 2, 3]) {
      s = reduce(s, { type: 'draw' })
      if (s.turn === 3) expect(s.seats[3]!.missedRon).toBe(false)
      s = reduce(s, { type: 'discard', tile: s.drawn! })
      if (s.phase === 'reaction') {
        // el 9s de seat3 ofrece pon a seat1: se pasa
        for (const o of s.reaction!.offers) {
          s = reduce(s, { type: 'pass', seat: o.seat })
        }
      }
    }

    s = reduce(s, { type: 'draw' }) // seat0 roba el 4º 5z
    expect(s.turn).toBe(0)
    s = reduce(s, { type: 'shouminkan', tile: s.drawn! })
    expect(s.phase).toBe('reaction')
    expect(s.reaction!.chankan).toBe(true)
    expect(s.reaction!.offers).toEqual([
      expect.objectContaining({ seat: 3, ron: true }),
    ])

    s = reduce(s, { type: 'ron', seat: 3 })
    expect(s.end!.type).toBe('ron')
    const end = s.end as { winner: Seat; from: Seat; chankan: boolean; score: { yakuman: number } }
    expect(end.winner).toBe(3)
    expect(end.from).toBe(0)
    expect(end.chankan).toBe(true)
    expect(end.score.yakuman).toBe(1)
    expect(yakuIds(s)).toEqual(['kokushi'])
    expect(s.seats[3]!.points).toBe(57000)
    expect(s.seats[0]!.points).toBe(-7000) // sin límite de busto dentro de la mano
    // el kan nunca se completó
    expect(s.seats[0]!.melds[0]!.kind).toBe('pon')
    expect(s.pendingKan).not.toBeNull()
  })
})

describe('escenario: kyuushu kyuuhai', () => {
  it('9 tipos de terminales/honores en el primer turno permiten abortar', () => {
    let { s } = start({
      hands: ['19m19p19s1234z66z5m', JUNK1, JUNK2, JUNK3],
      draws: ['7p'],
    })
    s = reduce(s, { type: 'draw' })
    s = reduce(s, { type: 'kyuushu' })
    expect(s.end).toEqual({ type: 'abort', reason: 'kyuushu', deltas: [0, 0, 0, 0] })
  })
})

describe('partida completa (game.ts)', () => {
  it('10 partidas: terminan, conservan puntos y clasifican', { timeout: 30000 }, () => {
    for (let seed = 1; seed <= 10; seed++) {
      let g = newGame(seed)
      let hands = 0
      while (!g.finished) {
        if (++hands > 30) throw new Error('partida sin terminar')
        g = { ...g, hand: simulateFrom(g.hand, seed * 100 + hands).final }
        const sum =
          g.hand.seats.reduce((a, st) => a + st.points, 0) + g.hand.sticks * 1000
        expect(sum).toBe(100000)
        g = advanceGame(g)
      }
      expect(g.kyoku).toBeLessThanOrEqual(4)
      const order = ranking(g.hand)
      for (let i = 1; i < 4; i++) {
        expect(g.hand.seats[order[i - 1]!]!.points).toBeGreaterThanOrEqual(
          g.hand.seats[order[i]!]!.points,
        )
      }
    }
  })
})
