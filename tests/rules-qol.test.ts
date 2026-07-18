// Helpers de QoL de la UI: seatFuriten (las tres variantes vía estado real)
// y remainingFor (conteo de copias vivas sin doble conteo de fichas llamadas).

import { describe, it, expect } from 'vitest'
import { parseTile } from '../src/core/tile'
import { reduce } from '../src/core/reducer'
import { seatFuriten, remainingFor, seatWaits } from '../src/core/rules'
import { start, JUNK1, JUNK2, JUNK3, HERO } from './rig'

const t = parseTile
const DEAD = '4444z6666z8899s2s8m' // indicador de dora revelado: 6z

describe('seatFuriten', () => {
  it('falso con la mano limpia; verdadero al descartar una espera propia', () => {
    let { s } = start({
      hands: [HERO, JUNK1, JUNK2, JUNK3],
      draws: ['4p'],
      dead: DEAD,
    })
    expect(seatWaits(s, 0).sort()).toEqual([t('1p'), t('4p')].sort())
    expect(seatFuriten(s, 0)).toBe(false)

    s = reduce(s, { type: 'draw' }) // el oya roba 4p (espera propia)
    s = reduce(s, { type: 'discard', tile: s.drawn! }) // y la descarta
    expect(seatFuriten(s, 0)).toBe(true) // permanente de descarte
  })

  it('temporal por missedRon: activo tras pasar, se limpia al robar', () => {
    let { s } = start({
      hands: [HERO, JUNK1, JUNK2, JUNK3],
      draws: ['7z', '4p', '1z', '2z', '5z'],
      dead: DEAD,
    })
    s = reduce(s, { type: 'draw' })
    s = reduce(s, { type: 'discard', tile: s.drawn! }) // 7z: no es espera
    expect(seatFuriten(s, 0)).toBe(false)

    s = reduce(s, { type: 'draw' }) // seat1 roba 4p
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    s = reduce(s, { type: 'pass', seat: 0 }) // deja pasar el ron
    expect(seatFuriten(s, 0)).toBe(true) // temporal

    s = reduce(s, { type: 'draw' }) // seat2
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    s = reduce(s, { type: 'draw' }) // seat3
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    s = reduce(s, { type: 'draw' }) // el oya roba: missedRon se limpia
    expect(seatFuriten(s, 0)).toBe(false)
  })

  it('de riichi: pasar una espera en riichi es permanente', () => {
    let { s } = start({
      hands: [HERO, JUNK1, JUNK2, JUNK3],
      draws: ['5z', '4p', '1z', '2z', '3z'],
      dead: DEAD,
    })
    s = reduce(s, { type: 'draw' })
    s = reduce(s, { type: 'riichi', tile: s.drawn! }) // riichi descartando 5z
    expect(seatFuriten(s, 0)).toBe(false)

    s = reduce(s, { type: 'draw' }) // seat1 roba 4p
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    s = reduce(s, { type: 'pass', seat: 0 })
    expect(s.seats[0]!.riichiFuriten).toBe(true)

    s = reduce(s, { type: 'draw' }) // seat2
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    s = reduce(s, { type: 'draw' }) // seat3
    s = reduce(s, { type: 'discard', tile: s.drawn! })
    s = reduce(s, { type: 'draw' }) // el oya roba: el furiten de riichi persiste
    expect(seatFuriten(s, 0)).toBe(true)
  })
})

describe('remainingFor', () => {
  it('cuenta mano propia + robada, indicador de dora, y no ve manos rivales', () => {
    let { s } = start({
      hands: [HERO, '9p112233m445566m', '99p556677p88p123s', JUNK3],
      draws: ['1z'],
      dead: DEAD,
    })
    s = reduce(s, { type: 'draw' }) // el oya roba 1z

    const r0 = remainingFor(s, 0)
    expect(r0[t('1z')]).toBe(3) // la robada propia cuenta como vista
    expect(r0[t('1m')]).toBe(3) // 1 en mano propia; las 2 de seat1 no se ven
    expect(r0[t('6z')]).toBe(3) // indicador de dora revelado
    expect(r0[t('4z')]).toBe(4) // las 4 viven ocultas en el muro muerto

    const r1 = remainingFor(s, 1)
    expect(r1[t('1z')]).toBe(4) // seat1 no ve la robada del oya
  })

  it('pond y meld sin doble conteo de la ficha llamada', () => {
    let { s } = start({
      hands: [HERO, '9p112233m445566m', '99p556677p88p123s', JUNK3],
      draws: ['1z', '2z'],
      dead: DEAD,
    })
    s = reduce(s, { type: 'draw' })
    s = reduce(s, { type: 'discard', tile: s.drawn! }) // oya descarta 1z

    s = reduce(s, { type: 'draw' }) // seat1 roba 2z
    const nineP = s.seats[1]!.hand.find((id) => id >> 2 === t('9p'))!
    s = reduce(s, { type: 'discard', tile: nineP }) // descarta su 9p

    // en la ventana de reacción el 9p está en el pond de seat1
    expect(remainingFor(s, 0)[t('9p')]).toBe(3)

    s = reduce(s, { type: 'pon', seat: 2 }) // seat2 lo llama
    // meld de 3×9p; la llamada salió del pond y sigue en `discarded` de seat1:
    // debe contarse UNA sola vez (3 vistas → queda 1 viva)
    expect(remainingFor(s, 0)[t('9p')]).toBe(1)
    expect(remainingFor(s, 0)[t('1z')]).toBe(3) // el 1z del pond del oya
  })
})
