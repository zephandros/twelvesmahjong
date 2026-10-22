// Cerebro del árbitro, en funciones PURAS. `RoomHost` (host.ts) es la cáscara:
// almacén, timers y presencia. Todo lo que hay que razonar vive aquí,
// para poder testearlo con vitest en node sin levantar workerd — la misma
// filosofía que el núcleo, que se testea sin DOM.
//
// El árbitro NO reimplementa el mahjong: usa `reduce`, que ya lanza ante una
// acción ilegal. Lo único que este módulo añade es lo que el núcleo no sabe:
// QUIÉN manda cada acción.

import type { Action } from '../core/actions'
import type { HandState } from '../core/state'
import type { Seat } from '../core/seat'
import { SEATS } from '../core/seat'
import type { GameState } from '../core/game'
import type { BotPolicy } from '../ai/bot'
import type { Rng } from '../core/rng'

/**
 * Asiento que ejecuta una acción.
 *
 * Las siete acciones de turno NO llevan `seat` (ver core/actions.ts): su actor
 * es implícitamente `state.turn`. Las de reacción sí lo llevan, porque las
 * emite un asiento distinto al del turno.
 */
export function actorOf(s: HandState, a: Action): Seat {
  return 'seat' in a ? a.seat : s.turn
}

/**
 * ¿Puede `seat` emitir `a` en este estado? ESTA FUNCIÓN ES TODA LA SUPERFICIE
 * ANTI-TRAMPAS del multijugador: el núcleo no tiene noción de identidad y
 * `reduce` se cree cualquier `action.seat` que le pasen.
 *
 * Solo comprueba la ATRIBUCIÓN. La legalidad de la jugada (kuikae, riichi sin
 * tenpai, ron sin yaku, chi imposible…) la sigue rechazando `reduce` lanzando.
 */
export function authorize(s: HandState, seat: Seat, a: Action): boolean {
  // El robo lo genera el servidor. Si se aceptara de un cliente, cualquiera
  // podría forzar robos fuera de ritmo desde la consola del navegador.
  if (a.type === 'draw') return false
  if (s.phase === 'ended') return false

  if ('seat' in a) {
    // reacción: solo la tuya, solo si tienes oferta y no has contestado ya
    if (a.seat !== seat) return false
    if (s.phase !== 'reaction' || !s.reaction) return false
    const offer = s.reaction.offers.find((o) => o.seat === seat)
    return offer !== undefined && s.reaction.responses[seat] === null
  }

  // acción de turno: solo el asiento en turno, y solo en fase de descarte
  return s.phase === 'discard' && s.turn === seat
}

/** Lo que el árbitro hace a continuación. Espejo sin timers de ai/sim.ts. */
export type Step =
  /** Acción que genera el propio servidor: el robo, o la jugada de un asiento automático. */
  | { kind: 'action'; action: Action }
  /** La mano terminó: toca advanceGame (o cerrar la partida). */
  | { kind: 'advance' }
  /** Se espera a un humano conectado; hay que armar su plazo. */
  | { kind: 'await'; seat: Seat }
  /** La partida se acabó. */
  | { kind: 'finished' }

/**
 * Un paso del bucle autoritativo.
 *
 * `auto` son los asientos que mueve el servidor: los bots de siempre, y también
 * los humanos a los que se les agotó el plazo (relevo por desconexión). Que el
 * relevo sea "meter el asiento en `auto`" es lo que hace que no haga falta
 * código nuevo para la desconexión: es el mismo camino que un bot.
 *
 * NO hay pausas aquí. El servidor emite tan rápido como calcula; el ritmo
 * (DELAY/BEAT) lo pone cada cliente al reproducir.
 */
export function nextStep(
  g: GameState,
  auto: ReadonlySet<Seat>,
  policyOf: (seat: Seat) => BotPolicy,
  rngOf: (seat: Seat) => Rng,
): Step {
  if (g.finished) return { kind: 'finished' }
  const s = g.hand

  if (s.phase === 'ended') return { kind: 'advance' }
  if (s.phase === 'draw') return { kind: 'action', action: { type: 'draw' } }

  if (s.phase === 'discard') {
    const seat = s.turn
    if (!auto.has(seat)) return { kind: 'await', seat }
    return { kind: 'action', action: policyOf(seat).turn(s, rngOf(seat)) }
  }

  // reaction: el núcleo acepta las respuestas en cualquier orden y no resuelve
  // hasta tenerlas todas, así que se contesta primero por los automáticos y se
  // espera a los humanos que falten.
  const r = s.reaction!
  const pending = r.offers.filter((o) => r.responses[o.seat] === null)
  const bot = pending.find((o) => auto.has(o.seat))
  if (bot) {
    return { kind: 'action', action: policyOf(bot.seat).reaction(s, bot, rngOf(bot.seat)) }
  }
  // Solo quedan humanos: se espera al primero por orden de asiento. Da igual
  // cuál, porque el reducer no resuelve hasta que contesten todos.
  return { kind: 'await', seat: pending[0]!.seat }
}

