// Ajustes: round-trip, clamp, merge de parciales y rechazo de valores inválidos.
// localStorage se stubea (entorno node de vitest no lo trae).

import { describe, it, expect, beforeEach } from 'vitest'
import { loadSettings, saveSettings, DEFAULTS } from '../src/ui/settings'

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null { return this.m.get(k) ?? null }
  setItem(k: string, v: string): void { this.m.set(k, v) }
  removeItem(k: string): void { this.m.delete(k) }
  clear(): void { this.m.clear() }
}

beforeEach(() => {
  ;(globalThis as { localStorage: Storage }).localStorage = new MemStorage() as unknown as Storage
})

describe('settings', () => {
  it('devuelve DEFAULTS cuando no hay nada guardado', () => {
    expect(loadSettings()).toEqual(DEFAULTS)
  })

  it('round-trip: guarda y recupera igual', () => {
    const s = { ...DEFAULTS, tableTheme: 'wood' as const, volumes: { ...DEFAULTS.volumes, music: 0.3 } }
    saveSettings(s)
    expect(loadSettings()).toEqual(s)
  })

  it('clampa volúmenes fuera de rango a 0..1', () => {
    localStorage.setItem('tm-settings-v1', JSON.stringify({ volumes: { master: 5, music: -2, sfx: 0.5, voices: 1 } }))
    const v = loadSettings().volumes
    expect(v.master).toBe(1)
    expect(v.music).toBe(0)
    expect(v.sfx).toBe(0.5)
  })

  it('rellena con DEFAULTS los campos ausentes', () => {
    localStorage.setItem('tm-settings-v1', JSON.stringify({ tableTheme: 'red' }))
    const s = loadSettings()
    expect(s.tableTheme).toBe('red')
    expect(s.volumes).toEqual(DEFAULTS.volumes)
    expect(s.tileBack).toBe(DEFAULTS.tileBack)
  })

  it('ignora tema/dorso inválidos y JSON corrupto', () => {
    localStorage.setItem('tm-settings-v1', JSON.stringify({ tableTheme: 'purple', tileBack: 'gold' }))
    const s = loadSettings()
    expect(s.tableTheme).toBe(DEFAULTS.tableTheme)
    expect(s.tileBack).toBe(DEFAULTS.tileBack)

    localStorage.setItem('tm-settings-v1', '{ not json')
    expect(loadSettings()).toEqual(DEFAULTS)
  })
})
