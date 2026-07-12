import { describe, it, expect } from 'vitest'
import { parseTile, tile34Of } from '../src/core/tile'
import type { HandState } from '../src/core/state'
import { reduce } from '../src/core/reducer'
import { makeRng } from '../src/core/rng'
import { botTurnAction, botReaction, pickCopy, naiveTurnAction, naiveReaction } from '../src/ai/bot'
import { simulateHand, type Policies } from '../src/ai/sim'
import { start, JUNK1, JUNK2, JUNK3, HERO } from './rig'

const t = parseTile
const rng = makeRng(1)

// mano de fold: 3-shanten, con un 6m que SOLO se suelta por seguridad
// (conecta la única corrida 567m; el ataque jamás lo descartaría)
const FOLD_HAND = '13679m2468p147s6m'

const drive = (s: HandState, acts: Parameters<typeof reduce>[1][]): HandState => {
  for (const a of acts) s = reduce(s, a)
  return s
}

describe('bot: defensa (fold bajo riichi)', () => {
  it('con riichi enemigo y mano atrasada descarta el genbutsu', () => {
    let { s } = start({
      hands: [HERO, FOLD_HAND, '2233p5577p1188s2s', '1199p7799p3366s9s'],
      draws: ['6m', '4z'],
    })
    s = drive(s, [{ type: 'draw' }])
    s = drive(s, [{ type: 'riichi', tile: s.drawn! }]) // oya riichi descartando 6m
    s = drive(s, [{ type: 'pass', seat: 1 }]) // seat1 pasa el pon del 6m
    expect(s.seats[0]!.riichi).toBe(2)

    s = drive(s, [{ type: 'draw' }]) // seat1 roba 4z
    const a = botTurnAction(s, rng)
    expect(a.type).toBe('discard')
    expect(tile34Of((a as { tile: number }).tile)).toBe(t('6m')) // genbutsu
  })

  it('sin amenaza, la misma mano ataca y no suelta el 6m', () => {
    let { s } = start({
      hands: [HERO, FOLD_HAND, '2233p5577p1188s2s', '1199p7799p3366s9s'],
      draws: ['6m', '4z'],
    })
    s = drive(s, [{ type: 'draw' }])
    s = drive(s, [{ type: 'discard', tile: s.drawn! }]) // descarte normal, sin riichi
    s = drive(s, [{ type: 'pass', seat: 1 }]) // seat1 pasa el pon del 6m

    s = drive(s, [{ type: 'draw' }])
    const a = botTurnAction(s, rng)
    expect(a.type).toBe('discard')
    // ataque: suelta la ficha aislada menos central (el honor), no el genbutsu
    expect(tile34Of((a as { tile: number }).tile)).toBe(t('4z'))
  })
})

describe('bot: llamadas', () => {
  const PON_HAND = '77z1133m2468p148s' // dos pares extra: el pon de chun mejora

  it('pon de yakuhai aunque la mano esté cerrada', () => {
    let { s } = start({
      hands: [JUNK1, PON_HAND, JUNK2, JUNK3],
      draws: ['7z'],
    })
    s = drive(s, [{ type: 'draw' }])
    s = drive(s, [{ type: 'discard', tile: s.drawn! }]) // oya suelta chun
    expect(s.phase).toBe('reaction')
    const offer = s.reaction!.offers.find((o) => o.seat === 1)!
    expect(offer.pon).toBe(true)
    expect(botReaction(s, offer, rng)).toEqual({ type: 'pon', seat: 1 })
  })

  it('no llama pon corriente con la mano cerrada', () => {
    let { s } = start({
      hands: [JUNK3, '88s1133m2468p147z', JUNK2, '112288m224466p7p'],
      draws: ['8s'],
    })
    s = drive(s, [{ type: 'draw' }])
    s = drive(s, [{ type: 'discard', tile: s.drawn! }])
    const offer = s.reaction!.offers.find((o) => o.seat === 1)!
    expect(offer.pon).toBe(true)
    expect(botReaction(s, offer, rng)).toEqual({ type: 'pass', seat: 1 })
  })

  it('bajo riichi enemigo no llama ni yakuhai', () => {
    let { s } = start({
      hands: [HERO, PON_HAND, '4466m22p335577s9s', JUNK3],
      draws: ['6z', '1z', '7z'],
    })
    s = drive(s, [{ type: 'draw' }])
    s = drive(s, [{ type: 'riichi', tile: s.drawn! }]) // oya en riichi
    s = drive(s, [{ type: 'draw' }]) // seat1 junk
    s = drive(s, [{ type: 'discard', tile: s.drawn! }])
    s = drive(s, [{ type: 'draw' }]) // seat2 roba chun y lo suelta
    s = drive(s, [{ type: 'discard', tile: s.drawn! }])
    expect(s.phase).toBe('reaction')
    const offer = s.reaction!.offers.find((o) => o.seat === 1)!
    expect(offer.pon).toBe(true)
    expect(botReaction(s, offer, rng)).toEqual({ type: 'pass', seat: 1 })
  })
})

describe('bot: riichi', () => {
  it('declara riichi al llegar a tenpai con la mano cerrada', () => {
    let { s } = start({
      hands: [HERO, JUNK1, JUNK2, JUNK3],
      draws: ['6z'],
    })
    s = drive(s, [{ type: 'draw' }])
    const a = botTurnAction(s, rng)
    expect(a.type).toBe('riichi')
  })
})

describe('bot: conservación del aka', () => {
  it('pickCopy prefiere la copia normal sobre el aka', () => {
    const aka5p = 13 << 2 // copia 0 = aka
    const normal5p = (13 << 2) | 1
    expect(pickCopy([aka5p, normal5p], 13)).toBe(normal5p)
    expect(pickCopy([normal5p, aka5p], 13)).toBe(normal5p)
    expect(pickCopy([aka5p], 13)).toBe(aka5p) // si solo queda el aka, se va
  })
})

describe('bot: fuerza comparativa', () => {
  it('la política seria gana puntos a la ingenua (40 manos, asientos alternos)', () => {
    const naive = { turn: naiveTurnAction, reaction: naiveReaction }
    // asientos 0 y 2 serios, 1 y 3 ingenuos; el oya rota para no sesgar
    const policies: Policies = { 1: naive, 3: naive }
    let smart = 0
    let ingenuo = 0
    for (let seed = 0; seed < 40; seed++) {
      const { final } = simulateHand(seed * 31 + 7, (seed % 4) as 0 | 1 | 2 | 3, {}, {}, policies)
      smart += final.seats[0]!.points + final.seats[2]!.points - 50000
      ingenuo += final.seats[1]!.points + final.seats[3]!.points - 50000
    }
    expect(smart).toBeGreaterThan(ingenuo)
    expect(smart).toBeGreaterThan(0) // gana puntos netos, no solo pierde menos
  }, 60000)
})
