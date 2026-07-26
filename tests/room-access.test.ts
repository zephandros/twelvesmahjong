// Puerta de entrada a una sala: el código y el ticket de anfitrión.
//
// El ticket es lo que impide que un bot instancie Durable Objects sin pasar por
// Turnstile, así que conviene tenerlo atado: firma correcta, caducidad, y que
// no valga para OTRA sala.

import { describe, it, expect } from 'vitest'
import { newRoomCode, isRoomCode, CODE_LENGTH } from '../src/net/codes'
import { mintHostTicket, checkHostTicket } from '../worker/ticket'

const SECRET = 'secreto-de-prueba-no-es-el-real'

describe('código de sala', () => {
  it('tiene la longitud fijada y solo usa el alfabeto sin ambigüedades', () => {
    for (let i = 0; i < 200; i++) {
      const code = newRoomCode()
      expect(code).toHaveLength(CODE_LENGTH)
      // fuera I, O, 0 y 1: se dictan por voz sin equivocarse
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/)
      expect(isRoomCode(code)).toBe(true)
    }
  })

  it('rechaza lo que no es un código', () => {
    expect(isRoomCode('')).toBe(false)
    expect(isRoomCode('ABC')).toBe(false) // corto
    expect(isRoomCode('ABCDEFG')).toBe(false) // largo
    expect(isRoomCode('ABCDE0')).toBe(false) // cero, fuera del alfabeto
    expect(isRoomCode('abcdef')).toBe(false) // minúsculas (la API normaliza antes)
  })

  it('no se repite en una tanda razonable', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) seen.add(newRoomCode())
    expect(seen.size).toBe(2000)
  })
})

describe('ticket de anfitrión', () => {
  it('el que se acaba de firmar vale', async () => {
    const code = newRoomCode()
    const ticket = await mintHostTicket(SECRET, code)
    expect(await checkHostTicket(SECRET, code, ticket)).toBe(true)
  })

  it('NO vale para otra sala', async () => {
    const ticket = await mintHostTicket(SECRET, 'AAAAAA')
    expect(await checkHostTicket(SECRET, 'BBBBBB', ticket)).toBe(false)
  })

  it('NO vale con otro secreto', async () => {
    const code = newRoomCode()
    const ticket = await mintHostTicket(SECRET, code)
    expect(await checkHostTicket('otro-secreto', code, ticket)).toBe(false)
  })

  it('rechaza un ticket caducado aunque la firma cuadre', async () => {
    const code = newRoomCode()
    const ticket = await mintHostTicket(SECRET, code)
    const [, sig] = ticket.split('.')
    // se retrasa la caducidad a mano: la firma deja de cubrir el mensaje
    expect(await checkHostTicket(SECRET, code, `${Date.now() - 1000}.${sig}`)).toBe(false)
  })

  it('rechaza basura sin lanzar', async () => {
    const code = newRoomCode()
    for (const bad of ['', '.', 'x', 'abc.def', '999999999999.$$$$', `${Date.now() + 1000}.`]) {
      expect(await checkHostTicket(SECRET, code, bad)).toBe(false)
    }
  })
})
