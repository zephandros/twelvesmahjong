// Perfiles de bot: candado del comportamiento por defecto (debe igualar la política
// histórica), matriz estilo×habilidad, diferencias reales de juego y orden de fuerza.

import { describe, it, expect } from 'vitest'
import { parseTile, tile34Of } from '../src/core/tile'
import type { HandState } from '../src/core/state'
import { reduce } from '../src/core/reducer'
import { makeRng } from '../src/core/rng'
import { botTurnAction, botReaction, makePolicy } from '../src/ai/bot'
import { resolveBehavior, DEFAULT_BEHAVIOR, DEFAULT_PROFILE } from '../src/ai/profiles'
import { simulateHand, type Policies } from '../src/ai/sim'
import { start, JUNK1, JUNK2, JUNK3, HERO } from './rig'

const t = parseTile
const rng = makeRng(1)
const tile34 = (a: { tile: number }): number => tile34Of(a.tile)

const drive = (s: HandState, acts: Parameters<typeof reduce>[1][]): HandState => {
  for (const a of acts) s = reduce(s, a)
  return s
}

describe('resolveBehavior: candado del bot por defecto', () => {
  it('balanced × expert reproduce la política seria histórica', () => {
    expect(resolveBehavior(DEFAULT_PROFILE)).toEqual({
      useUkeire: true,
      defense: 'suji',
      foldFromShanten: 2,
      callPolicy: 'improve',
      riichiPolicy: 'always',
      noise: 0,
    })
    // el simulador y el controlador cuelgan de este mismo comportamiento
    expect(DEFAULT_BEHAVIOR).toEqual(resolveBehavior(DEFAULT_PROFILE))
  })
})

describe('resolveBehavior: ejes estilo × habilidad', () => {
  it('el estilo fija tendencias', () => {
    expect(resolveBehavior({ style: 'attacker', skill: 'expert' }).foldFromShanten).toBe(Infinity)
    const def = resolveBehavior({ style: 'defender', skill: 'expert' })
    expect(def.foldFromShanten).toBe(1)
    expect(def.riichiPolicy).toBe('damaten')
    expect(def.callPolicy).toBe('yakuhai')
    expect(resolveBehavior({ style: 'purist', skill: 'expert' }).callPolicy).toBe('never')
    expect(resolveBehavior({ style: 'speedster', skill: 'expert' }).callPolicy).toBe('greedy')
    expect(resolveBehavior({ style: 'chaotic', skill: 'expert' }).noise).toBeGreaterThan(0)
  })

  it('la habilidad capa la capacidad', () => {
    // novato: sin ukeire, sin defensa (→ nunca se dobla, sea cual sea el estilo) y con ruido
    const nov = resolveBehavior({ style: 'defender', skill: 'novice' })
    expect(nov.useUkeire).toBe(false)
    expect(nov.defense).toBe('none')
    expect(nov.foldFromShanten).toBe(Infinity)
    expect(nov.noise).toBeGreaterThan(0)
    // intermedio: ukeire sí, pero defensa solo genbutsu
    const mid = resolveBehavior({ style: 'balanced', skill: 'intermediate' })
    expect(mid.useUkeire).toBe(true)
    expect(mid.defense).toBe('genbutsu')
  })
})

// mano de fold: 3-shanten, con un 6m que SOLO se suelta por seguridad (igual que bot.test)
const FOLD_HAND = '13679m2468p147s6m'

describe('estilo en juego: ataque vs defensa bajo amenaza', () => {
  const setup = (): HandState => {
    let { s } = start({
      hands: [HERO, FOLD_HAND, '2233p5577p1188s2s', '1199p7799p3366s9s'],
      draws: ['6m', '4z'],
    })
    s = drive(s, [{ type: 'draw' }])
    s = drive(s, [{ type: 'riichi', tile: s.drawn! }]) // oya en riichi soltando 6m
    s = drive(s, [{ type: 'pass', seat: 1 }]) // seat1 pasa el pon del 6m
    return drive(s, [{ type: 'draw' }]) // seat1 roba 4z
  }

  it('el bot por defecto (balanced) dobla: descarta el genbutsu', () => {
    const a = botTurnAction(setup(), rng)
    expect(a.type).toBe('discard')
    expect(tile34(a as { tile: number })).toBe(t('6m'))
  })

  it('un attacker NO dobla: ataca y suelta el honor aislado', () => {
    const attacker = resolveBehavior({ style: 'attacker', skill: 'expert' })
    const a = botTurnAction(setup(), rng, attacker)
    expect(a.type).toBe('discard')
    expect(tile34(a as { tile: number })).toBe(t('4z'))
  })
})

describe('callPolicy: apetito de llamadas', () => {
  it("un purista ('never') deja pasar el pon de yakuhai que el default sí llama", () => {
    const PON_HAND = '77z1133m2468p148s'
    let { s } = start({ hands: [JUNK1, PON_HAND, JUNK2, JUNK3], draws: ['7z'] })
    s = drive(s, [{ type: 'draw' }])
    s = drive(s, [{ type: 'discard', tile: s.drawn! }]) // oya suelta chun
    const offer = s.reaction!.offers.find((o) => o.seat === 1)!
    expect(offer.pon).toBe(true)
    expect(botReaction(s, offer, rng)).toEqual({ type: 'pon', seat: 1 }) // default
    const purist = resolveBehavior({ style: 'purist', skill: 'expert' })
    expect(botReaction(s, offer, rng, purist)).toEqual({ type: 'pass', seat: 1 })
  })

  it("un greedy chi con la mano cerrada donde el default pasa", () => {
    // seat1 2-shanten cerrado; el chi de 2m lo lleva a tenpai
    let { s } = start({
      hands: ['456p789p456s789s5z', '13m456m789m5p234s9s', JUNK2, JUNK3],
      draws: ['2m'],
    })
    s = drive(s, [{ type: 'draw' }])
    s = drive(s, [{ type: 'discard', tile: s.drawn! }]) // oya suelta 2m
    const offer = s.reaction!.offers.find((o) => o.seat === 1)!
    expect(offer.chi).toContain(t('1m')) // corrida 123m
    expect(botReaction(s, offer, rng)).toEqual({ type: 'pass', seat: 1 }) // default: mano cerrada
    const greedy = resolveBehavior({ style: 'speedster', skill: 'expert' })
    expect(botReaction(s, offer, rng, greedy)).toEqual({ type: 'chi', seat: 1, start: t('1m') })
  })
})

describe('la habilidad ordena la fuerza', () => {
  it('experto gana puntos al novato (40 manos, asientos alternos)', () => {
    // seats 0 y 2 expertos (SMART por defecto), 1 y 3 novatos; mismo estilo balanced
    const novice = makePolicy({ style: 'balanced', skill: 'novice' })
    const policies: Policies = { 1: novice, 3: novice }
    let expert = 0
    let noob = 0
    for (let seed = 0; seed < 40; seed++) {
      const { final } = simulateHand(seed * 31 + 7, (seed % 4) as 0 | 1 | 2 | 3, {}, {}, policies)
      expert += final.seats[0]!.points + final.seats[2]!.points - 50000
      noob += final.seats[1]!.points + final.seats[3]!.points - 50000
    }
    // mismo estilo, más habilidad gana: los expertos superan a los novatos en el
    // balance directo (el "positivo neto" no se asegura: los palos de riichi que
    // quedan sobre la mesa al final de partida achican el bote total)
    expect(expert).toBeGreaterThan(noob)
  }, 60000)
})
