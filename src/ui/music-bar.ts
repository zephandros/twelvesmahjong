// Reproductor de música in-game: título del tema que suena + botones de mute,
// anterior, play/pausa y siguiente. Rota solo GAME_TRACKS (el tema del menú no
// entra). Anclado a la banda inferior del marco, con el borde derecho alineado
// al panel del jugador inferior-derecho. Iconos como SVG inline: las fuentes
// subseteadas no traen los glifos Unicode de media.
// Muere con el stage de partida: el Hud llama a dispose() al salir.

import { place } from './layout'
import { t } from './i18n'
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

// Iconos 16×16 en currentColor (formas simples estilo reproductor clásico).
const svg = (paths: string): string =>
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">${paths}</svg>`
const ICON = {
  prev: svg('<path d="M3 2h2v12H3z"/><path d="M13 2 6 8l7 6z"/>'),
  next: svg('<path d="M11 2h2v12h-2z"/><path d="M3 2l7 6-7 6z"/>'),
  play: svg('<path d="M4 2l10 6-10 6z"/>'),
  pause: svg('<path d="M4 2h3v12H4z"/><path d="M9 2h3v12H9z"/>'),
  sound: svg('<path d="M2 5h3l4-4v14l-4-4H2z"/><path d="M11 5.5a3.4 3.4 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12.8 3.6a6 6 0 0 1 0 8.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  muted: svg('<path d="M2 5h3l4-4v14l-4-4H2z"/><path d="m11 5.5 4 5M15 5.5l-4 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
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
  place(bar, { right: 24, bottom: 0, height: 24, z: 45 })
  stage.appendChild(bar)

  const label = (b: HTMLElement, text: string): void => {
    b.title = text
    b.setAttribute('aria-label', text)
  }

  // Iconos + tooltips dependen del estado (play/pausa, mute): un solo refresco.
  const refresh = (): void => {
    const track = getCurrentTrack()
    title.textContent = track ? (MUSIC_TITLES[track] ?? track) : ''
    prevBtn.innerHTML = ICON.prev
    nextBtn.innerHTML = ICON.next
    playBtn.innerHTML = isMusicPaused() ? ICON.play : ICON.pause
    muteBtn.innerHTML = settings.musicMuted ? ICON.muted : ICON.sound
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
