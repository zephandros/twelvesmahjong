import { describe, it, expect } from 'vitest'
import {
  tile34, suitOf, rankOf, label34, labelId, parseTile,
  isAka, tile34Of, isTerminalOrHonor, TILE34_COUNT,
} from '../src/core/tile'
import {
  seatWind, relSeat, edgeOf, cornerOf, windKanji,
  WIND_EAST, WIND_SOUTH, WIND_WEST, WIND_NORTH, type Seat,
} from '../src/core/seat'

describe('tile: índice canónico', () => {
  it('mapea palo+rango a Tile34 y de vuelta', () => {
    expect(tile34('m', 1)).toBe(0)
    expect(tile34('m', 9)).toBe(8)
    expect(tile34('p', 1)).toBe(9)
    expect(tile34('s', 1)).toBe(18)
    expect(tile34('z', 1)).toBe(27) // Este
    expect(tile34('z', 7)).toBe(33) // chun
    for (let t = 0; t < TILE34_COUNT; t++) {
      expect(tile34(suitOf(t), rankOf(t))).toBe(t)
    }
  })

  it('etiquetas de honores en orden canónico E,S,W,N,haku,hatsu,chun', () => {
    expect([27, 28, 29, 30, 31, 32, 33].map(label34)).toEqual([
      'E', 'S', 'W', 'N', 'haku', 'hatsu', 'chun',
    ])
  })

  it('parseTile invierte la notación, con 0 = aka', () => {
    expect(parseTile('1m')).toBe(0)
    expect(parseTile('E')).toBe(27)
    expect(parseTile('1z')).toBe(27) // notación rango-palo también para honores
    expect(parseTile('0p')).toBe(tile34('p', 5)) // aka 5p cuenta como 5p
  })

  it('aka dora = copias 16/52/88 y su etiqueta es 0x', () => {
    expect([16, 52, 88].every(isAka)).toBe(true)
    expect(isAka(17)).toBe(false)
    expect(tile34Of(16)).toBe(tile34('m', 5))
    expect(labelId(16)).toBe('0m')
    expect(labelId(52)).toBe('0p')
    expect(labelId(88)).toBe('0s')
  })

  it('terminales y honores', () => {
    expect(isTerminalOrHonor(tile34('m', 1))).toBe(true)
    expect(isTerminalOrHonor(tile34('m', 9))).toBe(true)
    expect(isTerminalOrHonor(tile34('m', 5))).toBe(false)
    expect(isTerminalOrHonor(27)).toBe(true)
  })
})

describe('seat: vientos y pantalla (trampa 1)', () => {
  it('el viento de asiento avanza E→S→W→N desde el oya', () => {
    const dealer: Seat = 0
    expect(seatWind(0, dealer)).toBe(WIND_EAST)
    expect(seatWind(1, dealer)).toBe(WIND_SOUTH)
    expect(seatWind(2, dealer)).toBe(WIND_WEST)
    expect(seatWind(3, dealer)).toBe(WIND_NORTH)
  })

  it('rota con el oya', () => {
    const dealer: Seat = 2
    expect(seatWind(2, dealer)).toBe(WIND_EAST)
    expect(seatWind(3, dealer)).toBe(WIND_SOUTH)
    expect(seatWind(0, dealer)).toBe(WIND_WEST)
    expect(seatWind(1, dealer)).toBe(WIND_NORTH)
  })

  it('mapeo relativo: shimo=derecha, toimen=arriba, kami=izquierda', () => {
    const self: Seat = 0
    expect(relSeat(0, self)).toBe('self')
    expect(relSeat(1, self)).toBe('shimo')
    expect(relSeat(2, self)).toBe('toimen')
    expect(relSeat(3, self)).toBe('kami')

    expect(edgeOf('self')).toBe('bottom')
    expect(edgeOf('shimo')).toBe('right')
    expect(edgeOf('toimen')).toBe('top')
    expect(edgeOf('kami')).toBe('left')
  })

  it('las esquinas de retrato recorren el anillo antihorario bl→br→tr→tl', () => {
    expect(cornerOf('self')).toBe('bl')
    expect(cornerOf('shimo')).toBe('br')
    expect(cornerOf('toimen')).toBe('tr')
    expect(cornerOf('kami')).toBe('tl')
  })

  it('kanji de vientos', () => {
    expect([WIND_EAST, WIND_SOUTH, WIND_WEST, WIND_NORTH].map(windKanji)).toEqual([
      '東', '南', '西', '北',
    ])
  })
})
