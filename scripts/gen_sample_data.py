#!/usr/bin/env python3
"""Generate deterministic *sample* CS2 market data.

Writes data/<dd-mm-yyyy>/prices.json and data/<dd-mm-yyyy>/count.json for a
range of dates so the web app has something to render out of the box.

This is placeholder data only. Replace the data/ folders with real snapshots
(same format) and re-run scripts/build.py. Some items are intentionally dropped
on some dates to exercise the app's tolerance for missing entries.
"""
import json
import math
import os
import random
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")

# name -> (base_price_usd, base_supply, annual_drift)
# A spread of items: cheap+abundant, mid, and rare+expensive knives/gloves,
# so the market-cap distribution looks realistic (price x supply).
ITEMS = {
    "AK-47 | Redline (Field-Tested)":            (24.50, 1_450_000,  0.35),
    "AK-47 | Asiimov (Field-Tested)":            (58.10,   410_000,  0.55),
    "AK-47 | Vulcan (Minimal Wear)":             (185.00,   96_000,  0.70),
    "AK-47 | Fire Serpent (Field-Tested)":       (980.00,   14_500,  0.85),
    "M4A4 | Buzz Kill (Field-Tested)":           (14.33,   142_000,  0.10),
    "M4A4 | Howl (Minimal Wear)":                (5200.00,   3_200,  1.20),
    "M4A1-S | Hyper Beast (Field-Tested)":       (17.20,   360_000,  0.20),
    "M4A1-S | Printstream (Minimal Wear)":       (142.00,    88_000,  0.65),
    "AWP | Asiimov (Field-Tested)":              (92.00,   240_000,  0.45),
    "AWP | Dragon Lore (Field-Tested)":          (9800.00,    5_400,  1.05),
    "AWP | Neo-Noir (Minimal Wear)":             (48.70,   130_000,  0.30),
    "AWP | Wildfire (Factory New)":              (410.00,    22_000,  0.75),
    "Desert Eagle | Blaze (Factory New)":        (620.00,    41_000,  0.60),
    "Desert Eagle | Code Red (Factory New)":     (33.40,   210_000,  0.25),
    "USP-S | Kill Confirmed (Minimal Wear)":     (74.00,   150_000,  0.40),
    "USP-S | Neo-Noir (Field-Tested)":           (12.10,   280_000,  0.15),
    "Glock-18 | Fade (Factory New)":             (560.00,    31_000,  0.55),
    "Glock-18 | Water Elemental (Field-Tested)": (6.40,   320_000,  0.05),
    "P250 | See Ya Later (Factory New)":         (9.80,   180_000,  0.10),
    "SSG 08 | Blood in the Water (MW)":          (44.20,    70_000,  0.35),
    "'Blueberries' Buckshot | NSWC SEAL":        (14.33,    52_000,  0.20),
    "'Medium Rare' Crasswater | Guerrilla War":  (25.86,    31_000,  0.30),
    "'The Doctor' Romanov | Sabre":              (12.02,    47_000,  0.15),
    "'Two Times' McCoy | TACP Cavalry":          (7.06,    61_000,  0.05),
    "Karambit | Doppler (Factory New)":          (1650.00,   18_000,  0.90),
    "Karambit | Fade (Factory New)":             (2450.00,   11_500,  1.00),
    "Butterfly Knife | Slaughter (MW)":          (1180.00,    9_800,  0.80),
    "M9 Bayonet | Marble Fade (Factory New)":    (1320.00,   13_200,  0.85),
    "Bayonet | Tiger Tooth (Factory New)":       (740.00,    16_400,  0.70),
    "Flip Knife | Autotronic (Minimal Wear)":    (330.00,    12_100,  0.50),
    "Sport Gloves | Pandora's Box (FT)":         (3100.00,    6_100,  1.10),
    "Sport Gloves | Vice (Minimal Wear)":        (2650.00,    7_400,  1.05),
    "Specialist Gloves | Crimson Kimono (FT)":   (1450.00,    8_200,  0.75),
    "Driver Gloves | King Snake (Field-Tested)": (720.00,     9_900,  0.60),
    "Hand Wraps | Cobalt Skulls (Field-Tested)": (540.00,    10_800,  0.55),
    "StatTrak AK-47 | Neon Rider (MW)":          (95.00,    44_000,  0.45),
    "StatTrak AWP | Hyper Beast (FT)":           (120.00,    38_000,  0.40),
    "SG 553 | Cyrex (Factory New)":              (28.90,    64_000,  0.20),
    "FAMAS | Roll Cage (Factory New)":           (4.20,   190_000,  0.05),
    "MP9 | Starlight Protector (FN)":            (22.30,    58_000,  0.25),
    "Galil AR | Chatterbox (Minimal Wear)":      (66.00,    52_000,  0.35),
    "Five-SeveN | Hyper Beast (Factory New)":    (18.70,    72_000,  0.15),
    "Nova | Hyper Beast (Factory New)":          (13.40,    83_000,  0.10),
    "Sticker | Katowice 2014 Holo":              (2200.00,    2_100,  1.15),
    "Souvenir AWP | Dragon Lore (FN)":           (18500.00,     420,  1.30),
}

# Number of daily snapshots to generate, ending today.
NUM_DAYS = 12
random.seed(42)


def gen():
    end = date(2026, 7, 16)
    dates = [end - timedelta(days=NUM_DAYS - 1 - i) for i in range(NUM_DAYS)]

    # Per-item smooth random-walk multipliers so history looks organic.
    walks = {}
    for name, (price, supply, drift) in ITEMS.items():
        # daily drift derived from annual drift, plus per-item volatility
        daily_drift = (drift / 365.0)
        vol = 0.012 + random.random() * 0.03
        pmult = 1.0
        smult = 1.0
        series = []
        for _ in dates:
            series.append((pmult, smult))
            shock = random.gauss(daily_drift, vol)
            pmult *= (1 + shock)
            # supply drifts slowly upward as new items enter circulation
            smult *= (1 + max(0.0, random.gauss(0.0009, 0.0006)))
        walks[name] = series

    for di, d in enumerate(dates):
        folder = os.path.join(DATA_DIR, d.strftime("%d-%m-%Y"))
        os.makedirs(folder, exist_ok=True)
        prices, counts = {}, {}
        for name, (base_price, base_supply, drift) in ITEMS.items():
            pmult, smult = walks[name][di]
            # Intentionally drop a few items on a few dates to test robustness.
            drop_price = (name == "AWP | Wildfire (Factory New)" and di in (3, 4))
            drop_count = (name == "Souvenir AWP | Dragon Lore (FN)" and di in (5,))
            drop_both = (name == "MP9 | Starlight Protector (FN)" and di in (0, 1))
            if drop_both:
                continue
            price = round(base_price * pmult, 2)
            supply = int(round(base_supply * smult))
            if not drop_price:
                prices[name] = price
            if not drop_count:
                counts[name] = supply

        with open(os.path.join(folder, "prices.json"), "w") as f:
            json.dump(prices, f, indent=2, ensure_ascii=False)
        with open(os.path.join(folder, "count.json"), "w") as f:
            json.dump(counts, f, indent=2, ensure_ascii=False)
        print(f"wrote {folder}  ({len(prices)} prices, {len(counts)} counts)")


if __name__ == "__main__":
    gen()
