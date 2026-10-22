// Sincronización del fin de mano.
//
// El árbitro NO reparte la mano siguiente en cuanto acaba la anterior: espera a
// que todos cierren su pantalla de resultados, con un tope para que un ausente
// no congele la mesa. Sin esa espera, quien se entretuviera leyendo la pantalla
// de victoria perdía turnos sin verlos pasar, porque su reloj de decisión ya
// corría por detrás.
//
// La decisión vive en `canAdvance`/`pendingReady` de src/net/room-logic.ts, que
// son puras justamente para poder probarlas aquí sin red.

import { describe, it, expect } from 'vitest'
import { pendingReady, canAdvance, type ReadySeat } from '../src/net/room-logic'

/** Cuatro asientos humanos, conectados y sin confirmar. */
const humanos = (): ReadySeat[] =>
  [0, 1, 2, 3].map(() => ({ human: true, connected: true, ready: false }))

const AHORA = 1_000_000

describe('a quién se espera al acabar una mano', () => {
  it('a los humanos conectados que aún no han confirmado', () => {
    const s = humanos()
    expect(pendingReady(s)).toEqual([0, 1, 2, 3])
    s[1]!.ready = true
    expect(pendingReady(s)).toEqual([0, 2, 3])
  })

  it('a la IA NO se le espera', () => {
    const s = humanos()
    s[2] = { human: false, connected: false, ready: false }
    s[3] = { human: false, connected: false, ready: false }
    expect(pendingReady(s)).toEqual([0, 1])
  })

  it('a quien se ha desconectado tampoco: su marcha no congela la mesa', () => {
    const s = humanos()
    s[1]!.connected = false
    expect(pendingReady(s)).toEqual([0, 2, 3])
  })

  it('en una partida de solo bots no se espera a nadie', () => {
    const s: ReadySeat[] = [0, 1, 2, 3].map(() => ({
      human: false, connected: false, ready: false,
    }))
    expect(pendingReady(s)).toEqual([])
    // y por tanto se reparte al instante, sin abrir siquiera la espera
    expect(canAdvance(s, 0, AHORA)).toBe(true)
  })
})

describe('cuándo se reparte la mano siguiente', () => {
  it('no se reparte mientras falte alguien por confirmar', () => {
    const s = humanos()
    s[0]!.ready = true
    s[1]!.ready = true
    expect(canAdvance(s, AHORA + 15_000, AHORA)).toBe(false)
  })

  it('se reparte en cuanto confirman todos, sin agotar la gracia', () => {
    const s = humanos()
    for (const x of s) x.ready = true
    expect(canAdvance(s, AHORA + 15_000, AHORA)).toBe(true)
  })

  it('se reparte al vencer la gracia aunque falte alguien', () => {
    const s = humanos() // nadie ha confirmado
    expect(canAdvance(s, AHORA - 1, AHORA)).toBe(true)
  })

  it('un solo jugador ausente no bloquea: se le deja de esperar al irse', () => {
    const s = humanos()
    s[0]!.ready = true
    s[1]!.ready = true
    s[2]!.ready = true
    // el cuarto sigue sin confirmar → se espera
    expect(canAdvance(s, AHORA + 15_000, AHORA)).toBe(false)
    // pierde la conexión → ya no cuenta, y la mesa sigue sin esperar la gracia
    s[3]!.connected = false
    expect(canAdvance(s, AHORA + 15_000, AHORA)).toBe(true)
  })

  it('sin espera abierta (readyAt 0) manda solo quién falta', () => {
    const s = humanos()
    expect(canAdvance(s, 0, AHORA)).toBe(false)
    for (const x of s) x.ready = true
    expect(canAdvance(s, 0, AHORA)).toBe(true)
  })
})
