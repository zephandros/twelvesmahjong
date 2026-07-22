import './styles.css'
import { unlockAudio, audioRunning } from './ui/audio/audio'
import { setLocale, detectLocale, isLocale } from './ui/i18n'
import { loadSettings } from './ui/settings'

const app = document.getElementById('app')
if (!app) throw new Error('#app no encontrado')

// Locale ANTES del primer render. `?lang=` fuerza sin persistir (para probar);
// si no, manda Settings ('auto' = idioma del navegador con fallback a es).
const forcedLang = new URLSearchParams(location.search).get('lang')
const savedLang = loadSettings().language
setLocale(isLocale(forcedLang) ? forcedLang : savedLang === 'auto' ? detectLocale() : savedLang)

// Autoplay: el AudioContext no puede sonar hasta un gesto del usuario. Se
// escucha hasta que el contexto arranca de verdad (existe solo tras initAudio).
function onGesture(): void {
  unlockAudio()
  if (audioRunning()) {
    window.removeEventListener('pointerdown', onGesture)
    window.removeEventListener('keydown', onGesture)
  }
}
window.addEventListener('pointerdown', onGesture)
window.addEventListener('keydown', onGesture)

const debug = new URLSearchParams(location.search).get('debug')

// El bloque .tm-boot de index.html (portada rastreable + pantalla de carga) lo
// borra toMenu() en el flujo normal; las páginas de depuración lo quitan aquí.
if (debug) app.innerHTML = ''

if (debug === 'board') {
  void import('./debug/board').then(({ renderDebugBoard }) => renderDebugBoard(app))
} else if (debug === 'tiles') {
  void import('./debug/tiles').then(({ renderDebugTiles }) => renderDebugTiles(app))
} else {
  void Promise.all([
    import('./ui/menu'),
    import('./ui/select'),
    import('./ui/controller'),
    import('./ui/persist'),
    import('./ui/characters'),
  ]).then(([
    { renderMenu }, { renderSelect }, { startGame }, persist, { CHARACTERS },
  ]) => {
    // Flujo: menú → selección de personaje → partida; con partida guardada,
    // CONTINUAR salta la selección y reanuda desde el log.
    const toMenu = (): void => {
      app.innerHTML = ''
      renderMenu(app, { onStart: toSelect, onResume: toResume })
    }
    const toSelect = (): void => {
      app.innerHTML = ''
      renderSelect(
        app,
        (roster) => {
          app.innerHTML = ''
          startGame(app, roster, toMenu) // salir de partida → volver a la portada
        },
        toMenu, // volver al menú desde la selección
      )
    }
    const toResume = (): void => {
      const saved = persist.loadSave()
      const game = saved && persist.restoreGame(saved)
      const found = saved?.roster.map((id) => CHARACTERS.find((c) => c.id === id))
      const roster =
        found?.length === 4 && found.every((c) => c !== undefined)
          ? (found as unknown as Parameters<typeof startGame>[1])
          : null
      // guardado inservible (corrupto, o de un roster que ya no existe): se
      // descarta y se empieza por la selección, sin dejar el botón muerto
      if (!saved || !game || !roster) {
        persist.clearSave()
        toSelect()
        return
      }
      app.innerHTML = ''
      startGame(app, roster, toMenu, {
        game,
        log: saved.log,
        botSeed: saved.botSeed,
      })
    }
    toMenu()
  })
}
