// Controlador de partida. Motor puro debajo; aquí solo orquestación,
// temporización e input.
//
// Dos modos, el mismo bucle:
//
//   LOCAL — este cliente es el árbitro. Juega `mySeat` (0) y mueve los otros
//           tres asientos con ai/bot.ts. Persiste el log en localStorage.
//   RED   — el árbitro es el cliente del ANFITRIÓN (net/host.ts). Este cliente
//           juega el asiento que le tocó (`net.seat`) y NO decide nada: recibe
//           el flujo autoritativo de acciones por `net` y lo reproduce. No toca
//           los bots ni el guardado local (la sala es el guardado).
//
// La diferencia se concentra en tres sitios: `submit` (lo que hace el input),
// `scheduleStep` (de dónde sale la siguiente acción) y `persist`.

import type { TileId, Tile34 } from '../core/tile'
import { tile34Of } from '../core/tile'
import { SEATS, type Seat } from '../core/seat'
import type { Action } from '../core/actions'
import type { HandState } from '../core/state'
import { reduce } from '../core/reducer'
import { newGame, advanceGame, type GameState } from '../core/game'
import { newLog, type GameLog } from '../core/replay'
import type { NetGame, Resume } from '../net/protocol'
import {
  tsumoScore, riichiOptions, ankanOptions, shouminkanOptions, canKyuushu,
  seatWaits, isTenpai, seatFuriten, remainingFor,
} from '../core/rules'
import type { Rng } from '../core/rng'
import { makePolicy, type BotPolicy } from '../ai/bot'
import { DEFAULT_PROFILE } from '../ai/profiles'
import { makeBotRngs, newBotSeed } from '../ai/bot-seats'
import { createStage } from './layout'
import { createTileView } from './tile-view'
import { TileLayer } from './tile-layer'
import { Hud, type ButtonDef } from './hud'
import { computePlacements } from './geometry'
import { showWinScreen } from './win-screen'
import { createCutIn, type CutIn } from './cut-in'
import { altForm, CHARACTER_STYLES, type Roster, type CharacterId } from './characters'
import { loadSettings, skillFor } from './settings'
import { saveGame, clearSave } from './persist'
import {
  loadStats, saveStats, recordAction, recordHand, recordGame, type Stats,
} from './stats'
import { finalResults } from '../core/results'
import { t } from './i18n'
import { initAudio, playMusic, playSfx, playVoice, playAlert } from './audio/audio'
import { GAME_TRACKS, type CallKind } from './audio/catalog'

// Sonido por tipo de acción. Los tres kan comparten la voz 'kan'.
//  - discard: solo click de ficha.
//  - chi/pon/kan/riichi/ron: voz del personaje.
//  - tsumo: voz (la pantalla de victoria hace el resto).
const VOICE_FOR: Partial<Record<Action['type'], CallKind>> = {
  riichi: 'riichi',
  tsumo: 'tsumo',
  ron: 'ron',
  pon: 'pon',
  chi: 'chi',
  daiminkan: 'kan',
  ankan: 'kan',
  shouminkan: 'kan',
}
const CLICKS: ReadonlySet<Action['type']> = new Set<Action['type']>(['discard'])

const DELAY = {
  draw: 120,
  botTurn: 420,
  botReaction: 260,
  autoTsumogiri: 650, // humano en riichi sin decisión real
  handEnd: 900, // agotamiento/aborto → tarjeta de fin de mano
}

// Ritmo de los beats de llamada (ms). El motor queda congelado mientras corren:
// es lo que da tiempo a leer qué acaba de pasar. Todo el afinado del ritmo se
// hace aquí.
const BEAT = {
  /** Panel de chi/pon/kan/riichi. */
  call: 750,
  /** Destello de la ficha declarada, ya sin panel. */
  riichiFlash: 550,
  /** Panel de ron/tsumo. */
  win: 900,
  /** Destape de la mano ganadora + ficha ganadora, antes de la pantalla. */
  reveal: 1400,
}

const NO_TILES: ReadonlySet<TileId> = new Set()

/**
 * Un beat: panel de cut-in, y opcionalmente un segundo tiempo de destape con el
 * panel ya retirado (que es cuando la mesa se puede leer). Un clic lo salta
 * entero.
 */
