#!/usr/bin/env python3
"""Overture 원자료(raw/*.json) -> 게임용 지역좌표 피처(features.json) + 토지피복 래스터.

좌표: [x(동, m), n(북, m)] — 원점은 dem.json의 lon0/lat0. 게임에서는 z = -n.
"""
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw

raw, out = sys.argv[1], sys.argv[2]
meta = json.load(open(f"{raw}/dem.json"))
LON0, LAT0, R = meta["lon0"], meta["lat0"], meta["R"]
KX = math.radians(1) * R * math.cos(math.radians(LAT0)); KY = math.radians(1) * R
course = np.array(json.load(open(f"{raw}/course_path.json"))["points"])
cx = (course[:, 0] - LON0) * KX; cy = (course[:, 1] - LAT0) * KY
cs = np.concatenate([[0], np.cumsum(np.hypot(np.diff(cx), np.diff(cy)))])
# 코스를 5 m 간격으로 촘촘히 (거리 판정용)
dense_s = np.arange(0, cs[-1], 5.0)
dx = np.interp(dense_s, cs, cx); dy = np.interp(dense_s, cs, cy)

def loc(p):
    return ((p[0] - LON0) * KX, (p[1] - LAT0) * KY)

def near(x, y):
    d = np.hypot(dx - x, dy - y); i = int(d.argmin())
    return float(d[i]), float(dense_s[i])

def load(n):
    return json.load(open(f"{raw}/{n}.json"))["features"]

def r1(v):
    return round(v, 1)

def flat(pts):
    o = []
    for x, y in pts:
        o += [r1(x), r1(y)]
    return o

def name_of(p):
    return (p.get("names") or {}).get("primary")

F = {}
# ---- 토지피복 래스터 (25 m)
nx0, ny0 = meta["near"]["x0"], meta["near"]["y0"]
W = int((meta["near"]["nx"] - 1) * meta["near"]["step"] / 25); H = int((meta["near"]["ny"] - 1) * meta["near"]["step"] / 25)
img = Image.new("L", (W, H), 0); dr = ImageDraw.Draw(img)
CODE = {"forest": 1, "shrub": 2, "crop": 3, "barren": 5, "urban": 4}
lc = [f for f in load("land_cover") if f["properties"]["cartography"]["max_zoom"] >= 13]
for sub in ("forest", "shrub", "crop", "barren", "urban"):
    for f in lc:
        if f["properties"]["subtype"] != sub: continue
        g = f["geometry"]; polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            ring = [((loc(p)[0] - nx0) / 25, (loc(p)[1] - ny0) / 25) for p in poly[0]]
            if len(ring) >= 3: dr.polygon(ring, fill=CODE[sub])
water = load("water")
wpolys = []
for f in water:
    p = f["properties"]; g = f["geometry"]
    if g["type"] == "Polygon" and p.get("subtype") in ("river", "reservoir", "lake", "pond"):
        ring = [loc(q) for q in g["coordinates"][0]]
        dr.polygon([((x - nx0) / 25, (y - ny0) / 25) for x, y in ring], fill=6)
        if min(near(x, y)[0] for x, y in ring[::5]) < 2500:
            wpolys.append({"k": p.get("subtype"), "name": name_of(p), "p": flat(ring[:-1])})
lcarr = np.asarray(img)
print("landcover raster", W, H, {int(k): int(v) for k, v in zip(*np.unique(lcarr, return_counts=True))})
F["landcover"] = {"x0": nx0, "y0": ny0, "step": 25, "nx": W, "ny": H}
lcarr.astype("u1").tofile(f"{out}/landcover.u8")
F["waterPolys"] = wpolys
# ---- 하천(선)
streams = []
for f in water:
    p = f["properties"]; g = f["geometry"]
    if g["type"] != "LineString": continue
    pts = [loc(q) for q in g["coordinates"]]
    keep = [near(x, y)[0] < 900 for x, y in pts]
    run = []
    for (pt, k) in zip(pts, keep):
        if k: run.append(pt)
        else:
            if len(run) >= 2: streams.append({"k": p.get("class"), "name": name_of(p), "p": flat(run)})
            run = []
    if len(run) >= 2: streams.append({"k": p.get("class"), "name": name_of(p), "p": flat(run)})
