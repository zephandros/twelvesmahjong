// Pantalla de estadísticas: overlay con el mismo patrón que el glosario (se
// construye en cada apertura, así los textos salen en el locale vigente, y se
// apila sobre el hub de OPCIONES porque se añade al stage el último).
//
// Cuatro bloques: partidas (reparto de puestos), manos (tasas), récord y yaku
// conseguidos. Sin partidas jugadas muestra un aviso en vez de dividir por cero.

import { t, yakuLabel } from './i18n'
import type { MsgKey } from './i18n-strings.generated'
import { ICONS } from './icons.generated'
import { playUiClick } from './audio/audio'
import { loadStats, clearStats, averagePlace, type Stats } from './stats'
import type { YakuId } from '../core/yaku'

const PLACE_KEYS = ['hud.place.1', 'hud.place.2', 'hud.place.3', 'hud.place.4'] as const

/** Porcentaje sobre un total, sin dividir por cero. */
const pct = (n: number, total: number): string =>
  total === 0 ? '—' : `${((n / total) * 100).toFixed(1)} %`

function section(key: MsgKey): HTMLElement {
  const el = document.createElement('div')
  el.className = 'tm-menu-ov__sec'
  el.textContent = t(key)
  return el
}

function row(label: string, value: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'tm-stats__row'
  el.innerHTML = `<span>${label}</span><b>${value}</b>`
  return el
}

/** Reparto de puestos con barra proporcional. */
function placeRow(s: Stats, i: number): HTMLElement {
  const n = s.places[i] ?? 0
  const el = document.createElement('div')
  el.className = 'tm-stats__row tm-stats__place'
  el.innerHTML =
    `<span>${t(PLACE_KEYS[i]!)}</span>` +
    `<span class="tm-stats__bar"><i style="width:${s.games === 0 ? 0 : (n / s.games) * 100}%"></i></span>` +
    `<b>${n} · ${pct(n, s.games)}</b>`
  return el
}

function yakuList(s: Stats): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'tm-stats__yaku'
  const entries = (Object.entries(s.yaku) as Array<[YakuId, number]>)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (entries.length === 0) {
    wrap.appendChild(row(t('stats.no-yaku'), ''))
    return wrap
  }
  for (const [id, n] of entries) {
    // los contadores de dora interpolan su han como {n}: aquí no aplica
    wrap.appendChild(row(yakuLabel({ id, han: 1 }).replace(/\s*1\s*$/, ''), String(n)))
  }
  return wrap
}

export function openStats(stage: HTMLElement): void {
  const s = loadStats()

  const ov = document.createElement('div')
  ov.className = 'tm-overlay'
  const card = document.createElement('div')
  card.className = 'tm-overlay__card tm-stats'

  const title = document.createElement('div')
  title.className = 'tm-menu-ov__title'
  title.textContent = t('stats.title')
  card.appendChild(title)

  const closeBtn = document.createElement('button')
  closeBtn.className = 'tm-menu-ov__close'
  closeBtn.innerHTML = ICONS.x
  closeBtn.title = t('hud.close')
  closeBtn.setAttribute('aria-label', t('hud.close'))
  closeBtn.addEventListener('click', () => {
    playUiClick()
    ov.remove()
  })
  card.appendChild(closeBtn)

  const body = document.createElement('div')
  body.className = 'tm-stats__body'
  card.appendChild(body)

  // --- partidas ---
  body.appendChild(section('stats.sec.games'))
  body.appendChild(row(t('stats.games'), String(s.games)))
  body.appendChild(row(t('stats.avg-place'), s.games === 0 ? '—' : averagePlace(s).toFixed(2)))
  body.appendChild(row(
    t('stats.avg-score'),
    s.games === 0 ? '—' : (s.totalScore / s.games).toFixed(1),
  ))
  for (let i = 0; i < 4; i++) body.appendChild(placeRow(s, i))

  // --- manos ---
  const wins = s.winsTsumo + s.winsRon
  body.appendChild(section('stats.sec.hands'))
  body.appendChild(row(t('stats.hands'), String(s.hands)))
  body.appendChild(row(t('stats.win-rate'), `${wins} · ${pct(wins, s.hands)}`))
  body.appendChild(row(t('stats.tsumo-ron'), `${s.winsTsumo} / ${s.winsRon}`))
  body.appendChild(row(t('stats.deal-in'), `${s.dealIns} · ${pct(s.dealIns, s.hands)}`))
  body.appendChild(row(t('stats.riichi-rate'), `${s.riichi} · ${pct(s.riichi, s.hands)}`))
  body.appendChild(row(t('stats.riichi-wins'), `${s.riichiWins} · ${pct(s.riichiWins, s.riichi)}`))
  body.appendChild(row(t('stats.calls'), String(s.calls)))
  body.appendChild(row(t('stats.tenpai-draw'), `${s.tenpaiAtDraw} / ${s.draws}`))

  // --- récord ---
  body.appendChild(section('stats.sec.best'))
  body.appendChild(row(
    t('stats.best-hand'),
    s.best === null
      ? '—'
      : s.best.yakuman > 0
        ? `${s.best.points.toLocaleString('en-US')} · ${t('hud.yakuman')}`
        : `${s.best.points.toLocaleString('en-US')} · ${t('hud.han-fu', { han: s.best.han, fu: s.best.fu })}`,
  ))

  // --- yaku ---
  body.appendChild(section('stats.sec.yaku'))
  body.appendChild(yakuList(s))

  // --- borrado en dos pasos (patrón del ABANDONAR del menú in-game) ---
  const footer = document.createElement('div')
  footer.className = 'tm-menu-ov__footer'
  const resetFooter = (): void => {
    footer.innerHTML = ''
    const del = document.createElement('button')
    del.className = 'tm-btn tm-btn--danger'
    del.textContent = t('stats.clear')
    del.addEventListener('click', () => { playUiClick(); askConfirm() })
    footer.appendChild(del)
  }
  const askConfirm = (): void => {
    footer.innerHTML = ''
    const q = document.createElement('span')
    q.className = 'tm-menu-ov__confirm'
    q.textContent = t('stats.clear-confirm')
    const yes = document.createElement('button')
    yes.className = 'tm-btn tm-btn--danger'
    yes.textContent = t('hud.yes')
    yes.addEventListener('click', () => {
      playUiClick()
      clearStats()
      ov.remove()
      openStats(stage) // se reabre a cero, sin tener que reconstruir a mano
    })
    const no = document.createElement('button')
    no.className = 'tm-btn tm-btn--muted'
    no.textContent = t('hud.no')
    no.addEventListener('click', () => { playUiClick(); resetFooter() })
    footer.append(q, yes, no)
  }
  resetFooter()
  card.appendChild(footer)

  ov.appendChild(card)
  stage.appendChild(ov)
}
