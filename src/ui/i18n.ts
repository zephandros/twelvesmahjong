// Capa de i18n. La fuente de verdad es i18n/strings.csv, compilado a
// i18n-strings.generated.ts por `npm run assets:i18n`. Sin framework: t()
// resuelve la clave en el locale activo con fallback a es; los módulos de UI
// NUNCA resuelven t() en top-level (guardan claves y traducen al renderizar),
// así el cambio de idioma en caliente solo requiere re-pintar.

import { MESSAGES, type MsgKey } from './i18n-strings.generated'
import type { YakuId } from '../core/yaku'
import type { Limit } from '../core/score'
import type { AbortReason } from '../core/state'
import type { WindName } from '../core/seat'
import type { CharacterId } from './characters'

export type Locale = 'es' | 'en' | 'ja'
export const LOCALES: readonly Locale[] = ['es', 'en', 'ja']

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale)

// Aserción compile-time: si el CSV pierde una clave derivada de un id del core
// (yaku, límite, aborto, viento, personaje), este tipo no compila y
// `npm run build` (tsc --noEmit) lo corta. Exportado para que no cuente como
// tipo sin usar.
type AssertKeys<T extends MsgKey> = T
export type DerivedKeyCheck = AssertKeys<
  | `yaku.${YakuId}`
  | `limit.${Limit}`
  | `abort.${AbortReason}`
  | `wind.${WindName}`
  | `char.${CharacterId}.name`
  | `char.${CharacterId}.epithet`
>

let locale: Locale = 'es'

export function getLocale(): Locale {
  return locale
}

/** Fija el locale activo y refleja el idioma en <html lang>. */
export function setLocale(l: Locale): void {
  locale = l
  if (typeof document !== 'undefined') document.documentElement.lang = l
}

/** Locale inicial a partir del idioma del navegador; es es el fallback. */
export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'es'
  for (const lang of navigator.languages ?? [navigator.language]) {
    const base = lang?.slice(0, 2).toLowerCase()
    if (isLocale(base)) return base
  }
  return 'es'
}

/**
 * Traduce una clave con interpolación `{x}`. Celda en/ja vacía en el CSV =
 * fallback a es (build-i18n.mjs garantiza que es nunca falta).
 */
export function t(key: MsgKey, params?: Record<string, string | number>): string {
  const entry = MESSAGES[key] as { es: string; en?: string; ja?: string }
  let s = entry[locale] ?? entry.es
  if (params) s = s.replace(/\{(\w+)\}/g, (raw, k: string) => (k in params ? String(params[k]) : raw))
  return s
}

/** Etiqueta de un yaku; los contadores de dora interpolan su han como {n}. */
export function yakuLabel(y: { id: YakuId; han: number }): string {
  return t(`yaku.${y.id}`, { n: y.han })
}
