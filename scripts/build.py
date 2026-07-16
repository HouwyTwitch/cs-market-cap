#!/usr/bin/env python3
"""Build the consolidated dataset the web app reads.

Scans data/<dd-mm-yyyy>/ folders, each optionally containing:
  - prices.json : { "<item name>": <price USD>, ... }
  - count.json  : { "<item name>": <units in existence>, ... }

and writes data/market.json with:
  - dates      : chronological list of snapshot dates (dd-mm-yyyy, for display)
  - isoDates   : same dates as yyyy-mm-dd (sortable / axis use)
  - totals     : per-date aggregates (aligned to dates)
  - items      : per-item aligned history (prices / counts / caps)

Market cap of an item on a date = price x count. An item only contributes to
market cap on dates where BOTH a price and a count are present. Missing items
or missing files are tolerated: absent values are recorded as null and simply
don't contribute.

Usage:  python3 scripts/build.py
"""
import json
import os
import re
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
OUT_PATH = os.path.join(DATA_DIR, "market.json")

DATE_RE = re.compile(r"^(\d{2})-(\d{2})-(\d{4})$")


def load_json(path):
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"  ! skipping {path}: {e}")
        return {}
    if not isinstance(data, dict):
        print(f"  ! skipping {path}: expected a JSON object")
        return {}
    return data


def coerce_number(v):
    """Return a non-negative float, or None if the value isn't usable."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if v >= 0 else None
    if isinstance(v, str):
        s = v.strip().replace(",", "").replace("$", "")
        try:
            f = float(s)
            return f if f >= 0 else None
        except ValueError:
            return None
    return None


def discover_dates():
    """Return [(datetime, 'dd-mm-yyyy', folder_path), ...] sorted chronologically."""
    found = []
    if not os.path.isdir(DATA_DIR):
        return found
    for name in os.listdir(DATA_DIR):
        folder = os.path.join(DATA_DIR, name)
        if not os.path.isdir(folder):
            continue
        m = DATE_RE.match(name)
        if not m:
            continue
        dd, mm, yyyy = (int(g) for g in m.groups())
        try:
            dt = datetime(yyyy, mm, dd)
        except ValueError:
            print(f"  ! skipping folder with invalid date: {name}")
            continue
        found.append((dt, name, folder))
    found.sort(key=lambda t: t[0])
    return found


def build():
    dates = discover_dates()
    if not dates:
        raise SystemExit(
            "No data/<dd-mm-yyyy>/ folders found. Add snapshots (or run "
            "scripts/gen_sample_data.py) then re-run this script."
        )

    display_dates = [name for _, name, _ in dates]
    iso_dates = [dt.strftime("%Y-%m-%d") for dt, _, _ in dates]

    # date index -> {name: price}, {name: count}
    per_date_prices = []
    per_date_counts = []
    all_names = set()
    for _, name, folder in dates:
        prices_raw = load_json(os.path.join(folder, "prices.json"))
        counts_raw = load_json(os.path.join(folder, "count.json"))
        prices = {k: coerce_number(v) for k, v in prices_raw.items()}
        counts = {k: coerce_number(v) for k, v in counts_raw.items()}
        prices = {k: v for k, v in prices.items() if v is not None}
        counts = {k: v for k, v in counts.items() if v is not None}
        per_date_prices.append(prices)
        per_date_counts.append(counts)
        all_names.update(prices.keys())
        all_names.update(counts.keys())
        print(f"  {name}: {len(prices)} prices, {len(counts)} counts")

    n = len(dates)
    items = []
    # per-date aggregates
    total_cap = [0.0] * n
    total_units = [0.0] * n
    items_with_cap = [0] * n
    price_sum = [0.0] * n
    price_n = [0] * n

    for name in sorted(all_names):
        prices = [per_date_prices[i].get(name) for i in range(n)]
        counts = [per_date_counts[i].get(name) for i in range(n)]
        caps = []
        for i in range(n):
            p, c = prices[i], counts[i]
            if p is not None and c is not None:
                cap = p * c
                caps.append(cap)
                total_cap[i] += cap
                total_units[i] += c
                items_with_cap[i] += 1
            else:
                caps.append(None)
            if p is not None:
                price_sum[i] += p
                price_n[i] += 1
        items.append({
            "name": name,
            "prices": [round(p, 4) if p is not None else None for p in prices],
            "counts": [int(c) if c is not None else None for c in counts],
            "caps": [round(c, 2) if c is not None else None for c in caps],
        })

    avg_price = [round(price_sum[i] / price_n[i], 4) if price_n[i] else None
                 for i in range(n)]

    out = {
        "generatedAt": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "dates": display_dates,
        "isoDates": iso_dates,
        "totals": {
            "marketCap": [round(v, 2) for v in total_cap],
            "unitsInExistence": [int(v) for v in total_units],
            "itemsWithCap": items_with_cap,
            "itemsTracked": [len(all_names)] * n,
            "avgPrice": avg_price,
        },
        "items": items,
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"\nWrote {OUT_PATH}")
    print(f"  {len(display_dates)} dates, {len(items)} items, {size_kb:.1f} KB")
    if total_cap:
        print(f"  latest total market cap: ${total_cap[-1]:,.0f}")


if __name__ == "__main__":
    build()
