// Multijugador: entrada (crear / unirse) y sala de espera.
//
// Reaprovecha el layout y el CSS de la selección de personaje (`tm-select`,
// `tm-slot`, `tm-char`): son la misma pantalla conceptual —cuatro asientos y el
// elenco— con la diferencia de que aquí los asientos los ocupan personas.

import {
  CHARACTERS, charName, squareUrl, seatUrl, type Character, type Roster,
} from './characters'
import type { CharacterId } from '../ai/roster'
import { ICONS } from './icons.generated'
import { playUiClick, playMusic } from './audio/audio'
import { SELECT_TRACK } from './audio/catalog'
import { createScaledStage } from './layout'
import { t } from './i18n'
import { seatWind, windColor, windName, type Seat } from '../core/seat'
import type { Tile34 } from '../core/tile'
import { loadSettings } from './settings'
import { getTurnstileToken } from './turnstile'
import {
  connectRoom, createRoom, CreateRoomError, errorMessage,
  type LobbyView, type RoomConnection,
} from './net'
import type { NetGame, Resume } from './controller'
import { isRoomCode } from '../net/codes'

const windGlyph = (wind: Tile34): string => t(`wind.${windName(wind)}`)
const INITIAL_DEALER: Seat = 0
const NAME_KEY = 'tm-mp-name-v1'

export interface LobbyStart {
  net: NetGame
  roster: Roster
  resume: Resume | null
}

