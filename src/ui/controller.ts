// Controlador de partida: el humano juega el asiento 0, los bots (ai/bot.ts)
// los demás. Motor puro debajo; aquí solo orquestación, temporización e input.

import type { TileId, Tile34 } from '../core/tile'
import { tile34Of } from '../core/tile'
import type { Seat } from '../core/seat'
import type { Action } from '../core/actions'
import type { HandState } from '../core/state'
import { reduce } from '../core/reducer'
import { newGame, advanceGame, type GameState } from '../core/game'
import {
  tsumoScore, riichiOptions, ankanOptions, shouminkanOptions, canKyuushu,
} from '../core/rules'
import { makeRng, type Rng } from '../core/rng'
import { botTurnAction, botReaction } from '../ai/bot'
import { createStage } from './layout'
import { createTileView } from './tile-view'
import { TileLayer } from './tile-layer'
import { Hud, type ButtonDef } from './hud'
import { computePlacements } from './geometry'
import { showWinScreen } from './win-screen'
import type { Roster, CharacterId } from './characters'
import { loadSettings } from './settings'
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
}

export function startGame(
  root: HTMLElement,
  roster: Roster,
  onCharacters: () => void,
): void {
  const settings = loadSettings()
  const stage = createStage(root)
  const layer = new TileLayer(stage, createTileView(46), onTileClick)
  const hud = new Hud(stage, HUMAN, roster, settings, onButton, onCharacters)

  initAudio(settings) // mismo objeto que el Hud: cambiar el tema afecta al click
  // pista de partida al azar (Math.random, NUNCA el RNG semillado del core)
  playMusic(GAME_TRACKS[Math.floor(Math.random() * GAME_TRACKS.length)]!)

  let game: GameState = newGame(Date.now() >>> 0)
  const botRng: Rng = makeRng((Date.now() ^ 0xc0ffee) >>> 0)
  let riichiMode = false
  let chiPicker = false
  let lastDecisionPending = false
  let timer: ReturnType<typeof setTimeout> | null = null

  // --- render ------------------------------------------------------------------

  function render(): void {
    const s = game.hand
    const clickable = new Set<TileId>()
    const highlight = new Set<TileId>()

    if (s.phase === 'discard' && s.turn === HUMAN) {
      const st = s.seats[HUMAN]!
      if (s.drawn !== null) highlight.add(s.drawn)
      if (riichiMode) {
        for (const id of riichiOptions(s)) {
          clickable.add(id)
          highlight.add(id)
        }
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

    layer.update(
      computePlacements(s, {
        human: HUMAN,
        revealAll: s.phase === 'ended',
        clickable,
        highlight,
      }),
    )
    hud.update(s, {
      kyoku: game.kyoku,
      buttons: humanButtons(s),
      chiOptions: humanChiOptions(s),
      turnLabel: turnLabel(s),
    })
    const pending = humanDecisionPending(s)
    if (pending && !lastDecisionPending) playAlert()
    lastDecisionPending = pending
  }

  function turnLabel(s: HandState): string | null {
    if (s.phase === 'ended') return null
    if (riichiMode) return '— RIICHI: CHOOSE DISCARD —'
    if (s.phase === 'discard' && s.turn === HUMAN) return '— YOUR TURN —'
    if (s.phase === 'reaction' && pendingHumanOffer(s)) {
      return chiPicker ? '— CHOOSE CHI —' : '— CALL? —'
    }
    return null
  }

  function humanButtons(s: HandState): ButtonDef[] {
    const out: ButtonDef[] = []
    if (s.phase === 'discard' && s.turn === HUMAN) {
      if (riichiMode) return [{ label: 'CANCEL', kind: 'riichi-cancel', style: 'muted' }]
      if (tsumoScore(s)) out.push({ label: 'TSUMO', kind: 'tsumo', style: 'primary' })
      if (riichiOptions(s).length > 0) out.push({ label: 'RIICHI', kind: 'riichi-mode', style: 'primary' })
      if (ankanOptions(s).length > 0 || shouminkanOptions(s).length > 0) {
        out.push({ label: 'KAN', kind: 'kan' })
      }
      if (canKyuushu(s)) out.push({ label: '9 TYPES', kind: 'kyuushu', style: 'muted' })
      return out
    }
    const offer = pendingHumanOffer(s)
    if (offer) {
      if (offer.ron) out.push({ label: 'RON', kind: 'ron', style: 'primary' })
      if (offer.pon) out.push({ label: 'PON', kind: 'pon' })
      if (offer.kan) out.push({ label: 'KAN', kind: 'daiminkan' })
      if (offer.chi.length > 0) {
        // con el picker abierto, BACK ocupa el sitio de CHI
        out.push(chiPicker
          ? { label: 'BACK', kind: 'chi-cancel', style: 'muted' }
          : { label: 'CHI', kind: 'chi-open' })
      }
      out.push({ label: 'PASS', kind: 'pass', style: 'muted' })
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
    emitSound(action, actor)
    render()
    scheduleStep()
  }

  function emitSound(action: Action, actor: Seat): void {
    const voice = VOICE_FOR[action.type]
    if (voice) playVoice(roster[actor]!.id as CharacterId, voice)
    if (CLICKS.has(action.type)) playSfx('tile-click')
  }

  function scheduleStep(): void {
    if (timer !== null) clearTimeout(timer)
    const s = game.hand

    if (s.phase === 'ended') {
      timer = setTimeout(showEnd, 900)
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
    const afterContinue = (): void => {
      hud.hideOverlay()
      game = advanceGame(game)
      if (game.finished) {
        hud.showGameEnd(
          game.hand,
          () => {
            // rematch con el mismo roster
            hud.hideOverlay()
            game = newGame(Date.now() >>> 0)
            riichiMode = false
            render()
            scheduleStep()
          },
          onCharacters,
        )
        return
      }
      riichiMode = false
      render()
      scheduleStep()
    }

    if (s.end!.type === 'tsumo' || s.end!.type === 'ron') {
      showWinScreen(stage, s, game.kyoku, roster, afterContinue)
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

  render()
  scheduleStep()
}
