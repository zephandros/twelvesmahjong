import './styles.css'

const app = document.getElementById('app')
if (!app) throw new Error('#app no encontrado')

const debug = new URLSearchParams(location.search).get('debug')

if (debug === 'board') {
  void import('./debug/board').then(({ renderDebugBoard }) => renderDebugBoard(app))
} else {
  void Promise.all([import('./ui/select'), import('./ui/controller')]).then(
    ([{ renderSelect }, { startGame }]) => {
      const toSelect = (): void => {
        app.innerHTML = ''
        renderSelect(app, (roster) => {
          app.innerHTML = ''
          startGame(app, roster, toSelect)
        })
      }
      toSelect()
    },
  )
}