F["streams"] = streams
# ---- 건물
blds = []
for f in load("building"):
    g = f["geometry"]; ring = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"][0][0]
    pts = [loc(q) for q in ring]
    cxm = sum(p[0] for p in pts) / len(pts); cym = sum(p[1] for p in pts) / len(pts)
    d, s = near(cxm, cym)
    if d < 450:
        blds.append({"p": flat(pts[:-1]), "s": round(s), "d": round(d)})
F["buildings"] = blds
# ---- 다른 도로
course_set = {(round(a, 7), round(b, 7)) for a, b in course}
WIDTH = {"trunk": 8, "primary": 7.5, "secondary": 7, "tertiary": 6, "residential": 4.5, "unclassified": 4.5,
         "living_street": 4, "service": 3.5, "track": 2.6}
roads = []
for f in load("segments"):
    p = f["properties"]; g = f["geometry"]
    if p.get("subtype") != "road" or g["type"] != "LineString": continue
    cls = p.get("class")
    if cls not in WIDTH: continue
    flags = [v for r in (p.get("road_flags") or []) for v in (r.get("values") or [])]
    if "is_tunnel" in flags: continue
    c = g["coordinates"]
    on = [(round(a, 7), round(b, 7)) in course_set for a, b in c]
    pts = [loc(q) for q in c]
    run = []
    def flush():
        if len(run) >= 2: roads.append({"c": cls, "w": WIDTH[cls], "p": flat(run), "br": 1 if "is_bridge" in flags else 0})
    for i, pt in enumerate(pts):
        # 코스 자체인 구간(양 끝이 모두 코스 정점)은 제외
        if near(*pt)[0] < 650 and not (on[i] and ((i + 1 < len(pts) and on[i + 1]) or (i > 0 and on[i - 1]))):
            run.append(pt)
        elif on[i] and run:
            run.append(pt); flush(); run = []
        else:
            flush(); run = []
            if on[i] and i + 1 < len(pts) and not on[i + 1]: run = [pt]
    flush()
F["roads"] = roads
# ---- 지점
inf = load("infrastructure")
turb, towers, stops, views, parks, bridges = [], [], [], [], [], []
for f in inf:
    p = f["properties"]; g = f["geometry"]; cls = p.get("class")
    tags = dict((a, b) for a, b in (p.get("source_tags") or []))
    if g["type"] == "Point":
        x, y = loc(g["coordinates"]); d, s = near(x, y)
        if cls == "generator" and tags.get("generator:source") == "wind": turb.append([r1(x), r1(y)])
        elif cls == "power_tower": towers.append([r1(x), r1(y)])
        elif cls == "bus_stop" and d < 16: stops.append({"p": [r1(x), r1(y)], "s": round(s), "name": name_of(p)})
        elif cls == "viewpoint" and d < 400: views.append({"p": [r1(x), r1(y)], "s": round(s), "d": round(d), "name": name_of(p)})
    elif g["type"] == "Polygon" and cls == "parking":
        ring = [loc(q) for q in g["coordinates"][0]]
        d, s = near(sum(a for a, _ in ring) / len(ring), sum(b for _, b in ring) / len(ring))
        if d < 260: parks.append({"p": flat(ring[:-1]), "s": round(s), "d": round(d)})
    elif g["type"] == "LineString" and cls == "bridge":
        pts = [loc(q) for q in g["coordinates"]]
        ds = [near(*q) for q in pts]
        if max(d for d, _ in ds) < 6:
            ss = sorted(s for _, s in ds); bridges.append({"s0": round(ss[0], 1), "s1": round(ss[-1], 1), "name": name_of(p)})
F["turbines"], F["towers"], F["busStops"], F["viewpoints"], F["parking"], F["bridges"] = turb, towers, stops, views, parks, bridges
pois = []
for f in load("place"):
    p = f["properties"]; x, y = loc(f["geometry"]["coordinates"]); d, s = near(x, y)
    if d < 160 and (p.get("confidence") or 0) > 0.45 and name_of(p):
        pois.append({"name": name_of(p), "p": [r1(x), r1(y)], "s": round(s), "d": round(d), "cat": (p.get("categories") or {}).get("primary")})
F["pois"] = sorted(pois, key=lambda q: q["s"])
json.dump(F, open(f"{out}/features.json", "w"), ensure_ascii=False, separators=(",", ":"))
for k, v in F.items():
    print(k, len(v) if isinstance(v, list) else v)
print("bridges", bridges); print("pois", [(q["name"], q["s"], q["d"]) for q in F["pois"]])
print("stops", [(q["s"], q["name"]) for q in stops])
