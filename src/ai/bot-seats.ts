// Un RNG por bot, derivado de una sola semilla de partida (`botSeed`).
//
// Cada asiento sala la semilla con una constante propia para que el ruido de su
// estilo sea independiente del de los demás, y reproducible: reanudar una
// partida rearma exactamente los mismos streams. El replay no usa el RNG, así
// que afinar los perfiles nunca rompe un guardado.
//
// Vive en ai/ (y no dentro del controlador) porque en multijugador quien tira
// de los bots es el servidor: cliente y Durable Object tienen que derivar los
// mismos streams a partir del mismo `botSeed`.

import { makeRng, type Rng } from '../core/rng'
import type { Seat } from '../core/seat'

const RNG_SALT: Record<Seat, number> = {
  0: 0x00000000, 1: 0x1b873593, 2: 0xcc9e2d51, 3: 0x85ebca6b,
}

export function makeBotRngs(botSeed: number): Record<Seat, Rng> {
  return {
    0: makeRng((botSeed ^ RNG_SALT[0]) >>> 0),
    1: makeRng((botSeed ^ RNG_SALT[1]) >>> 0),
    2: makeRng((botSeed ^ RNG_SALT[2]) >>> 0),
    3: makeRng((botSeed ^ RNG_SALT[3]) >>> 0),
  }
}

/** Semilla nueva para los bots de una partida. */
export function newBotSeed(): number {
  return (Date.now() ^ 0xc0ffee) >>> 0
}
