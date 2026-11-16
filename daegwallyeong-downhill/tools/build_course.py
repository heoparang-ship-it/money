#!/usr/bin/env python3
"""Overture 세그먼트에서 코스 1(대관령 표지석 -> 성산회전교차로 서쪽)을 복원한다."""
import json, math, sys, heapq, collections, hashlib

segs = json.load(open(sys.argv[1]))["features"]
START = (128.7602135, 37.6871337)
END = (128.8250148, 37.7154738)

def hav(a, b, R=6371008.8):
    lo1, la1, lo2, la2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 2*R*math.asin(math.sqrt(h))

roads = [f for f in segs if f["properties"].get("subtype") == "road" and f["geometry"]["type"] == "LineString"]
print("roads", len(roads), collections.Counter(f["properties"].get("class") for f in roads).most_common())
key = lambda p: (round(p[0], 7), round(p[1], 7))
# 그래프: 모든 꼭짓점을 노드로 (세그먼트 중간에서도 이어질 수 있게)
adj = collections.defaultdict(list)
for fi, f in enumerate(roads):
    cls = f["properties"].get("class")
    if cls in ("motorway", "footway", "path", "steps", "cycleway", "pedestrian", "track", "bridleway"):
        continue
    c = f["geometry"]["coordinates"]
    for i in range(len(c)-1):
        a, b = key(c[i]), key(c[i+1])
        d = hav(a, b)
        adj[a].append((b, d, fi)); adj[b].append((a, d, fi))
def nearest(p):
    return min(adj, key=lambda n: hav(n, p))
s, e = nearest(START), nearest(END)
print("start node", s, "err m", hav(s, START), " end node", e, "err m", hav(e, END))
dist = {s: 0.0}; prev = {}; pq = [(0.0, s)]
while pq:
    d, u = heapq.heappop(pq)
    if u == e: break
    if d > dist.get(u, 1e18): continue
    for v, w, fi in adj[u]:
        nd = d + w
        if nd < dist.get(v, 1e18):
            dist[v] = nd; prev[v] = (u, fi); heapq.heappush(pq, (nd, v))
path = [e]; fis = []
while path[-1] != s:
    u, fi = prev[path[-1]]; path.append(u); fis.append(fi)
path.reverse(); fis.reverse()
L = sum(hav(path[i], path[i+1]) for i in range(len(path)-1))
print("points", len(path), "length m (R=6371008.8)", round(L, 3), " R=6371000:", round(L*6371000/6371008.8, 3), " R=6378137:", round(L*6378137/6371008.8, 3))
used = []
for fi in fis:
    if not used or used[-1] != fi: used.append(fi)
print("overture segments used", len(used))
ways = []
for fi in used:
    p = roads[fi]["properties"]
    for src in (p.get("sources") or []):
        rid = src.get("record_id")
        if rid and (not ways or ways[-1] != rid.split("@")[0]): ways.append(rid.split("@")[0])
    print("  ", p.get("class"), (p.get("names") or {}).get("primary"), [r.get("ref") for r in (p.get("routes") or [])], p.get("road_surface"), [x.get("record_id") for x in (p.get("sources") or [])][:2], len(roads[fi]["geometry"]["coordinates"]))
uw = []
for w in ways:
    if w not in uw: uw.append(w)
print("distinct OSM ways:", len(uw), uw)
seg_d = sorted(hav(path[i], path[i+1]) for i in range(len(path)-1))
print("vertex spacing median", round(seg_d[len(seg_d)//2], 2), "max", round(seg_d[-1], 2))
for fmt in ("lonlat", "latlon"):
    arr = [[p[0], p[1]] if fmt == "lonlat" else [p[1], p[0]] for p in path]
    for sep in ((",", ":"), (", ", ": ")):
        print(fmt, sep, hashlib.sha256(json.dumps(arr, separators=sep).encode()).hexdigest())
json.dump({"points": [[p[0], p[1]] for p in path], "length_m": L, "osm_ways": uw}, open(sys.argv[2], "w"))