interface Beat {
  /** Al empezar: cut-in y voz. */
  start(): void
  /** Duración del panel. */
  panel: number
  /** Al retirar el panel: destellos sobre la mesa. */
  hold?(): void
  /** Duración del destape. 0 = el beat acaba con el panel. */
  after: number
  /** Al acabar, o al saltarse. */
  done(): void
}

// `Resume` y `NetGame` viven en net/protocol.ts (los comparten el cliente de
// red y los tests); se reexportan para que el resto de la UI importe de aquí.
export type { Resume, NetGame } from '../net/protocol'

export interface StartOptions {
  resume?: Resume
  net?: NetGame
}

/** Devuelve el disposer: mata timers y listeners sin soltar el DOM. */
export function startGame(
  root: HTMLElement,
  roster: Roster,
  onCharacters: () => void,
  opts: StartOptions = {},
): () => void {
  const { resume, net } = opts
  const settings = loadSettings()
  // Asiento propio: en local siempre el 0; en red, el que asignó la sala.
  const mySeat: Seat = net?.seat ?? 0
  // Una partida reanudada conserva SU reglamento, y una en red el de la sala:
  // en ninguno de los dos casos manda lo que haya ahora mismo en ajustes.
  const rules = net?.rules ?? resume?.log.rules ?? settings.rules
  const stage = createStage(root)
  const layer = new TileLayer(stage, createTileView(46, { aka: rules.aka }), onTileClick)
  // salir de la partida: hay que matar timers y listeners antes de soltar el DOM.
  // Abandonar es explícito: el guardado se borra (cerrar la pestaña no lo hace).
  const leave = (): void => {
    teardown()
    clearSave()
    onCharacters()
  }
  // onLanguageChange = render: re-pinta los textos dinámicos del HUD al vuelo
  const hud = new Hud(stage, mySeat, roster, settings, onButton, leave, render)
  const cutIn: CutIn = createCutIn(stage, mySeat, () => skipBeat())

  initAudio(settings) // mismo objeto que el Hud: cambiar el tema afecta al click
  // pista de partida al azar (Math.random, NUNCA el RNG semillado del core)
  playMusic(GAME_TRACKS[Math.floor(Math.random() * GAME_TRACKS.length)]!)

  // Log de acciones: es el guardado. Se rellena en apply() y se persiste tras
  // cada jugada; una partida = seed + reglamento + este log.
  // Con `net` + `resume` a la vez se entra a una partida YA EMPEZADA (reconexión
  // o llegar tarde): el log lo manda la sala y `replay` reconstruye el estado,
  // sin volver a pintar por pantalla las manos anteriores.
  let log: GameLog = resume?.log ?? newLog(net?.seed ?? Date.now() >>> 0, rules)
  let botSeed = net?.botSeed ?? resume?.botSeed ?? newBotSeed()
  let game: GameState = resume?.game ?? newGame(log.seed, {}, rules)

  // Una partida reanudada conserva SU dificultad, y una en red la de la sala.
  const difficulty = net?.difficulty ?? resume?.difficulty ?? settings.difficulty
  // Política por asiento: el ESTILO lo trae cada personaje (CHARACTER_STYLES), la
  // HABILIDAD la fija la dificultad global. En red no se usan: quien mueve los
  // asientos que no son míos (bots o rivales humanos) es el árbitro.
  const skill = skillFor(difficulty)
  const policies: Partial<Record<Seat, BotPolicy>> = {}
  for (const seat of SEATS) {
    if (seat === mySeat) continue
    policies[seat] = makePolicy({ style: CHARACTER_STYLES[roster[seat]!.id], skill })
  }
  const policyOf = (seat: Seat): BotPolicy =>
    policies[seat] ?? makePolicy(DEFAULT_PROFILE)

  // Un RNG por bot (ver ai/bot-seats.ts); se rearman al empezar y en cada rematch.
  let botRngs: Record<Seat, Rng> = makeBotRngs(botSeed)

  // En red el guardado es la sala: nada de localStorage (dos partidas online
  // simultáneas se pisarían, y el log local no es la fuente de verdad).
  const persist = (): void => {
    if (net) return
    saveGame({ log, roster: roster.map((c) => c.id), botSeed, difficulty })
  }

  // Estadísticas: se leen y se reescriben en cada suma. Son pocas escrituras
  // (una por acción del humano y una por mano) y así no hay estado que se
  // desincronice con otra pestaña abierta.
  const bumpStats = (f: (s: Stats) => Stats): void => saveStats(f(loadStats()))
  let riichiMode = false
  let chiPicker = false
  let lastDecisionPending = false
  let timer: ReturnType<typeof setTimeout> | null = null
  // Fichas destelleando durante el beat en curso (ficha de riichi, ganadora).
  let flash: ReadonlySet<TileId> = NO_TILES
  // Beat en curso: su función de cierre. Mientras no sea null, el juego está
  // congelado (scheduleStep se corta) y un clic o una tecla lo salta.
  let endBeat: (() => void) | null = null
  let beatTimer: ReturnType<typeof setTimeout> | null = null

  // --- red ---------------------------------------------------------------------
  // El árbitro no espera a nadie: puede mandar cinco acciones de golpe (robo,
  // descarte de un bot, tres pases) mientras aquí se está explicando una
  // llamada. Se encolan y se van aplicando con el MISMO ritmo que en local, para
  // que una partida online se vea igual que una de un jugador.
  const inbox: Action[] = []
  // Acciones ya aplicadas: es el `seq` que espera el árbitro para descartar
  // intenciones rancias (dobles clics, carreras). Al reanudar arranca en lo que
  // ya traía el log, no en cero.
  let seq = log.hands.reduce((n, h) => n + h.length, 0)
  // Intención mandada y aún sin confirmar: mientras tanto, el input se bloquea.
  // No hay predicción ni rollback; el turno de mahjong da tiempo de sobra.
  let awaitingAck = false
  /** En red: el árbitro juega por mí (me dio por ausente). Ver `onResumeTap`. */
  let autopilot = false
  // Plazo vivo que mandó el árbitro. Se guarda porque NO basta con pintarlo al
  // llegar: puede llegar mientras la cola de entrada aún tiene acciones
  // anteriores, y hay que volver a evaluarlo cuando el estado local se ponga al
  // día. `until` es de reloj LOCAL (el mensaje trae duración, no marca de tiempo).
  let netDeadline: { seats: readonly Seat[]; until: number } | null = null

  // --- render ------------------------------------------------------------------

  function render(): void {
    const s = game.hand
    const clickable = new Set<TileId>()
    const highlight = new Set<TileId>()
    const dim = new Set<TileId>()

    if (s.phase === 'discard' && s.turn === mySeat) {
      const st = s.seats[mySeat]!
      if (!riichiMode && s.drawn !== null) highlight.add(s.drawn)
      if (riichiMode) {
        // solo brillan (y se pueden clicar) los descartes que mantienen tenpai;
        // el resto de la mano se apaga
        const opts = new Set(riichiOptions(s))
        for (const id of opts) {
          clickable.add(id)
          highlight.add(id)
        }
        const pool = s.drawn !== null ? [...st.hand, s.drawn] : [...st.hand]
        for (const id of pool) if (!opts.has(id)) dim.add(id)
      } else if (st.riichi > 0) {
        if (s.drawn !== null) clickable.add(s.drawn)
      } else {
        const pool = s.drawn !== null ? [...st.hand, s.drawn] : [...st.hand]
        for (const id of pool) {
          if (s.justCalled !== null && tile34Of(id) === s.justCalled) continue
          clickable.add(id)
        }
      }
    }

    // llamada pendiente del humano: se apagan todos los descartes menos el que
    // desencadenó la oferta, para que se vea qué ficha se llama
    if (pendingHumanOffer(s)) {
      const called = s.reaction!.tile
      for (const seat of SEATS) {
        for (const id of s.seats[seat]!.pond) if (id !== called) dim.add(id)
      }
    }

    // jugada en vuelo hacia el árbitro: no se puede tocar nada más hasta que
    // vuelva confirmada (o la descarte por rancia y llegue otra cosa)
    if (awaitingAck) clickable.clear()

    layer.update(
      computePlacements(s, {
        human: mySeat,
        revealAll: s.phase === 'ended',
        clickable,
        highlight,
        dim,
        flash,
      }),
    )
    // tira de esperas: sobre la mano de 13 (sin la robada) = "tus esperas tras
    // tu último descarte"; el tenpai formal puede incluir esperas sin yaku
    const showWaits = settings.showWaits && s.phase !== 'ended' && isTenpai(s, mySeat)
    const remaining = showWaits ? remainingFor(s, mySeat) : null
    hud.update(s, {
      kyoku: game.kyoku,
      buttons: humanButtons(s),
      chiOptions: humanChiOptions(s),
      turnLabel: turnLabel(s),
      waits: showWaits
        ? seatWaits(s, mySeat).map((w) => ({ tile: w, live: remaining![w]! }))
        : null,
      furiten: showWaits && seatFuriten(s, mySeat),
    })
    cutIn.refresh() // el rótulo visible sigue al cambio de idioma en caliente
    const pending = humanDecisionPending(s)
    if (pending && !lastDecisionPending) playAlert()
    lastDecisionPending = pending
  }

  function turnLabel(s: HandState): string | null {
    if (s.phase === 'ended') return null
    if (riichiMode) return t('game.riichi-choose')
    if (s.phase === 'discard' && s.turn === mySeat) return t('game.your-turn')
    if (s.phase === 'reaction' && pendingHumanOffer(s)) {
      return chiPicker ? t('game.choose-chi') : t('game.call')
    }
    return null
  }

  function humanButtons(s: HandState): ButtonDef[] {
    const out: ButtonDef[] = []
    if (awaitingAck) return out // jugada en vuelo: nada que pulsar
    if (s.phase === 'discard' && s.turn === mySeat) {
      if (riichiMode) return [{ label: t('game.btn.cancel'), kind: 'riichi-cancel', style: 'muted' }]
      if (tsumoScore(s)) out.push({ label: t('game.btn.tsumo'), kind: 'tsumo', style: 'primary' })
      if (riichiOptions(s).length > 0) out.push({ label: t('game.btn.riichi'), kind: 'riichi-mode', style: 'primary' })
      if (ankanOptions(s).length > 0 || shouminkanOptions(s).length > 0) {
        out.push({ label: t('game.btn.kan'), kind: 'kan' })
      }
      if (canKyuushu(s)) out.push({ label: t('game.btn.kyuushu'), kind: 'kyuushu', style: 'muted' })
      return out
    }
    const offer = pendingHumanOffer(s)
    if (offer) {
      if (offer.ron) out.push({ label: t('game.btn.ron'), kind: 'ron', style: 'primary' })
      if (offer.pon) out.push({ label: t('game.btn.pon'), kind: 'pon' })
      if (offer.kan) out.push({ label: t('game.btn.kan'), kind: 'daiminkan' })
      if (offer.chi.length > 0) {
        // con el picker abierto, BACK ocupa el sitio de CHI
        out.push(chiPicker
          ? { label: t('game.btn.back'), kind: 'chi-cancel', style: 'muted' }
          : { label: t('game.btn.chi'), kind: 'chi-open' })
      }
      out.push({ label: t('game.btn.pass'), kind: 'pass', style: 'muted' })
    }
    return out
  }

  /** Opciones del picker de chi (fila superior); vacío si el picker está cerrado. */
  function humanChiOptions(s: HandState): ButtonDef[] {
    if (!chiPicker) return []
    const offer = pendingHumanOffer(s)
    if (!offer) return []
    return offer.chi.map((start) => ({
      label: '',
      kind: `chi:${start}`,
      tiles: chiOptionTiles(s, start),
    }))
  }

  /**
   * Fichas concretas de la corrida `start..start+2`: la llamada es la del
   * descarte; las otras dos se buscan en mano desde el final, el mismo criterio
   * que `takeFromHand` del reducer, para que el aka mostrado coincida con el
   * meld que se formará.
   */
  function chiOptionTiles(s: HandState, start: Tile34): TileId[] {
    const called = s.reaction!.tile
    const hand = s.seats[mySeat]!.hand
    const fromHand = (t: Tile34): TileId => {
      for (let i = hand.length - 1; i >= 0; i--) {
        if (tile34Of(hand[i]!) === t) return hand[i]!
      }
      return (t * 4) as TileId // inalcanzable: la oferta garantiza la copia
    }
    return [start, start + 1, start + 2].map((t) =>
      t === tile34Of(called) ? called : fromHand(t),
    )
  }

  function pendingHumanOffer(s: HandState) {
    if (s.phase !== 'reaction' || !s.reaction) return null
    const offer = s.reaction.offers.find((o) => o.seat === mySeat)
    if (!offer || s.reaction.responses[mySeat] !== null) return null
    return offer
  }

  /** Hay una opción especial para que el humano elija. */
  function humanDecisionPending(s: HandState): boolean {
    if (s.phase === 'reaction') return pendingHumanOffer(s) !== null
    if (s.phase === 'discard' && s.turn === mySeat) {
      return (
        Boolean(tsumoScore(s)) ||
        riichiOptions(s).length > 0 ||
        ankanOptions(s).length > 0 ||
        shouminkanOptions(s).length > 0 ||
        canKyuushu(s)
      )
    }
    return false
  }

  // --- motor -------------------------------------------------------------------

  /**
   * Lo que hace el INPUT del jugador. En local se aplica en el acto (este
   * cliente es el árbitro); en red se manda y se espera a que vuelva por el
   * flujo autoritativo, que es cuando se aplica de verdad.
   */
  function submit(action: Action): void {
    if (!net) {
      apply(action)
      return
    }
    if (awaitingAck) return // ya hay una intención en vuelo
    awaitingAck = true
    net.send(action, seq)
    render() // repinta sin botones: la jugada está en el aire
  }

  /** Vía AUTORITATIVA: la única que toca el estado. */
  function apply(action: Action): void {
    // asiento que actúa: en reacciones lo lleva la acción; en el resto es el
    // turno actual (antes de reducir, que puede cambiarlo)
    const actor: Seat = 'seat' in action ? action.seat : game.hand.turn
    chiPicker = false // cualquier acción resuelve (o invalida) la reacción
    try {
      game = { ...game, hand: reduce(game.hand, action) }
    } catch (err) {
      // los botones/clicks solo ofrecen jugadas legales; esto es defensa
      console.error('acción rechazada', action, err)
      return
    }
    // el log solo recoge acciones ACEPTADAS (una rechazada rompería el replay);
    // van todas, también las de los bots y el robo automático
    log.hands[log.hands.length - 1]!.push(action)
    seq++
    awaitingAck = false
    refreshDeadline()
    // Llegó jugada: la mesa ya se mueve, así que sobra el aviso de espera.
    hud.setWaitingOthers(0)
    persist()
    if (actor === mySeat) bumpStats((s) => recordAction(s, action))
    if (CLICKS.has(action.type)) playSfx('tile-click')

    // La voz de la llamada ya no suena aquí: va dentro del beat, para que
    // entre con el panel y no antes.
    const beat = beatFor(action, actor)
    if (beat) {
      runBeat(beat)
      return
    }
    render()
    scheduleStep()
  }

  // --- cuenta atrás de red ---------------------------------------------------------

  /** Asientos que deben una decisión AHORA, según el estado local. */
  function seatsAwaited(s: HandState): Seat[] {
    if (s.phase === 'discard') return [s.turn]
    if (s.phase === 'reaction' && s.reaction) {
      const r = s.reaction
      return r.offers.filter((o) => r.responses[o.seat] === null).map((o) => o.seat)
    }
    return []
  }

  /**
   * Decide si el reloj sigue en pie, cruzando el plazo del árbitro con el
   * estado que este cliente ya tiene aplicado.
   *
   * Hace falta cruzarlo porque los dos van a su ritmo: el `deadline` puede
   * llegar mientras la cola de entrada todavía tiene jugadas anteriores sin
   * aplicar. Borrar el reloj en cada acción lo hacía parpadear y desaparecer.
   */
  function refreshDeadline(): void {
    if (!netDeadline) return
    if (Date.now() >= netDeadline.until) {
      // Venció: el árbitro ya estará jugando por quien fuera.
      netDeadline = null
      hud.clearDeadline()
      return
    }
    const owing = seatsAwaited(game.hand)
    const still = netDeadline.seats.filter((x) => owing.includes(x))
    if (still.length === 0) hud.clearDeadline()
    else hud.setDeadline(still, netDeadline.until)
  }

  // --- beats de llamada -----------------------------------------------------------

  /** Cut-in + voz del personaje de un asiento. La viñeta sale en SU esquina. */
  function announce(seat: Seat, call: CallKind): void {
    const c = roster[seat]!
    playVoice(c.id as CharacterId, call)
    cutIn.show(seat, c, call, altForm(c, game.hand.seats[seat]!.riichi))
  }

  function beatFor(action: Action, actor: Seat): Beat | null {
    const s = game.hand
    const end = s.end

    // Victoria: manda el estado ya reducido, no la acción. Así el ganador sale
    // de `end.winner` — que con atamahane puede NO ser quien acaba de actuar, y
    // en un ron resuelto por el `pass` de un tercero tampoco lo es.
    if (end && (end.type === 'tsumo' || end.type === 'ron')) {
      const { winner, winTile } = end
      const call: CallKind = end.type === 'tsumo' ? 'tsumo' : 'ron'
      return {
        start: () => announce(winner, call),
        panel: BEAT.win,
        // revealAll ya está activo (phase === 'ended'): al retirar el panel la
        // mesa queda destapada y sólo hay que señalar la ficha ganadora. En ron
        // sigue en el pond del que descartó (executeCall no la retira nunca en
        // ron); en tsumo es la robada, ya separada por el hueco de la mano.
        hold: () => { flash = new Set([winTile]) },
        after: BEAT.reveal,
        done: showEnd,
      }
    }

    // Un ron que aún no cierra la mano (faltan respuestas de otros asientos) no
    // se anuncia: lo hará el beat de victoria, que además sabe quién ganó de
    // verdad tras el atamahane.
    if (action.type === 'ron') return null

    const call = VOICE_FOR[action.type]
    if (!call) return null

    if (action.type === 'riichi') {
      // Por TileId, nunca por índice del pond: riichiIndex no se fija hasta que
      // el descarte se resuelve (y si le hacen ron, no llega a fijarse).
      const tile = action.tile
      return {
        start: () => announce(actor, 'riichi'),
        panel: BEAT.call,
        hold: () => { flash = new Set([tile]) },
        after: BEAT.riichiFlash,
        done: scheduleStep,
      }
    }

    return {
      start: () => announce(actor, call),
      panel: BEAT.call,
      after: 0,
      done: scheduleStep,
    }
  }

  function runBeat(b: Beat): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    // La identidad de `finish` hace de testigo: si arranca otro beat, los
    // temporizadores del viejo se encuentran `endBeat` cambiado y se callan.
    const finish = (): void => {
      if (endBeat !== finish) return
      endBeat = null
      if (beatTimer !== null) {
        clearTimeout(beatTimer)
        beatTimer = null
      }
      cutIn.hide()
      flash = NO_TILES
      render()
      b.done()
    }
    endBeat = finish

    b.start()
    render()
    beatTimer = setTimeout(() => {
      if (endBeat !== finish) return
      cutIn.dismissPanel()
      b.hold?.()
      render()
      if (b.after > 0) {
        beatTimer = setTimeout(finish, b.after)
      } else {
        beatTimer = null
        finish()
      }
    }, b.panel)
  }

  /** Un clic o una tecla cortan el beat entero y siguen. */
  function skipBeat(): void {
    endBeat?.()
  }

  /** Si la IA lleva mi asiento por ausencia, un toque pide recuperarlo. */
  function onResumeTap(): void {
    if (!autopilot || !net) return
    net.resume()
  }

  function onKeySkip(ev: KeyboardEvent): void {
    onResumeTap()
    if (endBeat === null) return
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Escape') return
    ev.preventDefault()
    skipBeat()
  }

  function teardown(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (beatTimer !== null) {
      clearTimeout(beatTimer)
      beatTimer = null
    }
    endBeat = null
    hud.clearDeadline() // su interval sobreviviría al DOM si no se para aquí
    window.removeEventListener('keydown', onKeySkip)
    window.removeEventListener('pointerdown', onResumeTap, true)
    cutIn.destroy()
    net?.close()
  }

  /**
   * Único sitio que arma el temporizador del bucle. Se anula al disparar, así
   * que `timer === null` significa siempre "no hay nada pendiente" — de eso
   * depende la bomba de la cola de red para no atascarse ni pisarse.
   */
  function setStep(fn: () => void, ms: number): void {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn()
    }, ms)
  }

  /**
   * Ritmo con el que se aplica una acción llegada de la red. Reutiliza la tabla
   * DELAY para que el pulso de una partida online sea el de siempre: sin esto
   * las jugadas de los rivales aparecerían de golpe.
   */
  function delayFor(action: Action): number {
    if (action.type === 'draw') return DELAY.draw
    if ('seat' in action) return DELAY.botReaction
    return DELAY.botTurn
  }

  function scheduleStep(): void {
    if (endBeat !== null) return // congelado mientras se explica la jugada
    const s = game.hand

    if (s.phase === 'ended') {
      setStep(showEnd, DELAY.handEnd)
      return
    }

    // En red este cliente no decide NADA: ni el robo automático ni las jugadas
    // de los demás asientos. Solo desagua la cola del árbitro y, si está vacía,
    // espera (a la red, o a que el jugador toque una ficha).
    if (net) {
      const next = inbox.shift()
      if (next) setStep(() => apply(next), delayFor(next))
      return
    }

    if (s.phase === 'draw') {
      setStep(() => apply({ type: 'draw' }), DELAY.draw)
      return
    }
    if (s.phase === 'discard') {
      if (s.turn !== mySeat) {
        const seat = s.turn
        setStep(() => apply(policyOf(seat).turn(game.hand, botRngs[seat])), DELAY.botTurn)
      } else if (s.seats[mySeat]!.riichi > 0) {
        // en riichi: si no hay decisión real (tsumo/kan), tsumogiri automático
        if (!tsumoScore(s) && ankanOptions(s).length === 0) {
          setStep(() => apply({ type: 'discard', tile: game.hand.drawn! }), DELAY.autoTsumogiri)
        }
      }
      return
    }
    // reaction: contestan los bots pendientes; si le toca al humano, se espera
    const r = s.reaction!
    const next = r.offers.find((o) => r.responses[o.seat] === null)
    if (next && next.seat !== mySeat) {
      const seat = next.seat
      setStep(() => apply(policyOf(seat).reaction(game.hand, next, botRngs[seat])), DELAY.botReaction)
    }
  }

  // --- fin de mano / partida ------------------------------------------------------

  function showEnd(): void {
    const s = game.hand
    bumpStats((st) => recordHand(st, s, mySeat))
    const afterContinue = (): void => {
      hud.hideOverlay()
      // En red el árbitro no reparte hasta que TODOS cierren su pantalla de
      // resultados; avisar es lo que le desbloquea. El estado local sí avanza
      // ya: las acciones de la mano siguiente llegarán cuando toque y se
      // aplicarán desde la cola.
      net?.ready()
      game = advanceGame(game)
      if (game.finished) {
        clearSave() // no hay nada que reanudar
        const results = finalResults(game.hand.seats.map((st) => st.points), game.hand.rules)
        bumpStats((st) => recordGame(st, results, mySeat))
        // En red la revancha tendría que negociarla la sala: de momento el único
        // botón es MENÚ (se pasa null y el HUD oculta el de revancha).
        const rematch = net
          ? null
          : (): void => {
              // rematch con el mismo roster y el mismo reglamento
              hud.hideOverlay()
              log = newLog(Date.now() >>> 0, game.hand.rules)
              botSeed = newBotSeed()
              botRngs = makeBotRngs(botSeed)
              game = newGame(log.seed, {}, log.rules)
              seq = 0
              persist()
              riichiMode = false
              render()
              scheduleStep()
            }
        hud.showGameEnd(game.hand, rematch, leave)
        return
      }
      log.hands.push([]) // la mano siguiente empieza su propio tramo del log
      persist()
      riichiMode = false
      render()
      scheduleStep()
    }

    if (s.end!.type === 'tsumo' || s.end!.type === 'ron') {
      showWinScreen(stage, s, game.kyoku, roster, afterContinue, mySeat)
    } else {
      hud.showHandEnd(s, game.kyoku, afterContinue)
    }
  }

  // --- input -------------------------------------------------------------------

  function onTileClick(id: TileId): void {
    const s = game.hand
    if (awaitingAck) return
    if (s.phase !== 'discard' || s.turn !== mySeat) return
    if (riichiMode) {
      riichiMode = false
      submit({ type: 'riichi', tile: id })
    } else {
      submit({ type: 'discard', tile: id })
    }
  }

  function onButton(kind: string): void {
    const s = game.hand
    switch (kind) {
      case 'tsumo': return submit({ type: 'tsumo' })
      case 'riichi-mode':
        riichiMode = true
        render()
        return
      case 'riichi-cancel':
        riichiMode = false
        render()
        return
      case 'kan': {
        const ak = ankanOptions(s)
        if (ak.length > 0) return submit({ type: 'ankan', tile34: ak[0]! })
        const sk = shouminkanOptions(s)
        if (sk.length > 0) return submit({ type: 'shouminkan', tile: sk[0]! })
        return
      }
      case 'kyuushu': return submit({ type: 'kyuushu' })
      case 'chi-open': {
        const offer = pendingHumanOffer(s)
        if (!offer || offer.chi.length === 0) return
        if (offer.chi.length === 1) {
          return submit({ type: 'chi', seat: mySeat, start: offer.chi[0]! })
        }
        chiPicker = true
        render()
        return
      }
      case 'chi-cancel':
        chiPicker = false
        render()
        return
      case 'ron': return submit({ type: 'ron', seat: mySeat })
      case 'pon': return submit({ type: 'pon', seat: mySeat })
      case 'daiminkan': return submit({ type: 'daiminkan', seat: mySeat })
      case 'pass': return submit({ type: 'pass', seat: mySeat })
      default:
        if (kind.startsWith('chi:')) {
          return submit({ type: 'chi', seat: mySeat, start: Number(kind.slice(4)) })
        }
    }
  }

  // --- arranque -----------------------------------------------------------------

  if (net) {
    hud.setPlayers(net.players)
    net.onDeadline((seats, ms) => {
      netDeadline = { seats, until: Date.now() + ms }
      refreshDeadline()
    })
    // Fin de mano: solo se avisa a quien YA cerró su pantalla (si no, el aviso
    // saldría por detrás de la de resultados, que es donde sigue el jugador).
    net.onHandEnd((waiting) => {
      hud.setWaitingOthers(waiting.includes(mySeat) ? 0 : waiting.length)
    })
    net.onAction((a) => {
      inbox.push(a)
      // Si el bucle estaba parado esperando a la red, lo despierta. Si hay un
      // beat corriendo, scheduleStep se corta solo y la cola espera a que acabe.
      // Con la mano acabada tampoco: la cola espera a que el jugador pulse
      // CONTINUAR (si no, se volvería a pintar la pantalla de resultados).
      if (timer === null && game.hand.phase !== 'ended') scheduleStep()
    })
    // El árbitro tiró la intención (rancia, o ilegal): se desbloquea el input
    // sin esperar a que llegue otra jugada.
    net.onNack(() => {
      if (!awaitingAck) return
      awaitingAck = false
      render()
    })
    // 'autopilot': se le dio por ausente y el árbitro juega por él. Cualquier
    // toque o tecla pide el mando de vuelta (`resume`); el aviso se quita solo
    // cuando el árbitro publica que ya no lo lleva.
    net.onNotice((n) => {
      autopilot = n === 'autopilot'
      hud.setNotice(n === null ? null : t(n === 'host-away' ? 'mp.host-away' : 'mp.autopilot'))
    })
    net.onClose((code) => {
      teardown()
      hud.showNetError(t(`mp.error.${code.replace(/_/g, '-')}` as Parameters<typeof t>[0]), onCharacters)
    })
  }

  window.addEventListener('keydown', onKeySkip)
  window.addEventListener('pointerdown', onResumeTap, true)
  render()
  scheduleStep()
  return teardown
}
