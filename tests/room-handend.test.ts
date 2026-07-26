// Sincronización del fin de mano.
//
// El árbitro NO reparte la mano siguiente en cuanto acaba la anterior: espera a
// que todos cierren su pantalla de resultados, con un tope para que un ausente
// no congele la mesa. Sin esa espera, quien se entretuviera leyendo la pantalla
// de victoria perdía turnos sin verlos pasar, porque su reloj de decisión ya
// corría por detrás.
//
// La decisión vive en `canAdvance`/`pendingReady` de worker/room-logic.ts, que
// son puras justamente para poder probarlas aquí sin levantar workerd.

import { describe, it, expect } from 'vitest'
import { pendingReady, canAdvance, nextAlarm, type ReadySeat } from '../worker/room-logic'
import type { Seat } from '../src/core/seat'

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

describe('la única alarma del objeto', () => {
  const GRACIA = 5_000

  it('coge el vencimiento más próximo de los que están activos', () => {
    // plazo de decisión el más cercano
    expect(nextAlarm(AHORA + 1_000, AHORA + 9_000, AHORA + 99_000, GRACIA))
      .toBe(AHORA + 1_000 + GRACIA)
    // gracia de fin de mano la más cercana
    expect(nextAlarm(0, AHORA + 2_000, AHORA + 99_000, GRACIA)).toBe(AHORA + 2_000)
  })

  it('un plazo a 0 está apagado y no cuenta', () => {
    expect(nextAlarm(0, 0, AHORA + 60_000, GRACIA)).toBe(AHORA + 60_000)
  })

  it('REGRESIÓN: un plazo de decisión muerto no debe arrastrarse', () => {
    // Esto colgó la sala: al abrir la espera de fin de mano quedaba un
    // `deadlineAt` ya vencido, la alarma se armaba en el pasado, saltaba al
    // instante sin nada que hacer y se rearmaba igual, en bucle.
    const vencido = AHORA - 30_000
    expect(nextAlarm(vencido, AHORA + 15_000, AHORA + 99_000, GRACIA)).toBeLessThan(AHORA)
    // El arreglo es apagarlo (#pump lo pone a 0 en cada pasada): así la alarma
    // salta cuando toca de verdad, al vencer la gracia.
    expect(nextAlarm(0, AHORA + 15_000, AHORA + 99_000, GRACIA)).toBe(AHORA + 15_000)
  })
})

describe('regresión: el bug que esto arregla', () => {
  it('con humanos conectados NUNCA se reparte de inmediato', () => {
    // Antes el árbitro llamaba a advanceGame en cuanto la mano acababa, sin
    // preguntar a nadie: ese `true` era el bug.
    const s = humanos()
    expect(canAdvance(s, 0, AHORA)).toBe(false)
  })

  it('el que ya confirmó no vuelve a aparecer como pendiente', () => {
    const s = humanos()
    s[0]!.ready = true
    const espera: Seat[] = pendingReady(s)
    expect(espera).not.toContain(0)
  })
})
