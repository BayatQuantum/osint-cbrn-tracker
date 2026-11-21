#!/usr/bin/env python3
"""OCT tracker v1: USGS feed -> filter -> alert.json (schema_version 1)."""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
import yaml
from wind import safe_wind

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"
OUTPUT_PATH = ROOT / "alert.json"
SCHEMA_VERSION = 1


def load_config() -> dict:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    validate_bbox(cfg["bbox"])
    return cfg


def validate_bbox(b: dict) -> None:
    for k in ("south", "west", "north", "east"):
        if k not in b:
            sys.exit(f"config error: bbox.{k} is missing")
    if not (-90 <= b["south"] < b["north"] <= 90):
        sys.exit("config error: need -90 <= south < north <= 90")
    if not (-180 <= b["west"] <= 180 and -180 <= b["east"] <= 180):
        sys.exit("config error: west/east must be within -180..180")
    if b["west"] >= b["east"]:
        sys.exit("config error: west must be < east (antimeridian not supported yet)")


def fetch_usgs(url: str) -> list:
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    return r.json().get("features", [])


def in_bbox(lat: float, lon: float, b: dict) -> bool:
    return b["south"] <= lat <= b["north"] and b["west"] <= lon <= b["east"]


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def classify(props: dict):
    """Return (confidence, flags) from the USGS event type and review status.
    HIGH is reserved for events confirmed by a thermal anomaly (not implemented yet)."""
    t = (props.get("type") or "").lower()
    conf, flags = "LOW", []
    if "quarry" in t or "mining" in t:
        flags.append("likely_mining")
    elif "explosion" in t:
        conf = "MEDIUM"
        flags.append("labeled_explosion")
    if props.get("status") == "automatic":
        flags.append("unreviewed")
    return conf, flags


def build_event(feat: dict) -> dict:
    lon, lat, depth = feat["geometry"]["coordinates"]
    p = feat["properties"]
    conf, flags = classify(p)
    return {
        "id": feat["id"],
        "source": "USGS",
        "time": iso(p["time"]),
        "lat": lat,
        "lon": lon,
        "magnitude": p["mag"],
        "depth_km": depth,
        "event_type": p.get("type") or "unknown",
        "confidence": conf,
        "flags": flags,
        "thermal": {"checked": False, "source": None, "anomaly": None, "checked_at": None},
        "wind": None,
        "plume": None,
        "gas_analysis": {"status": "PENDING", "aerosol_anomaly": None, "gas_anomalies": []},
    }


def main() -> None:
    cfg = load_config()
    features = fetch_usgs(cfg["usgs_feed_url"])

    events = []
    for f in features:
        p = f["properties"]
        lon, lat, depth = f["geometry"]["coordinates"]
        if p.get("mag") is None or depth is None:
            continue
        if p["mag"] < cfg["min_magnitude"]:
            continue
        if depth > cfg["max_depth_km"]:
            continue
        if not in_bbox(lat, lon, cfg["bbox"]):
            continue
        ev = build_event(f)
        ev["wind"] = None if os.environ.get("OCT_SKIP_WIND") else safe_wind(lat, lon)
        if ev["wind"]:
            ev["plume"] = {"hours": [1, 3, 6], "model": "simple_cone_v1"}
        events.append(ev)

    events.sort(key=lambda e: e["time"], reverse=True)
    rank = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}
    top = max((rank[e["confidence"]] for e in events if "likely_mining" not in e["flags"]), default=0)
    status = "CONFIRMED" if top >= 3 else "WATCH" if top >= 1 else "NORMAL"
    alert = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": status,
        "config": {
            "region_name": cfg["region_name"],
            "bbox": cfg["bbox"],
            "min_magnitude": cfg["min_magnitude"],
            "max_depth_km": cfg["max_depth_km"],
        },
        "events": events,
    }
    OUTPUT_PATH.write_text(json.dumps(alert, indent=2) + "\n", encoding="utf-8")
    print(f"scanned {len(features)} quakes, {len(events)} matched -> {OUTPUT_PATH.name}")


if __name__ == "__main__":
    main()
