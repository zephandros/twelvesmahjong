// Reproductor de música in-game: título del tema que suena + botones de mute,
// anterior, play/pausa y siguiente. Rota solo GAME_TRACKS (el tema del menú no
// entra). Pastilla sobre la banda inferior del marco de la mesa, alineada a su
// esquina izquierda (a juego con el botón de menú de la banda superior). Iconos
// del set Lucide vía icons.generated.ts (pipeline assets:icons).
// Muere con el stage de partida: el Hud llama a dispose() al salir.

import { BOARD, STAGE_H, place } from './layout'
import { t } from './i18n'
import { ICONS } from './icons.generated'
import { GAME_TRACKS, MUSIC_TITLES } from './audio/catalog'
import {
  getCurrentTrack, isMusicPaused, onMusicChange, playMusic, playUiClick,
  setMusicMuted, toggleMusicPause,
} from './audio/audio'
import { saveSettings, type Settings } from './settings'

export interface MusicBar {
  /** Re-aplica los tooltips/aria con el idioma vigente (cambio en caliente). */
  applyTexts(): void
  /** Da de baja el oyente de audio y retira la barra del stage. */
  dispose(): void
}

export function createMusicBar(stage: HTMLElement, settings: Settings): MusicBar {
  const bar = document.createElement('div')
  bar.className = 'tm-music'

  const title = document.createElement('span')
  title.className = 'tm-music__title'

  const btn = (onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.className = 'tm-music__btn'
    b.addEventListener('click', () => {
      playUiClick()
      onClick()
    })
    return b
  }

  // siguiente/anterior sobre GAME_TRACKS, cíclico; el crossfade lo pone playMusic
  const step = (delta: 1 | -1): void => {
    const n = GAME_TRACKS.length
    const i = GAME_TRACKS.indexOf(getCurrentTrack() ?? '')
    playMusic(GAME_TRACKS[((i < 0 ? 0 : i) + delta + n) % n]!)
  }

  const prevBtn = btn(() => step(-1))
  const playBtn = btn(() => toggleMusicPause())
  const nextBtn = btn(() => step(1))
  const muteBtn = btn(() => {
    setMusicMuted(!settings.musicMuted)
    saveSettings(settings)
  })

  bar.append(title, prevBtn, playBtn, nextBtn, muteBtn)
  // banda inferior del marco de madera (BOARD es el fieltro; el marco son los
  // 24px de padding de .tm-board), esquina izquierda (inset 34px por el radio)
  const FRAME = 24
  place(bar, {
    left: BOARD.x - FRAME + 34,
    bottom: STAGE_H - (BOARD.y + BOARD.h + FRAME),
    height: FRAME,
    z: 45,
  })
  stage.appendChild(bar)

  const label = (b: HTMLElement, text: string): void => {
    b.title = text
    b.setAttribute('aria-label', text)
  }

  // Iconos + tooltips dependen del estado (play/pausa, mute): un solo refresco.
  const refresh = (): void => {
    const track = getCurrentTrack()
    title.textContent = track ? (MUSIC_TITLES[track] ?? track) : ''
    prevBtn.innerHTML = ICONS['skip-back']
    nextBtn.innerHTML = ICONS['skip-forward']
    playBtn.innerHTML = isMusicPaused() ? ICONS.play : ICONS.pause
    muteBtn.innerHTML = settings.musicMuted ? ICONS['volume-x'] : ICONS['volume-2']
    muteBtn.classList.toggle('is-muted', settings.musicMuted)
    label(prevBtn, t('music.prev'))
    label(nextBtn, t('music.next'))
    label(playBtn, isMusicPaused() ? t('music.play') : t('music.pause'))
    label(muteBtn, settings.musicMuted ? t('music.unmute') : t('music.mute'))
  }

  const off = onMusicChange(() => {
    // red de seguridad: si el stage murió sin dispose(), el oyente se da de baja
    if (!bar.isConnected) return dispose()
    refresh()
  })
  refresh()

  function dispose(): void {
    off()
    bar.remove()
  }

  return { applyTexts: refresh, dispose }
}
