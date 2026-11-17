#!/usr/bin/env python3
"""갈무리(Galmuri, SIL OFL 1.1) 도트 폰트를 게임에 쓰는 글자만 남겨 줄인다.

출력: data/font/Galmuri11.sub.woff2, Galmuri11-Bold.sub.woff2, chars.txt
포함 글자: ASCII, KS X 1001 완성형 한글 2,350자, 소스·데이터에 실제로 나오는 모든 글자, 기호 몇 개.
실행: python3 tools/subset_font.py   (fonttools, brotli 필요. 대사를 고친 뒤 다시 실행)
"""
import glob, json, os, subprocess, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
chars = set(chr(c) for c in range(0x20, 0x7F))
# KS X 1001 한글 2,350자
for hi in range(0xB0, 0xC9):
    for lo in range(0xA1, 0xFF):
        try:
            chars.add(bytes([hi, lo]).decode('euc-kr'))
        except UnicodeDecodeError:
            pass
chars.update('♥♡★☆▶◀▲▼♪♬×→←↑↓↗⚠·…‘’“”「」『』〈〉《》○●◎◆◇■□△▽※℃㎞㎡ㅋㅎㅠㅜㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅌㅍ·大關嶺')
for pat in ('src/*.js', 'src/**/*.js', 'tools/template.html', 'data/features.json'):
    for f in glob.glob(os.path.join(root, pat), recursive=True):
        if f.endswith('_data.generated.js'):
            continue
        chars.update(open(f, encoding='utf8').read())
chars = sorted(c for c in chars if ord(c) >= 0x20)
out = os.path.join(root, 'data/font')
os.makedirs(out, exist_ok=True)
open(os.path.join(out, 'chars.txt'), 'w', encoding='utf8').write(''.join(chars))
from fontTools.ttLib import TTFont
for name in ('Galmuri11', 'Galmuri11-Bold'):
    src = os.path.join(root, 'node_modules/galmuri/dist', name + '.ttf')
    dst = os.path.join(out, name + '.sub.woff2')
    subprocess.check_call([sys.executable, '-m', 'fontTools.subset', src, '--text-file=' + os.path.join(out, 'chars.txt'),
                           '--flavor=woff2', '--output-file=' + dst, '--layout-features=', '--no-hinting', '--desubroutinize'])
    cm = TTFont(dst).getBestCmap()
    missing = [c for c in chars if ord(c) not in cm and ord(c) > 0x7F]
    print(f'{name}: {os.path.getsize(dst)//1024} KB, {len(cm)} glyphs, 폰트에 없는 글자 {len(missing)}개: {"".join(missing)[:60]}')