/**
 * Asientos a los que el árbitro está esperando ahora mismo. Es lo que hay que
 * poner en el plazo: en una reacción pueden ser VARIOS a la vez, y todos
 * cuentan contra el mismo reloj.
 */
export function waitingOn(g: GameState, auto: ReadonlySet<Seat>): Seat[] {
  if (g.finished) return []
  const s = g.hand
  if (s.phase === 'discard') return auto.has(s.turn) ? [] : [s.turn]
  if (s.phase === 'reaction' && s.reaction) {
    return s.reaction.offers
      .filter((o) => s.reaction!.responses[o.seat] === null && !auto.has(o.seat))
      .map((o) => o.seat)
  }
  return []
}

/**
 * Qué juega el servidor por un asiento cuyo plazo venció. En reacción es
 * SIEMPRE `pass`: pasar nunca perjudica a quien no estaba, mientras que dejar
 * que la IA cante un ron por él le cambiaría la partida sin su permiso.
 */
export function timeoutAction(s: HandState, seat: Seat): Action | null {
  if (s.phase === 'reaction' && s.reaction) {
    const offer = s.reaction.offers.find((o) => o.seat === seat)
    if (!offer || s.reaction.responses[seat] !== null) return null
    return { type: 'pass', seat }
  }
  return null
}

/** Los cuatro asientos, para construir conjuntos de `auto`. */
export const ALL_SEATS: readonly Seat[] = SEATS

// --- sincronización del fin de mano ------------------------------------------------

/** Lo que hace falta saber de un asiento para decidir si se le espera. */
export interface ReadySeat {
  /** Lo lleva una persona (no es bot de relleno), esté ausente o no. */
  human: boolean
  connected: boolean
  /** Ya cerró su pantalla de resultados. */
  ready: boolean
  /**
   * Dado por ausente (varios plazos seguidos sin contestar): la IA juega por
   * él, pero mientras siga conectado se le sigue esperando al final de la
   * mano, dentro de la gracia. Lo que NO puede es ser el único que tire de
   * la mesa: ver `anyoneActive`.
   */
  absent?: boolean
}

/**
 * ¿Hay alguien de verdad al mando (humano, conectado y no ausente)?
 *
 * Si no lo hay, no tiene sentido repartir: nadie vería la mano, y con todos
 * los asientos automáticos el árbitro encadenaría una mano tras otra hasta
 * acabar la partida en un solo bucle (visto con un único humano ausente). La
 * mesa se queda esperando a que alguien vuelva (toque, continuar o presencia).
 */
export function anyoneActive(seats: readonly ReadySeat[]): boolean {
  return seats.some((s) => s.human && s.connected && !s.absent)
}

/**
 * ¿Hay algún humano activo que NO sea de los que se está esperando?
 *
 * Los plazos existen para no bloquear a los DEMÁS: si quien falta por decidir
 * es el único humano activo (solo contra bots, o los otros ya se fueron), no
 * hay a quién proteger, y el árbitro ni corre el reloj ni juega por él — le
 * espera como en una partida local. Sin esto, un jugador solo que se levanta
 * un rato volvía a una mano jugada entera por la IA.
 */
export function othersActive(seats: readonly ReadySeat[], waiting: readonly Seat[]): boolean {
  return seats.some(
    (s, i) => s.human && s.connected && !s.absent && !waiting.includes(i as Seat),
  )
}

/**
 * Asientos que faltan por confirmar el fin de mano.
 *
 * A la IA no se le espera, ni a quien no está conectado: si se esperara a todo
 * el mundo, un solo abandono congelaría la mesa hasta agotar la gracia entera.
 */
export function pendingReady(seats: readonly ReadySeat[]): Seat[] {
  return SEATS.filter((seat) => {
    const s = seats[seat]
    return s !== undefined && s.human && s.connected && !s.ready
  })
}

/**
 * ¿Se puede repartir ya la mano siguiente?
 *
 * ESTA es la función que arregla el fallo de origen: antes el árbitro llamaba a
 * `advanceGame` en cuanto la mano acababa, sin preguntar a nadie, y quien se
 * entretuviera leyendo la pantalla de victoria perdía turnos sin verlos pasar
 * (su reloj de decisión ya corría por detrás, y encima invisible).
 *
 * `readyAt` es el vencimiento de la gracia, o 0 si aún no se ha abierto espera.
 */
export function canAdvance(
  seats: readonly ReadySeat[],
  readyAt: number,
  now: number,
): boolean {
  // Se agotó la gracia: se reparte aunque falte alguien, para no colgar la
  // mesa… a quien sí está. Sin nadie activo no se reparte: se espera.
  if (readyAt > 0 && now >= readyAt && anyoneActive(seats)) return true
  return pendingReady(seats).length === 0
}