export function renderLobby(
  root: HTMLElement,
  onStart: (s: LobbyStart) => void,
  onBack: () => void,
): void {
  root.innerHTML = ''
  playMusic(SELECT_TRACK)
  const stage = createScaledStage(root)
  const wrap = document.createElement('div')
  wrap.className = 'tm-select tm-lobby'
  stage.appendChild(wrap)

  let conn: RoomConnection | null = null
  let done = false

  const leave = (next: () => void): void => {
    window.removeEventListener('keydown', onKey)
    if (!done) conn?.close()
    next()
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      playUiClick()
      leave(onBack)
    }
  }
  window.addEventListener('keydown', onKey)

  const head = (sub: string): string => `
    <div class="tm-select__head">
      <button class="tm-select__back" data-act="back" aria-label="${t('select.a11y-back')}">${ICONS['arrow-big-left']}</button>
      <div class="tm-select__headings">
        <span class="tm-select__title">${t('mp.title')}</span>
        <span class="tm-select__sub">${sub}</span>
      </div>
    </div>`

  const wireBack = (): void => {
    wrap.querySelector<HTMLButtonElement>('[data-act="back"]')?.addEventListener('click', () => {
      playUiClick()
      leave(onBack)
    })
  }

  // --- pantalla de entrada -----------------------------------------------------

  function showEntry(error?: string): void {
    const saved = readName()
    // Dos tarjetas de la MISMA forma (texto arriba, hueco flexible, botón
    // abajo): así las dos columnas quedan alineadas pase lo que pase con el
    // contenido, que era justo lo que se descuadraba antes.
    wrap.innerHTML = `
      ${head(t('mp.sub'))}
      <div class="tm-lobby__entry">
        <label class="tm-field tm-field--name">
          <span>${t('mp.name-label')}</span>
          <input type="text" data-f="name" maxlength="16" value="${escapeAttr(saved)}" autocomplete="nickname">
        </label>
        <div class="tm-lobby__split">
          <section class="tm-lobby__card">
            <span class="tm-lobby__hint">${t('mp.create-hint')}</span>
            <div class="tm-lobby__turnstile" data-f="turnstile"></div>
            <button class="tm-btn tm-btn--primary" data-act="create">${t('mp.create')}</button>
          </section>
          <section class="tm-lobby__card">
            <label class="tm-field">
              <span>${t('mp.code-label')}</span>
              <input type="text" data-f="code" maxlength="6" spellcheck="false" autocapitalize="characters">
            </label>
            <span class="tm-lobby__hint">${t('mp.code-hint')}</span>
            <button class="tm-btn tm-btn--muted" data-act="join" disabled>${t('mp.join')}</button>
          </section>
        </div>
        <div class="tm-lobby__status" data-f="status">${error ? escapeHtml(error) : ''}</div>
      </div>`
    wireBack()

    const nameEl = wrap.querySelector<HTMLInputElement>('[data-f="name"]')!
    const codeEl = wrap.querySelector<HTMLInputElement>('[data-f="code"]')!
    const joinBtn = wrap.querySelector<HTMLButtonElement>('[data-act="join"]')!
    const createBtn = wrap.querySelector<HTMLButtonElement>('[data-act="create"]')!
    const statusEl = wrap.querySelector<HTMLElement>('[data-f="status"]')!

    // El código solo admite el alfabeto sin ambigüedades (ver worker/code.ts);
    // se normaliza mientras se escribe para que no haya que pensarlo.
    codeEl.addEventListener('input', () => {
      codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
      joinBtn.disabled = !isRoomCode(codeEl.value)
    })

    joinBtn.addEventListener('click', () => {
      playUiClick()
      saveName(nameEl.value)
      openRoom(codeEl.value, nameEl.value, null)
    })

    createBtn.addEventListener('click', () => {
      playUiClick()
      saveName(nameEl.value)
      createBtn.disabled = true
      joinBtn.disabled = true
      statusEl.textContent = t('mp.checking')
      void doCreate(nameEl.value, statusEl)
    })
  }

  async function doCreate(name: string, statusEl: HTMLElement): Promise<void> {
    const host = wrap.querySelector<HTMLElement>('[data-f="turnstile"]')!
    let token: string
    try {
      // El script de Turnstile se carga AQUÍ y solo aquí: el juego de un
      // jugador nunca toca la red (ver ui/turnstile.ts).
      token = await getTurnstileToken(host)
    } catch {
      showEntry(errorMessage(navigator.onLine ? 'turnstile-blocked' : 'offline'))
      return
    }
    try {
      const { code, hostTicket } = await createRoom(token)
      openRoom(code, name, hostTicket)
    } catch (err) {
      const code = err instanceof CreateRoomError ? err.code : 'network'
      showEntry(errorMessage(code))
      return
    }
    statusEl.textContent = ''
  }

  // --- sala --------------------------------------------------------------------

  function openRoom(code: string, name: string, hostTicket: string | null): void {
    showRoom(null, t('mp.connecting'))
    conn = connectRoom(code, name.trim(), hostTicket, {
      onLobby: (view) => showRoom(view, null),
      onStart: (net, roster, resume) => {
        done = true
        window.removeEventListener('keydown', onKey)
        onStart({ net, roster: rosterOf(roster), resume })
      },
      onError: (c) => setStatus(errorMessage(c)),
      onStatus: (s) => {
        if (s === 'connecting') setStatus(t('mp.connecting'))
        else if (s === 'reconnecting') setStatus(t('mp.reconnecting'))
        else setStatus(null)
      },
      onDead: (message) => showEntry(message),
    })
  }

  let view: LobbyView | null = null

  function showRoom(next: LobbyView | null, status: string | null): void {
    if (next) view = next
    // Antes del primer 'lobby' solo se puede enseñar el estado de la conexión.
    if (!view) {
      wrap.innerHTML = `
        ${head(t('mp.sub'))}
        <div class="tm-lobby__entry">
          <div class="tm-lobby__status" data-f="status">${escapeHtml(status ?? '')}</div>
        </div>`
      wireBack()
      return
    }
    paintRoom(view, status)
  }

  function paintRoom(v: LobbyView, status: string | null): void {
    const mine = v.seats[v.you]?.characterId ?? null
    wrap.innerHTML = `
      ${head(t('mp.share-hint'))}
      <div class="tm-lobby__code">
        <span class="tm-lobby__code-label">${t('mp.room-code')}</span>
        <b class="tm-lobby__code-value">${escapeHtml(v.code)}</b>
        <button class="tm-btn tm-btn--muted" data-act="copy">${t('mp.copy')}</button>
      </div>
      <div class="tm-select__body">
        <div class="tm-select__seats"></div>
        <div class="tm-select__right">
          <div class="tm-select__grid"></div>
          <div class="tm-select__actions">
            <span class="tm-lobby__status" data-f="status">${escapeHtml(status ?? '')}</span>
            ${v.host
              ? `<button class="tm-btn tm-btn--primary" data-act="begin"${mine ? '' : ' disabled'}>${t('mp.begin')}</button>`
              : `<span class="tm-lobby__hint">${t('mp.wait-host')}</span>`}
          </div>
        </div>
      </div>`
    wireBack()

    const seatsEl = wrap.querySelector<HTMLElement>('.tm-select__seats')!
    const gridEl = wrap.querySelector<HTMLElement>('.tm-select__grid')!

    for (const i of [0, 1, 2, 3]) {
      const seat = i as Seat
      const wind = seatWind(seat, INITIAL_DEALER)
      const slot = v.seats[i] ?? null
      const chosen = slot?.characterId
        ? CHARACTERS.find((c) => c.id === slot.characterId) ?? null
        : null
      const el = document.createElement('div')
      el.className = 'tm-slot'
      if (i === v.you) el.classList.add('is-current')
      // Nombre SIEMPRE que lo haya, con el estado detrás: perder el nombre al
      // desconectarse dejaba el asiento sin identificar justo cuando más falta
      // hace saber quién se ha caído.
      const parts: string[] = []
      if (slot === null) parts.push(t('mp.seat-empty'))
      else {
        if (slot.name) parts.push(escapeHtml(slot.name))
        if (i === v.you) parts.push(t('mp.you'))
        else if (!slot.connected) parts.push(t('mp.offline'))
        else if (!slot.name) parts.push(t('mp.seat-bot'))
      }
      const tag = parts.join(' · ')
      el.innerHTML =
        `<span class="tm-slot__label">${tag}</span>` +
        `<span class="tm-slot__frame">` +
        `<span class="tm-slot__wind">${windGlyph(wind)}</span>` +
        (chosen
          ? `<img src="${seatUrl(chosen)}" alt="${charName(chosen)}">` +
            `<span class="tm-slot__name">${charName(chosen)}</span>`
          : `<span class="tm-slot__q">?</span>`) +
        `</span>`
      el.querySelector<HTMLElement>('.tm-slot__wind')!.style.background = windColor(wind)
      seatsEl.appendChild(el)
    }

    for (const c of CHARACTERS) {
      // Cogido por OTRO: no se puede elegir (el árbitro lo rechazaría igual).
      const takenByOther = v.taken.includes(c.id) && c.id !== mine
      const el = document.createElement('button')
      el.className = 'tm-char'
      el.classList.toggle('is-taken', takenByOther)
      el.classList.toggle('is-mine', c.id === mine)
      el.innerHTML = `<img src="${squareUrl(c)}" alt="${charName(c)}"><span>${charName(c)}</span>`
      if (!takenByOther) {
        el.addEventListener('click', () => {
          playUiClick()
          conn?.pick(c.id)
        })
      }
      gridEl.appendChild(el)
    }

    wrap.querySelector<HTMLButtonElement>('[data-act="copy"]')?.addEventListener('click', (ev) => {
      playUiClick()
      void navigator.clipboard?.writeText(v.code)
      ;(ev.currentTarget as HTMLButtonElement).textContent = t('mp.copied')
    })

    wrap.querySelector<HTMLButtonElement>('[data-act="begin"]')?.addEventListener('click', () => {
      playUiClick()
      // El reglamento y la dificultad los pone el anfitrión desde SUS ajustes;
      // el árbitro los valida campo a campo antes de usarlos.
      const s = loadSettings()
      conn?.begin(s.rules, s.difficulty)
    })
  }

  function setStatus(msg: string | null): void {
    const el = wrap.querySelector<HTMLElement>('[data-f="status"]')
    if (el) el.textContent = msg ?? ''
    else showRoom(null, msg)
  }

  showEntry()
}

/** Los ids que manda la sala → los `Character` que espera el controlador. */
function rosterOf(ids: CharacterId[]): Roster {
  const find = (id: CharacterId): Character =>
    CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0]!
  return [find(ids[0]!), find(ids[1]!), find(ids[2]!), find(ids[3]!)]
}

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 16))
  } catch { /* modo privado */ }
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const escapeAttr = escapeHtml
