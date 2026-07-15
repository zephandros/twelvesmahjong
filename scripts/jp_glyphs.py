# -*- coding: utf-8 -*-
# Lista única de glifos JP que pinta la UI. La comparten subset-jp.py (Noto)
# y subset-murecho.py (Murecho). Si añades kanji nuevos a la UI: amplía aquí
# y relanza `npm run assets:fonts`.

GLYPHS = (
    '麻雀トウェルブス'  # título: Mahjong Twelves (麻雀トウェルブス)
    '咲'            # marca 咲 (icono / acentos)
    '東南西北'       # vientos
    '白發中'         # dragones (發 NO existe en Murecho: lo cubre Noto)
    '一二三四五六七八九'  # numerales de kyoku
    '局'            # 東一局
    '流途中'         # 流局 / 途中流局
    '搶槓'           # chankan (tampoco en Murecho: lo cubre Noto)
    'ツモロン'        # katakana de tsumo/ron
    'プレイヤー対戦者'  # selección de personaje (slots)
    'キャラクター選択'  # subtítulo de la pantalla de selección
    'フリー'          # フリー対局
    '対'            # (por si 対局 aparece suelto)
)
