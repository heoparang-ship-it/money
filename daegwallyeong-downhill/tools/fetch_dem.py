#!/usr/bin/env python3
"""AWS Terrain Tiles(terrarium, Mapzen/Tilezen 공개 데이터)에서 실제 고도를 받아
게임용 지역 좌표(동쪽 x, 북쪽 y, 미터) 정규 격자로 리샘플한다.

출력: <out_prefix>_near.i16 / _far.i16 (Int16 LE, 데시미터, 행 우선: 북->남이 아니라 y 증가(남->북) 순)
      <out_prefix>.json (격자 메타)
"""
import io, json, math, sys
import numpy as np
import requests
from PIL import Image

R = 6371008.8
course = json.load(open(sys.argv[1]))
pts = np.array(course["points"])
LON0 = round(float((pts[:, 0].min() + pts[:, 0].max()) / 2), 6)
LAT0 = round(float((pts[:, 1].min() + pts[:, 1].max()) / 2), 6)
KX = math.radians(1) * R * math.cos(math.radians(LAT0))
KY = math.radians(1) * R
S = requests.Session()
_tiles = {}

def tile(z, tx, ty):
    k = (z, tx, ty)
    if k not in _tiles:
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png"
        for _ in range(5):
            r = S.get(url, timeout=60)
            if r.status_code == 200:
                break
        r.raise_for_status()
        a = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB")).astype(np.float64)
        _tiles[k] = a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
        print("tile", k, _tiles[k].min().round(1), _tiles[k].max().round(1), flush=True)
    return _tiles[k]

def sample(z, lon, lat):
    """lon/lat 배열 -> 고도(쌍선형 보간, 타일 경계 넘어 연속)."""
    n = 2 ** z
    gx = (lon + 180) / 360 * n * 256 - 0.5
    la = np.radians(lat)
    gy = (1 - np.log(np.tan(la) + 1 / np.cos(la)) / math.pi) / 2 * n * 256 - 0.5
    x0 = np.floor(gx).astype(int); y0 = np.floor(gy).astype(int)
    fx = gx - x0; fy = gy - y0
    def px(ix, iy):
        out = np.empty(ix.shape)
        tx = ix // 256; ty = iy // 256
        for (a, b) in set(zip(tx.ravel().tolist(), ty.ravel().tolist())):
            m = (tx == a) & (ty == b)
            t = tile(z, a, b)
            out[m] = t[iy[m] - b * 256, ix[m] - a * 256]
        return out
    return (px(x0, y0) * (1 - fx) * (1 - fy) + px(x0 + 1, y0) * fx * (1 - fy)
            + px(x0, y0 + 1) * (1 - fx) * fy + px(x0 + 1, y0 + 1) * fx * fy)

def grid(z, xmin, xmax, ymin, ymax, step):
    xs = np.arange(xmin, xmax + step / 2, step); ys = np.arange(ymin, ymax + step / 2, step)
    X, Y = np.meshgrid(xs, ys)
    h = sample(z, LON0 + X / KX, LAT0 + Y / KY)
    return xs, ys, h

cx = (pts[:, 0] - LON0) * KX; cy = (pts[:, 1] - LAT0) * KY
m = 1100.0
nx0 = math.floor((cx.min() - m) / 100) * 100; nx1 = math.ceil((cx.max() + m) / 100) * 100
ny0 = math.floor((cy.min() - m) / 100) * 100; ny1 = math.ceil((cy.max() + m) / 100) * 100
NEAR = 12.5
xs, ys, hn = grid(13, nx0, nx1, ny0, ny1, NEAR)
FAR = 125.0
fx0, fx1, fy0, fy1 = -19000.0, 27000.0, -17000.0, 17000.0
xf, yf, hf = grid(10, fx0, fx1, fy0, fy1, FAR)
hf = np.maximum(hf, 0.0)
out = sys.argv[2]
(np.round(hn * 10).astype("<i2")).tofile(out + "_near.i16")
(np.round(hf * 10).astype("<i2")).tofile(out + "_far.i16")
hc = sample(13, pts[:, 0], pts[:, 1])
meta = {"lon0": LON0, "lat0": LAT0, "R": R,
        "near": {"x0": nx0, "y0": ny0, "step": NEAR, "nx": len(xs), "ny": len(ys)},
        "far": {"x0": fx0, "y0": fy0, "step": FAR, "nx": len(xf), "ny": len(yf)},
        "unit": "decimeter int16 LE, row-major, rows = y(north) ascending",
        "source": "Mapzen/Tilezen Terrain Tiles (terrarium) on AWS Open Data; SRTM 등 공개 DEM 합성"}
json.dump(meta, open(out + ".json", "w"), indent=1)
print(meta)
print("near range", hn.min().round(1), hn.max().round(1), " far range", hf.min().round(1), hf.max().round(1))
print("course elev: start", hc[0].round(1), "end", hc[-1].round(1), "max", hc.max().round(1), "min", hc.min().round(1))
seg = np.hypot(np.diff(cx), np.diff(cy)); s = np.concatenate([[0], np.cumsum(seg)])
for k in range(0, 12600, 500):
    i = np.searchsorted(s, k); i = min(i, len(hc) - 1)
    print(f"  {k/1000:4.1f} km  {hc[i]:7.1f} m")
