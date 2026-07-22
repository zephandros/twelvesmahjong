// Controlador de partida: el humano juega el asiento 0, los bots (ai/bot.ts)
// los demás. Motor puro debajo; aquí solo orquestación, temporización e input.

import type { TileId, Tile34 } from '../core/tile'
import { tile34Of } from '../core/tile'
import { SEATS, type Seat } from '../core/seat'
import type { Action } from '../core/actions'
import type { HandState } from '../core/state'
import { reduce } from '../core/reducer'
import { newGame, advanceGame, type GameState } from '../core/game'
import { newLog, type GameLog } from '../core/replay'
import {
  tsumoScore, riichiOptions, ankanOptions, shouminkanOptions, canKyuushu,
  seatWaits, isTenpai, seatFuriten, remainingFor,
} from '../core/rules'
import { makeRng, type Rng } from '../core/rng'
import { botTurnAction, botReaction } from '../ai/bot'
import { createStage } from './layout'
import { createTileView } from './tile-view'
import { TileLayer } from './tile-layer'
import { Hud, type ButtonDef } from './hud'
import { computePlacements } from './geometry'
import { showWinScreen } from './win-screen'
import { createCutIn, type CutIn } from './cut-in'
import { altForm, type Roster, type CharacterId } from './characters'
import { loadSettings } from './settings'
import { saveGame, clearSave } from './persist'
import {
  loadStats, saveStats, recordAction, recordHand, recordGame, type Stats,
} from './stats'
import { finalResults } from '../core/results'
import { t } from './i18n'
import { initAudio, playMusic, playSfx, playVoice, playAlert } from './audio/audio'
import { GAME_TRACKS, type CallKind } from './audio/catalog'

const HUMAN: Seat = 0

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

/** Partida reanudada desde el guardado (ver ui/persist.ts). */
export interface Resume {
  game: GameState
  log: GameLog
  botSeed: number
}

