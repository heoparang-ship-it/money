#!/usr/bin/env python3
"""Overture Maps(GeoParquet, 공개 S3)에서 bbox 안의 피처만 HTTP range 요청으로 뽑는다.

OSM API 호스트에 접근할 수 없는 환경에서, 같은 OSM 원천 도로(ODbL)를 얻기 위한 도구.
사용: fetch_overture.py <theme> <type> <xmin> <ymin> <xmax> <ymax> <out.json> [release]
"""
import io
import json
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

import pyarrow.parquet as pq
import requests

BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com"
_tls = threading.local()


def sess():
    if not hasattr(_tls, "s"):
        _tls.s = requests.Session()
    return _tls.s


class HttpRangeFile(io.RawIOBase):
    """읽기 전용, range 요청 기반 파일 객체 (pyarrow용). 꼬리 부분은 한 번에 캐시."""

    def __init__(self, url, size, tail_bytes=1 << 20):
        self.url, self.size, self.pos = url, size, 0
        self.cache = []  # (start, bytes)
        if tail_bytes:
            start = max(0, size - tail_bytes)
            self.cache.append((start, self._get(start, size - 1)))

    def _get(self, a, b):
        for attempt in range(5):
            try:
                r = sess().get(self.url, headers={"Range": f"bytes={a}-{b}"}, timeout=120)
                if r.status_code in (200, 206):
                    return r.content
            except requests.RequestException:
                pass
        raise IOError(f"range fetch failed {self.url} {a}-{b}")

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0:
            return b""
        a, b = self.pos, self.pos + n
        for st, data in self.cache:
            if st <= a and b <= st + len(data):
                self.pos = b
                return data[a - st:b - st]
        data = self._get(a, b - 1)
        if len(data) < (8 << 20):
            self.cache.append((a, data))
        self.pos = b
        return data

    def readinto(self, buf):
        d = self.read(len(buf))
        buf[: len(d)] = d
        return len(d)


def list_files(release, theme, typ):
    keys, token = [], None
    while True:
        url = f"{BUCKET}/?list-type=2&prefix=release/{release}/theme={theme}/type={typ}/"
        if token:
            url += "&continuation-token=" + requests.utils.quote(token, safe="")
        x = sess().get(url, timeout=60).text
        for m in re.finditer(r"<Contents>.*?<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>.*?</Contents>", x, re.S):
            keys.append((m.group(1), int(m.group(2))))
        t = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", x)
        if not t:
            break
        token = t.group(1)
    return keys


def scan_file(args):
    key, size, q = args
    url = f"{BUCKET}/{key}"
    f = HttpRangeFile(url, size, tail_bytes=3 << 20)
    try:
        pf = pq.ParquetFile(f)
    except Exception as e:  # footer가 꼬리 캐시보다 큰 경우 등
        f = HttpRangeFile(url, size, tail_bytes=24 << 20)
        pf = pq.ParquetFile(f)
    md = pf.metadata
    hits = []
    for i in range(md.num_row_groups):
        rg = md.row_group(i)
        st = {}
        for j in range(rg.num_columns):
            c = rg.column(j)
            p = c.path_in_schema
            if p.startswith("bbox.") and c.statistics is not None and c.statistics.has_min_max:
                st[p] = (c.statistics.min, c.statistics.max)
        if len(st) < 4:
            hits.append(i)
            continue
        if (st["bbox.xmin"][0] <= q[2] and st["bbox.xmax"][1] >= q[0]
                and st["bbox.ymin"][0] <= q[3] and st["bbox.ymax"][1] >= q[1]):
            hits.append(i)
    return key, size, hits, md.num_row_groups


def jsonable(v):
    if isinstance(v, (bytes, bytearray)):
        return None
    if isinstance(v, dict):
        return {k: jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def wkb_to_coords(b):
    """WKB(Point/LineString/Polygon/Multi*) -> GeoJSON geometry dict (2D)."""
    import struct

    def rd(buf, off):
        bo = "<" if buf[off] == 1 else ">"
        (t,) = struct.unpack_from(bo + "I", buf, off + 1)
        off += 5
        t &= 0xFF
        if t == 1:
            x, y = struct.unpack_from(bo + "2d", buf, off)
            return {"type": "Point", "coordinates": [x, y]}, off + 16
        if t == 2:
            (n,) = struct.unpack_from(bo + "I", buf, off)
            off += 4
            pts = struct.unpack_from(bo + f"{2*n}d", buf, off)
            return {"type": "LineString", "coordinates": [[pts[2*i], pts[2*i+1]] for i in range(n)]}, off + 16 * n
        if t == 3:
            (nr,) = struct.unpack_from(bo + "I", buf, off)
            off += 4
            rings = []
            for _ in range(nr):
                (n,) = struct.unpack_from(bo + "I", buf, off)
                off += 4
                pts = struct.unpack_from(bo + f"{2*n}d", buf, off)
                rings.append([[pts[2*i], pts[2*i+1]] for i in range(n)])
                off += 16 * n
            return {"type": "Polygon", "coordinates": rings}, off
        if t in (4, 5, 6):
            (n,) = struct.unpack_from(bo + "I", buf, off)
            off += 4
            parts = []
            for _ in range(n):
                g, off = rd(buf, off)
                parts.append(g["coordinates"])
            return {"type": {4: "MultiPoint", 5: "MultiLineString", 6: "MultiPolygon"}[t], "coordinates": parts}, off
        raise ValueError(f"wkb type {t}")

    return rd(bytes(b), 0)[0]


def main():
    theme, typ = sys.argv[1], sys.argv[2]
    q = tuple(float(v) for v in sys.argv[3:7])
    out = sys.argv[7]
    release = sys.argv[8] if len(sys.argv) > 8 else "2026-10-21.0"
    files = list_files(release, theme, typ)
    print(f"{len(files)} files, {sum(s for _, s in files)/1e9:.1f} GB", flush=True)
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(scan_file, [(k, s, q) for k, s in files]))
    todo = [(k, s, h) for k, s, h, n in res if h]
    print("candidate row groups:", [(k.split('/')[-1][:10], h) for k, s, h in todo], flush=True)
    feats = []
    for key, size, hits in todo:
        f = HttpRangeFile(f"{BUCKET}/{key}", size, tail_bytes=24 << 20)
        pf = pq.ParquetFile(f)
        for i in hits:
            t = pf.read_row_group(i)
            cols = t.column_names
            bb = t.column("bbox").to_pylist()
            keep = [n for n, b in enumerate(bb)
                    if b and b["xmin"] <= q[2] and b["xmax"] >= q[0] and b["ymin"] <= q[3] and b["ymax"] >= q[1]]
            print(f"  rg {i}: {t.num_rows} rows, {len(keep)} in bbox", flush=True)
            if not keep:
                continue
            sub = t.take(keep).to_pylist()
            for row in sub:
                geom = wkb_to_coords(row.pop("geometry"))
                row.pop("bbox", None)
                feats.append({"type": "Feature", "geometry": geom, "properties": jsonable(row)})
    json.dump({"type": "FeatureCollection", "release": release, "bbox": q, "features": feats}, open(out, "w"), ensure_ascii=False)
    print("wrote", out, len(feats), "features")


if __name__ == "__main__":
    main()
