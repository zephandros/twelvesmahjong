// Declaraciones de build-i18n.mjs para que tests/i18n.test.ts pueda importar
// el parser/validador real (única implementación) bajo el typecheck estricto.

export interface I18nEntry {
  es: string
  en?: string
  ja?: string
}

export declare const CSV_PATH: string
export declare const GLYPHS_PATH: string

export declare function parseCsv(text: string): string[][]
export declare function buildMessages(csvText: string): Record<string, I18nEntry>
export declare function glyphsOf(pyText: string): Set<string>
export declare function missingGlyphs(
  messages: Record<string, I18nEntry>,
  glyphSet: Set<string>,
): string[]