export function startGame(
  root: HTMLElement,
  roster: Roster,
  onCharacters: () => void,
  resume?: Resume,
): void {
  const settings = loadSettings()
  // una partida reanudada conserva SU reglamento, no el que haya en ajustes
  const rules = resume?.log.rules ?? settings.rules
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
  const hud = new Hud(stage, HUMAN, roster, settings, onButton, leave, render)
  const cutIn: CutIn = createCutIn(stage, HUMAN, () => skipBeat())

  initAudio(settings) // mismo objeto que el Hud: cambiar el tema afecta al click
  // pista de partida al azar (Math.random, NUNCA el RNG semillado del core)
  playMusic(GAME_TRACKS[Math.floor(Math.random() * GAME_TRACKS.length)]!)

  // Log de acciones: es el guardado. Se rellena en apply() y se persiste tras
  // cada jugada; una partida = seed + reglamento + este log.
  let log: GameLog = resume?.log ?? newLog(Date.now() >>> 0, rules)
  let botSeed = resume?.botSeed ?? ((Date.now() ^ 0xc0ffee) >>> 0)
  let game: GameState = resume?.game ?? newGame(log.seed, {}, rules)
  let botRng: Rng = makeRng(botSeed)

  const persist = (): void =>
    saveGame({ log, roster: roster.map((c) => c.id), botSeed })

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

  // --- render ------------------------------------------------------------------

  function render(): void {
    const s = game.hand
    const clickable = new Set<TileId>()
    const highlight = new Set<TileId>()
    const dim = new Set<TileId>()

    if (s.phase === 'discard' && s.turn === HUMAN) {
      const st = s.seats[HUMAN]!
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

    layer.update(
      computePlacements(s, {
        human: HUMAN,
        revealAll: s.phase === 'ended',
        clickable,
        highlight,
        dim,
        flash,
      }),
    )
    // tira de esperas: sobre la mano de 13 (sin la robada) = "tus esperas tras
    // tu último descarte"; el tenpai formal puede incluir esperas sin yaku
    const showWaits = settings.showWaits && s.phase !== 'ended' && isTenpai(s, HUMAN)
    const remaining = showWaits ? remainingFor(s, HUMAN) : null
    hud.update(s, {
      kyoku: game.kyoku,
      buttons: humanButtons(s),
      chiOptions: humanChiOptions(s),
      turnLabel: turnLabel(s),
      waits: showWaits
        ? seatWaits(s, HUMAN).map((w) => ({ tile: w, live: remaining![w]! }))
        : null,
      furiten: showWaits && seatFuriten(s, HUMAN),
    })
    cutIn.refresh() // el rótulo visible sigue al cambio de idioma en caliente
    const pending = humanDecisionPending(s)
    if (pending && !lastDecisionPending) playAlert()
    lastDecisionPending = pending
  }

  function turnLabel(s: HandState): string | null {
    if (s.phase === 'ended') return null
    if (riichiMode) return t('game.riichi-choose')
    if (s.phase === 'discard' && s.turn === HUMAN) return t('game.your-turn')
    if (s.phase === 'reaction' && pendingHumanOffer(s)) {
      return chiPicker ? t('game.choose-chi') : t('game.call')
    }
    return null
  }

  function humanButtons(s: HandState): ButtonDef[] {
    const out: ButtonDef[] = []
    if (s.phase === 'discard' && s.turn === HUMAN) {
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
    const hand = s.seats[HUMAN]!.hand
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
    const offer = s.reaction.offers.find((o) => o.seat === HUMAN)
    if (!offer || s.reaction.responses[HUMAN] !== null) return null
    return offer
  }

  /** Hay una opción especial para que el humano elija. */
  function humanDecisionPending(s: HandState): boolean {
    if (s.phase === 'reaction') return pendingHumanOffer(s) !== null
    if (s.phase === 'discard' && s.turn === HUMAN) {
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
    persist()
    if (actor === HUMAN) bumpStats((s) => recordAction(s, action))
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

  function onKeySkip(ev: KeyboardEvent): void {
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
    window.removeEventListener('keydown', onKeySkip)
    cutIn.destroy()
  }

  function scheduleStep(): void {
    if (endBeat !== null) return // congelado mientras se explica la jugada
    if (timer !== null) clearTimeout(timer)
    const s = game.hand

    if (s.phase === 'ended') {
      timer = setTimeout(showEnd, DELAY.handEnd)
      return
    }
    if (s.phase === 'draw') {
      timer = setTimeout(() => apply({ type: 'draw' }), DELAY.draw)
      return
    }
    if (s.phase === 'discard') {
      if (s.turn !== HUMAN) {
        timer = setTimeout(() => apply(botTurnAction(game.hand, botRng)), DELAY.botTurn)
      } else if (s.seats[HUMAN]!.riichi > 0) {
        // en riichi: si no hay decisión real (tsumo/kan), tsumogiri automático
        if (!tsumoScore(s) && ankanOptions(s).length === 0) {
          timer = setTimeout(
            () => apply({ type: 'discard', tile: game.hand.drawn! }),
            DELAY.autoTsumogiri,
          )
        }
      }
      return
    }
    // reaction: contestan los bots pendientes; si le toca al humano, se espera
    const r = s.reaction!
    const next = r.offers.find((o) => r.responses[o.seat] === null)
    if (next && next.seat !== HUMAN) {
      timer = setTimeout(
        () => apply(botReaction(game.hand, next, botRng)),
        DELAY.botReaction,
      )
    }
  }

  // --- fin de mano / partida ------------------------------------------------------

  function showEnd(): void {
    const s = game.hand
    bumpStats((st) => recordHand(st, s, HUMAN))
    const afterContinue = (): void => {
      hud.hideOverlay()
      game = advanceGame(game)
      if (game.finished) {
        clearSave() // no hay nada que reanudar
        const results = finalResults(game.hand.seats.map((st) => st.points), game.hand.rules)
        bumpStats((st) => recordGame(st, results, HUMAN))
        hud.showGameEnd(
          game.hand,
          () => {
            // rematch con el mismo roster y el mismo reglamento
            hud.hideOverlay()
            log = newLog(Date.now() >>> 0, game.hand.rules)
            botSeed = (Date.now() ^ 0xc0ffee) >>> 0
            botRng = makeRng(botSeed)
            game = newGame(log.seed, {}, log.rules)
            persist()
            riichiMode = false
            render()
            scheduleStep()
          },
          leave,
        )
        return
      }
      log.hands.push([]) // la mano siguiente empieza su propio tramo del log
      persist()
      riichiMode = false
      render()
      scheduleStep()
    }

    if (s.end!.type === 'tsumo' || s.end!.type === 'ron') {
      showWinScreen(stage, s, game.kyoku, roster, afterContinue, HUMAN)
    } else {
      hud.showHandEnd(s, game.kyoku, afterContinue)
    }
  }

  // --- input -------------------------------------------------------------------

  function onTileClick(id: TileId): void {
    const s = game.hand
    if (s.phase !== 'discard' || s.turn !== HUMAN) return
    if (riichiMode) {
      riichiMode = false
      apply({ type: 'riichi', tile: id })
    } else {
      apply({ type: 'discard', tile: id })
    }
  }

  function onButton(kind: string): void {
    const s = game.hand
    switch (kind) {
      case 'tsumo': return apply({ type: 'tsumo' })
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
        if (ak.length > 0) return apply({ type: 'ankan', tile34: ak[0]! })
        const sk = shouminkanOptions(s)
        if (sk.length > 0) return apply({ type: 'shouminkan', tile: sk[0]! })
        return
      }
      case 'kyuushu': return apply({ type: 'kyuushu' })
      case 'chi-open': {
        const offer = pendingHumanOffer(s)
        if (!offer || offer.chi.length === 0) return
        if (offer.chi.length === 1) {
          return apply({ type: 'chi', seat: HUMAN, start: offer.chi[0]! })
        }
        chiPicker = true
        render()
        return
      }
      case 'chi-cancel':
        chiPicker = false
        render()
        return
      case 'ron': return apply({ type: 'ron', seat: HUMAN })
      case 'pon': return apply({ type: 'pon', seat: HUMAN })
      case 'daiminkan': return apply({ type: 'daiminkan', seat: HUMAN })
      case 'pass': return apply({ type: 'pass', seat: HUMAN })
      default:
        if (kind.startsWith('chi:')) {
          return apply({ type: 'chi', seat: HUMAN, start: Number(kind.slice(4)) })
        }
    }
  }

  // --- arranque -----------------------------------------------------------------

  window.addEventListener('keydown', onKeySkip)
  render()
  scheduleStep()
}
