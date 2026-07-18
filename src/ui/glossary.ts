// Glosario de yaku: overlay con pestañas por valor de han (1/2/3/6/yakuman/
// dora, clasificando por el han con mano cerrada) y filas nombre | han |
// descripción; los yaku de forma y los yakuman añaden debajo una mano de
// ejemplo con fichas pequeñas (yaku-examples.ts, certificadas por el motor en
// tests). Se abre desde la portada o desde el menú in-game (se apila encima
// porque se añade al stage el último, con el mismo z de .tm-overlay). Se
// construye en cada apertura → los textos se resuelven con el locale vigente;
// el idioma no puede cambiar con el glosario abierto (su cycler queda tapado).

import { t } from './i18n'
import type { MsgKey } from './i18n-strings.generated'
import { ICONS } from './icons.generated'
import { playUiClick } from './audio/audio'
import { createTileView, type TileView } from './tile-view'
import type { Tile34, TileId } from '../core/tile'
import { GLOSSARY_SECTIONS, YAKU_GLOSSARY, type GlossarySection, type YakuInfo } from './yaku-info'
import { YAKU_EXAMPLES, parseExample, type YakuExample } from './yaku-examples'

const SECTION_KEYS: Record<GlossarySection, MsgKey> = {
  situational: 'glossary.sec.situational',
  form: 'glossary.sec.form',
  yakuman: 'glossary.sec.yakuman',
  dora: 'glossary.sec.dora',
}

/** Pestañas por han con mano cerrada; yakuman y dora aparte. */
type GlossaryTab = 1 | 2 | 3 | 6 | 'yakuman' | 'dora'
const TABS: readonly GlossaryTab[] = [1, 2, 3, 6, 'yakuman', 'dora']

function tabOf(info: YakuInfo): GlossaryTab {
  if (info.yakuman) return 'yakuman'
  if (info.section === 'dora') return 'dora'
  return info.closed as GlossaryTab
}

function tabLabel(tab: GlossaryTab): string {
  if (tab === 'yakuman') return t('limit.yakuman')
  if (tab === 'dora') return t('glossary.sec.dora')
  return t('glossary.tab.han', { n: tab })
}

/** Nombre del yaku; los contadores de dora interpolan {n} → se limpia vacío. */
function name(info: YakuInfo): string {
  return t(`yaku.${info.id}`, { n: '' }).trim()
}

function hanLabel(info: YakuInfo): string {
  if (info.yakuman) return t('limit.yakuman')
  return info.open === null ? `${info.closed} / —` : `${info.closed} / ${info.open}`
}

/** TileId para pintar un Tile34 genérico esquivando las copias aka (5 rojos). */
const AKA_TYPES = new Set([4, 13, 22])
const uiTileId = (t34: Tile34): TileId => (t34 << 2) | (AKA_TYPES.has(t34) ? 1 : 0)

/** Mano de ejemplo: un span por grupo; si hay resaltado, el resto se atenúa. */
function renderHand(view: TileView, ex: YakuExample): HTMLElement {
  const hand = document.createElement('div')
  hand.className = 'tm-glossary__hand'
  for (const group of parseExample(ex)) {
    const grp = document.createElement('span')
    grp.className = 'tm-glossary__group'
    for (const t34 of group.tiles) {
      const tile = view.create('front', uiTileId(t34))
      if (!group.highlight) tile.classList.add('is-dim')
      grp.appendChild(tile)
    }
    hand.appendChild(grp)
  }
  return hand
}

function renderPanel(tab: GlossaryTab, view: TileView): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'tm-glossary__panel'
  panel.setAttribute('role', 'tabpanel')

  const entries = YAKU_GLOSSARY.filter((info) => tabOf(info) === tab)
  const sections = GLOSSARY_SECTIONS.filter((s) => entries.some((i) => i.section === s))
  for (const section of sections) {
    // subtítulo solo cuando la pestaña mezcla secciones (1 y 2 han)
    if (sections.length > 1) {
      const sec = document.createElement('div')
      sec.className = 'tm-menu-ov__sec'
      sec.textContent = t(SECTION_KEYS[section])
      panel.appendChild(sec)
    }
    for (const info of entries) {
      if (info.section !== section) continue
      const row = document.createElement('div')
      row.className = 'tm-glossary__row'
      row.innerHTML =
        `<span class="tm-glossary__name">${name(info)}</span>` +
        `<span class="tm-glossary__han">${hanLabel(info)}</span>` +
        `<span class="tm-glossary__desc">${t(`yaku.${info.id}.desc`)}</span>`
      const example = YAKU_EXAMPLES.get(info.id)
      if (example) row.appendChild(renderHand(view, example))
      panel.appendChild(row)
    }
  }
  return panel
}

export function openGlossary(stage: HTMLElement): void {
  const ov = document.createElement('div')
  ov.className = 'tm-overlay'
  const card = document.createElement('div')
  card.className = 'tm-overlay__card tm-glossary'

  const title = document.createElement('div')
  title.className = 'tm-menu-ov__title'
  title.textContent = t('glossary.title')
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

  const legend = document.createElement('div')
  legend.className = 'tm-glossary__legend'
  legend.textContent = t('glossary.han-legend')
  card.appendChild(legend)

  const tabbar = document.createElement('div')
  tabbar.className = 'tm-glossary__tabs'
  tabbar.setAttribute('role', 'tablist')
  card.appendChild(tabbar)

  const body = document.createElement('div')
  body.className = 'tm-glossary__body'
  card.appendChild(body)

  // los 6 paneles se preconstruyen al abrir; el click solo conmuta visibilidad
  const view = createTileView(24)
  const buttons = new Map<GlossaryTab, HTMLButtonElement>()
  const panels = new Map<GlossaryTab, HTMLElement>()

  const select = (tab: GlossaryTab): void => {
    for (const [key, btn] of buttons) {
      const active = key === tab
      btn.classList.toggle('is-active', active)
      btn.setAttribute('aria-selected', String(active))
      panels.get(key)!.classList.toggle('is-hidden', !active)
    }
    body.scrollTop = 0
  }

  for (const tab of TABS) {
    const btn = document.createElement('button')
    btn.className = 'tm-glossary__tab'
    btn.setAttribute('role', 'tab')
    btn.textContent = tabLabel(tab)
    btn.addEventListener('click', () => {
      playUiClick()
      select(tab)
    })
    tabbar.appendChild(btn)
    buttons.set(tab, btn)
    panels.set(tab, renderPanel(tab, view))
    body.appendChild(panels.get(tab)!)
  }
  select(1)

  ov.appendChild(card)
  stage.appendChild(ov)
}
