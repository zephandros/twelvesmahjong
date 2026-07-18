# -*- coding: utf-8 -*-
# Lista única de glifos JP que pinta la UI. La consumen subset-jp.py (Kosugi)
# y la validación de build-i18n.mjs. Si añades kanji nuevos a la UI: amplía
# aquí y relanza `npm run assets:fonts`.

GLYPHS = (
    '麻雀トウェルブス'  # título: Mahjong Twelves (麻雀トウェルブス)
    '咲'            # marca 咲 (icono / acentos)
    '東南西北'       # vientos
    '白發中'         # dragones
    '一二三四五六七八九'  # numerales de kyoku
    '局'            # 東一局
    '流途中'         # 流局 / 途中流局
    '搶槓'           # chankan
    'ツモロン'        # katakana de tsumo/ron
    'プレイヤー対戦者'  # selección de personaje (slots)
    'キャラクター選択'  # subtítulo de la pantalla de selección
    'フリー'          # フリー対局
    '対'            # (por si 対局 aparece suelto)
    '親'            # insignia de dealer (oya)
    # i18n: glifos de i18n/strings.csv (las 3 columnas). build-i18n.mjs valida
    # que todo glifo CJK/kana del CSV esté aquí; al añadir textos nuevos, amplía
    # esta entrada y relanza `npm run assets:fonts`.
    'ゥズ・マジチ風設定オディ閉じるダム開始メニュに戻あなたの番捨て牌を鳴きますか？'
    'カ種ポセテ背言語退出続け残り本場位終了再翻符役満荒断聴ノ連打家立直グベッドエアバコ'
    '全体音楽効果ボ自動日発門前清摸和海底月河撈魚嶺上花天地平幺盃口色同順刻気通貫々暗子'
    '混老頭純帯小元国士無双大喜字緑蓮宝燈裏赤跳倍数え不思議ビ代書人シヘザ千夜肖像画つ顔'
    'ハミピナ仲ァ夫編み手糸し切'
    '生時停止曲次ュ解除'  # reproductor de música in-game (music.*)
    'はい'            # confirmación del menú in-game (hud.yes)
)
