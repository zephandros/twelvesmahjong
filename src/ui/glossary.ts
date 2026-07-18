// Glosario de yaku: overlay con las 4 secciones (nombre | han | descripción),
// abierto desde la portada o desde el menú in-game (se apila encima porque se
// añade al stage el último, con el mismo z de .tm-overlay). Se construye en
// cada apertura → los textos se resuelven con el locale vigente; el idioma no
// puede cambiar con el glosario abierto (su cycler queda tapado).

import { t } from './i18n'
import type { MsgKey } from './i18n-strings.generated'
import { ICONS } from './icons.generated'
import { playUiClick } from './audio/audio'
import { GLOSSARY_SECTIONS, YAKU_GLOSSARY, type GlossarySection, type YakuInfo } from './yaku-info'

const SECTION_KEYS: Record<GlossarySection, MsgKey> = {
  situational: 'glossary.sec.situational',
  form: 'glossary.sec.form',
  yakuman: 'glossary.sec.yakuman',
  dora: 'glossary.sec.dora',
}

/** Nombre del yaku; los contadores de dora interpolan {n} → se limpia vacío. */
function name(info: YakuInfo): string {
  return t(`yaku.${info.id}`, { n: '' }).trim()
}

function hanLabel(info: YakuInfo): string {
  if (info.yakuman) return t('limit.yakuman')
  return info.open === null ? `${info.closed} / —` : `${info.closed} / ${info.open}`
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

  const body = document.createElement('div')
  body.className = 'tm-glossary__body'
  for (const section of GLOSSARY_SECTIONS) {
    const sec = document.createElement('div')
    sec.className = 'tm-menu-ov__sec'
    sec.textContent = t(SECTION_KEYS[section])
    body.appendChild(sec)
    for (const info of YAKU_GLOSSARY) {
      if (info.section !== section) continue
      const row = document.createElement('div')
      row.className = 'tm-glossary__row'
      row.innerHTML =
        `<span class="tm-glossary__name">${name(info)}</span>` +
        `<span class="tm-glossary__han">${hanLabel(info)}</span>` +
        `<span class="tm-glossary__desc">${t(`yaku.${info.id}.desc`)}</span>`
      body.appendChild(row)
    }
  }
  card.appendChild(body)

  ov.appendChild(card)
  stage.appendChild(ov)
}
