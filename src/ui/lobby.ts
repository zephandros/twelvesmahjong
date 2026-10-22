// Multijugador: entrada (crear / unirse), inicio de sesión en Kovalt y sala de
// espera.
//
// Reaprovecha el layout y el CSS de la selección de personaje (`tm-select`,
// `tm-slot`, `tm-char`): son la misma pantalla conceptual —cuatro asientos y el
// elenco— con la diferencia de que aquí los asientos los ocupan personas.
//
// Crear una sala exige una cuenta de Kovalt en la lista blanca; unirse con el
// código solo pide un nombre. Toda la red (Firebase, PocketBase) vive en
// ui/net.ts, que se carga con `import()` al abrir esta pantalla: si no carga
// (sin conexión, chunk fuera del precache), la pantalla lo dice y nada más.

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
import type { NetGame, Resume, LobbyView } from '../net/protocol'
import { isRoomCode } from '../net/codes'
import { MAX_NAME } from '../net/protocol'

type Net = typeof import('./net')

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

  let net: Net | null = null
  let conn: import('./net').RoomConnection | null = null
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

  const wireBack = (onClick: () => void = () => leave(onBack)): void => {
    wrap.querySelector<HTMLButtonElement>('[data-act="back"]')?.addEventListener('click', () => {
      playUiClick()
      onClick()
    })
  }

  // --- pantalla de entrada -----------------------------------------------------

  function showEntry(error?: string): void {
    const saved = readName()
    const acc = net?.account() ?? null
    const ready = net !== null && net.firebaseConfigured()
    // Dos tarjetas de la MISMA forma (texto arriba, hueco flexible, botón
    // abajo): así las dos columnas quedan alineadas pase lo que pase con el
    // contenido, que era justo lo que se descuadraba antes.
    wrap.innerHTML = `
      ${head(t('mp.sub'))}
      <div class="tm-lobby__entry">
        <label class="tm-field tm-field--name">
          <span>${t('mp.name-label')}</span>
          <input type="text" data-f="name" maxlength="${MAX_NAME}" value="${escapeAttr(saved)}" autocomplete="nickname">
          <span class="tm-field__req" data-f="name-req">${t('mp.name-required')}</span>
        </label>
        <div class="tm-lobby__split">
          <section class="tm-lobby__card">
            <span class="tm-lobby__hint">${t('mp.create-hint')}</span>
            ${acc
              ? `<span class="tm-lobby__account">${t('mp.signed-in', { name: escapeHtml(acc.name) })}
                   <button class="tm-lobby__link" data-act="logout">${t('mp.logout')}</button></span>
                 <button class="tm-btn tm-btn--primary" data-act="create" disabled>${t('mp.create')}</button>`
              : `<span class="tm-lobby__hint tm-lobby__hint--soft">${t('mp.login-hint')}</span>
                 <button class="tm-btn tm-btn--primary" data-act="login" disabled>${t('mp.login')}</button>`}
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
    const mainBtn = wrap.querySelector<HTMLButtonElement>('[data-act="create"], [data-act="login"]')!
    const statusEl = wrap.querySelector<HTMLElement>('[data-f="status"]')!
    const reqEl = wrap.querySelector<HTMLElement>('[data-f="name-req"]')!

    // Sin nombre no se entra: un asiento sin nombre es indistinguible de uno de
    // la IA en el lobby y en los paneles de la mesa. Los botones se apagan
    // hasta que haya algo escrito (espacios no cuentan: el nombre se manda con
    // trim) y el aviso bajo el campo explica por qué están apagados.
    const sync = (): void => {
      const named = nameEl.value.trim().length > 0
      mainBtn.disabled = !ready || (!named && mainBtn.dataset['act'] === 'create')
      joinBtn.disabled = !ready || !named || !isRoomCode(codeEl.value)
      reqEl.classList.toggle('is-off', named)
    }
    nameEl.addEventListener('input', sync)

    // El código solo admite el alfabeto sin ambigüedades (ver net/codes.ts);
    // se normaliza mientras se escribe para que no haya que pensarlo.
    codeEl.addEventListener('input', () => {
      codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
      sync()
    })

    sync() // el nombre puede venir de localStorage: el estado inicial no es fijo

    joinBtn.addEventListener('click', () => {
      playUiClick()
      saveName(nameEl.value)
      void open(statusEl, () => net!.openAsGuest(codeEl.value, nameEl.value.trim(), handlers))
    })

    mainBtn.addEventListener('click', () => {
      playUiClick()
      saveName(nameEl.value)
      if (mainBtn.dataset['act'] === 'login') {
        showLogin()
        return
      }
      void open(statusEl, () => net!.openAsHost(nameEl.value.trim(), handlers))
    })

    wrap.querySelector<HTMLButtonElement>('[data-act="logout"]')?.addEventListener('click', () => {
      playUiClick()
      void net!.logout().finally(() => showEntry())
    })
  }

  async function open(
    statusEl: HTMLElement,
    go: () => Promise<import('./net').Opened>,
  ): Promise<void> {
    for (const b of wrap.querySelectorAll<HTMLButtonElement>('.tm-btn')) b.disabled = true
    statusEl.textContent = t('mp.connecting')
    try {
      const { conn: c } = await go()
      conn = c
      showRoom(null, t('mp.connecting'))
    } catch (err) {
      showEntry(net!.errorMessage(net!.errorKey(err)))
    }
  }

  // --- inicio de sesión en Kovalt -----------------------------------------------

  function showLogin(error?: string): void {
    let otpId: string | null = null
    wrap.innerHTML = `
      ${head(t('mp.login-sub'))}
      <div class="tm-lobby__entry">
        <section class="tm-lobby__card tm-lobby__card--login">
          <span class="tm-lobby__hint">${t('mp.login-hint')}</span>
          <label class="tm-field">
            <span>${t('mp.email-label')}</span>
            <input type="email" data-f="email" maxlength="80" autocomplete="email" inputmode="email">
          </label>
          <label class="tm-field is-off" data-f="otp-field">
            <span>${t('mp.otp-label')}</span>
            <input type="text" data-f="otp" maxlength="8" inputmode="numeric" autocomplete="one-time-code">
            <span class="tm-field__req">${t('mp.otp-hint')}</span>
          </label>
          <button class="tm-btn tm-btn--primary" data-act="otp" disabled>${t('mp.send-code')}</button>
          <span class="tm-lobby__or">${t('mp.or')}</span>
          <button class="tm-btn tm-btn--muted" data-act="google">${t('mp.google')}</button>
        </section>
        <div class="tm-lobby__status" data-f="status">${error ? escapeHtml(error) : ''}</div>
      </div>`
    wireBack(() => showEntry())

    const emailEl = wrap.querySelector<HTMLInputElement>('[data-f="email"]')!
    const otpField = wrap.querySelector<HTMLElement>('[data-f="otp-field"]')!
    const otpEl = wrap.querySelector<HTMLInputElement>('[data-f="otp"]')!
    const otpBtn = wrap.querySelector<HTMLButtonElement>('[data-act="otp"]')!
    const googleBtn = wrap.querySelector<HTMLButtonElement>('[data-act="google"]')!
    const statusEl = wrap.querySelector<HTMLElement>('[data-f="status"]')!

    const sync = (): void => {
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim())
      otpBtn.disabled = otpId === null ? !email : otpEl.value.trim().length < 8
    }
    emailEl.addEventListener('input', sync)
    otpEl.addEventListener('input', () => {
      otpEl.value = otpEl.value.replace(/\D/g, '')
      sync()
    })
    sync()
    emailEl.focus()

    const fail = (err: unknown): void => {
      statusEl.textContent = net!.errorMessage(net!.errorKey(err))
      otpBtn.disabled = false
      googleBtn.disabled = false
    }

    otpBtn.addEventListener('click', () => {
      playUiClick()
      otpBtn.disabled = true
      googleBtn.disabled = true
      statusEl.textContent = t('mp.checking')
      if (otpId === null) {
        net!.requestOtp(emailEl.value).then((id) => {
          otpId = id
          statusEl.textContent = t('mp.code-sent')
          otpField.classList.remove('is-off')
          emailEl.disabled = true
          otpBtn.textContent = t('mp.verify')
          googleBtn.disabled = false
          otpEl.focus()
          sync()
        }, fail)
      } else {
        net!.verifyOtp(otpId, otpEl.value).then(() => showEntry(), fail)
      }
    })

    googleBtn.addEventListener('click', () => {
      playUiClick()
      otpBtn.disabled = true
      googleBtn.disabled = true
      statusEl.textContent = t('mp.checking')
      net!.loginWithGoogle().then(() => showEntry(), fail)
    })
  }

  // --- sala --------------------------------------------------------------------

  const handlers: import('./net').ClientHandlers = {
    onLobby: (v) => showRoom(v, null),
    onStart: (game, roster, resume) => {
      done = true
      window.removeEventListener('keydown', onKey)
      onStart({ net: game, roster: rosterOf(roster), resume })
    },
    onError: (c) => setStatus(net!.errorMessage(c)),
    onDead: (c) => {
      conn = null
      view = null
      showEntry(net!.errorMessage(c))
    },
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
    const canBegin = v.host && mine !== null
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
              ? `<button class="tm-btn tm-btn--primary" data-act="begin"${canBegin ? '' : ' disabled'}>${t('mp.begin')}</button>`
              : `<span class="tm-lobby__hint">${v.hostOnline ? t('mp.wait-host') : t('mp.host-away')}</span>`}
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
      if (i === 0) parts.push(t('mp.host'))
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
      // Cogido por OTRO: no se puede elegir (las reglas lo rechazarían igual).
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

    wrap.querySelector<HTMLButtonElement>('[data-act="begin"]')?.addEventListener('click', (ev) => {
      playUiClick()
      ;(ev.currentTarget as HTMLButtonElement).disabled = true
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

  // --- arranque ----------------------------------------------------------------

  showRoom(null, t('mp.connecting'))
  import('./net').then(
    (m) => {
      net = m
      showEntry(net.firebaseConfigured() ? undefined : net.errorMessage('disabled'))
    },
    () => {
      // El chunk de red no está en el precache: sin conexión no hay multijugador.
      showEntry(t('mp.error.offline'))
    },
  )
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
    localStorage.setItem(NAME_KEY, name.trim().slice(0, MAX_NAME))
  } catch { /* modo privado */ }
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const escapeAttr = escapeHtml
