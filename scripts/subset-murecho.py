# -*- coding: utf-8 -*-
# Subsetea Murecho (variable, eje wght 100-900) para la PWA.
# Entrada: raw/font/Murencho/Murecho-VariableFont_wght.ttf (fuera del repo).
# Salida:  public/fonts/murecho-var-subset.woff2
#
# Cobertura: latino + puntuación tipográfica + kana completo (margen para UI
# futura) + los glifos JP de jp_glyphs.py. Verificación dura: el script FALLA
# si al woff2 le falta algo pedido, salvo los glifos que Murecho no trae de
# fábrica Y están en GLYPHS (los cubre el fallback noto-serif-jp-subset en
# --jp). Estado conocido: a Murecho le faltan 發 搶 槓 → Noto se queda.
#
# Uso: python scripts/subset-murecho.py  (parte de `npm run assets:fonts`)

import io
import os
import sys

from fontTools.subset import main as subset
from fontTools.ttLib import TTFont

from jp_glyphs import GLYPHS

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'raw', 'font', 'Murencho', 'Murecho-VariableFont_wght.ttf')
DST = os.path.join(HERE, '..', 'public', 'fonts', 'murecho-var-subset.woff2')

# Rangos además de GLYPHS: latino, puntuación tipográfica, CJK básica y kana.
UNICODES = ','.join([
    'U+0000-00FF',   # latino-1 (la UI vive aquí)
    'U+2013-2014',   # – —
    'U+2018-201D',   # comillas tipográficas
    'U+2026',        # …
    'U+00D7',        # × (ya en latino-1; explícito por claridad)
    'U+3000-3002',   # espacio ideográfico 、 。
    'U+300C-300D',   # 「 」
    'U+30FB-30FC',   # ・ ー
    'U+3041-3096',   # hiragana
    'U+30A1-30FA',   # katakana
])

if not os.path.exists(SRC):
    sys.exit('no existe %s — raw/ tiene respaldo externo, restáuralo' % SRC)

subset([
    SRC,
    '--unicodes=%s' % UNICODES,
    '--text=%s' % GLYPHS,
    '--flavor=woff2',
    '--output-file=%s' % DST,
    '--layout-features=',       # sin features OpenType: solo formas
    '--no-hinting',
    '--desubroutinize',
])

# --- verificación dura del cmap ------------------------------------------------

src_cmap = TTFont(SRC).getBestCmap()
out_cmap = TTFont(DST).getBestCmap()

wanted = set()
for part in UNICODES.split(','):
    lo, _, hi = part[2:].partition('-')
    wanted.update(range(int(lo, 16), int(hi or lo, 16) + 1))
wanted.update(ord(c) for c in GLYPHS)

fallback_ok = {ord(c) for c in GLYPHS}  # lo que puede cubrir el subset de Noto
errors = []
warned = []
for cp in sorted(wanted):
    if cp in out_cmap:
        continue
    if cp < 0x20 or 0x7F <= cp <= 0x9F:
        continue  # caracteres de control: nunca están en una fuente
    if cp not in src_cmap:
        # Murecho no lo trae de fábrica: tolerable solo si Noto lo cubre
        if cp in fallback_ok:
            warned.append(cp)
        elif cp < 0x3000:
            errors.append(cp)  # latino/puntuación tiene que estar sí o sí
        # kana/CJK básica ausente del original: margen, no bloquea
    else:
        errors.append(cp)  # estaba en el original y el subset lo perdió

if warned:
    print('sin cubrir por Murecho (los pinta Noto vía fallback de --jp): %s'
          % ' '.join('%s(U+%04X)' % (chr(cp), cp) for cp in warned))
if errors:
    sys.exit('FALTAN en el subset: %s'
             % ' '.join('%s(U+%04X)' % (chr(cp), cp) for cp in errors))

axes = ['%s %g..%g' % (a.axisTag, a.minValue, a.maxValue) for a in TTFont(DST)['fvar'].axes]
print('murecho-var-subset.woff2  %.1f KB  (ejes: %s)'
      % (os.path.getsize(DST) / 1024.0, ', '.join(axes)))
