"""Wind lookup via Open-Meteo (free, no API key, non-commercial use, CC BY 4.0)."""

from datetime import datetime, timezone

import requests

API = "https://api.open-meteo.com/v1/forecast"


def fetch_wind(lat: float, lon: float) -> dict:
    r = requests.get(
        API,
        params={
            "latitude": lat,
            "longitude": lon,
            "current": "wind_speed_10m,wind_direction_10m,precipitation",
            "wind_speed_unit": "kmh",
            "timezone": "UTC",
        },
        timeout=8,
    )
    r.raise_for_status()
    c = r.json()["current"]
    from_deg = float(c["wind_direction_10m"]) % 360
    return {
        "speed_kmh": round(float(c["wind_speed_10m"]), 1),
        "from_deg": round(from_deg),
        "toward_deg": round((from_deg + 180) % 360),
        "precip": float(c.get("precipitation") or 0) > 0,
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


_fails = 0


def safe_wind(lat: float, lon: float):
    """Return wind dict, or None on failure. After 2 failures in a row, skip the rest."""
    global _fails
    if _fails >= 2:
        return None
    try:
        w = fetch_wind(lat, lon)
        _fails = 0
        return w
    except Exception as e:
        _fails += 1
        print(f"wind lookup failed for {lat},{lon}: {type(e).__name__}")
        return None
