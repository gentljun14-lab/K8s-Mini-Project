#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import asyncio
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from fastapi import FastAPI, HTTPException, Request, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pymongo import MongoClient
from pymongo.collection import Collection

from database import redis_client

app = FastAPI(title="Connected Car Query API")

REDIS_KEY_PATTERN = os.getenv("REDIS_KEY_PATTERN", "vehicle:*:latest")
VEHICLE_UPDATE_STREAM = os.getenv("VEHICLE_UPDATE_STREAM", "vehicle:updates")
VEHICLE_UPDATE_BATCH = int(os.getenv("VEHICLE_UPDATE_BATCH", "500"))
DEFAULT_LIMIT = int(os.getenv("VEHICLE_LIST_DEFAULT_LIMIT", "500"))
MAX_LIMIT = int(os.getenv("VEHICLE_LIST_MAX_LIMIT", "5000"))
MONGO_URI = os.getenv("MONGO_URI", "").strip()
MONGO_DB = os.getenv("MONGO_DB", "car_db").strip()
MONGO_COLLECTION = os.getenv("MONGO_COLLECTION", "telemetry_history").strip()

_mongo_collection: Optional[Collection] = None


def _get_mongo_collection() -> Optional[Collection]:
    global _mongo_collection

    if _mongo_collection is not None:
        return _mongo_collection

    if not MONGO_URI:
        return None

    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=1500)
        client.admin.command("ping")
        _mongo_collection = client[MONGO_DB][MONGO_COLLECTION]
    except Exception:
        _mongo_collection = None

    return _mongo_collection


def _safe_json_loads(raw: Any) -> Optional[Dict[str, Any]]:
    if raw is None:
        return None

    if isinstance(raw, (bytes, bytearray, memoryview)):
        raw = bytes(raw).decode("utf-8", errors="replace")
    elif not isinstance(raw, str):
        raw = str(raw)

    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None

    return value if isinstance(value, dict) else None


def _safe_json_dumps(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return "{}"


def _to_number(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _coerce_str(value: Any, default: str = "") -> str:
  if value is None:
    return default
  return str(value)


def _coalesce_str(*values: Any) -> str:
  for value in values:
    if value is None:
      continue
    value = str(value).strip()
    if value:
      return value
  return ""


def _extract_vehicle_meta(payload: Dict[str, Any], key: str, default: str = "") -> str:
  raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
  raw_vehicle = raw.get("vehicle") if isinstance(raw.get("vehicle"), dict) else {}
  vehicle_root = payload.get("vehicle") if isinstance(payload.get("vehicle"), dict) else {}
  return _coalesce_str(
    raw_vehicle.get(key),
    payload.get(key),
    vehicle_root.get(key),
    raw.get(key),
    default,
  )


def _parse_epoch_ms(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)

    value_text = str(value).strip()
    if not value_text:
        return 0

    if value_text.isdigit():
        try:
            return int(value_text)
        except (TypeError, ValueError):
            pass

    try:
        dt = datetime.fromisoformat(value_text.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except Exception:
        return 0


def _extract_vehicle_id(key: str) -> Optional[str]:
    # key format expected: vehicle:{vehicle_id}:latest
    parts = key.split(":")
    if len(parts) < 3:
        return None
    return parts[1]


def _extract_latest_event_ts(vehicle: Dict[str, Any]) -> int:
    if not isinstance(vehicle, dict):
        return 0
    event_ts = _to_int(vehicle.get("event_ts"))
    if event_ts > 0:
        return event_ts
    return _parse_epoch_ms(vehicle.get("received_at"))


def _build_full_vehicle(payload: Dict[str, Any]) -> Dict[str, Any]:
    location = payload.get("location") if isinstance(payload.get("location"), dict) else {}
    raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
    raw_vehicle = raw.get("vehicle") if isinstance(raw.get("vehicle"), dict) else {}
    vehicle_root = payload.get("vehicle") if isinstance(payload.get("vehicle"), dict) else {}
    raw_trip = payload.get("trip") if isinstance(payload.get("trip"), dict) else {}
    raw_battery = payload.get("battery") if isinstance(payload.get("battery"), dict) else {}
    raw_location = raw.get("location") if isinstance(raw.get("location"), dict) else {}

    vehicle_id = _coerce_str(
        payload.get("vehicle_id")
        or raw_vehicle.get("vehicle_id")
        or vehicle_root.get("vehicle_id")
    )

    received_at = _coerce_str(
        payload.get("received_at")
        or payload.get("timestamp")
        or raw_vehicle.get("timestamp_utc")
        or vehicle_root.get("timestamp_utc")
        or payload.get("event_ts")
        or str(int(time.time() * 1000))
    )

    latitude = _to_number(location.get("latitude", payload.get("latitude")), 0.0)
    longitude = _to_number(location.get("longitude", payload.get("longitude")), 0.0)

    if latitude == 0.0 and longitude == 0.0:
        coords = raw_location.get("coordinates") if isinstance(raw_location.get("coordinates"), dict) else None
        if coords:
            latitude = _to_number(coords.get("latitude"), 0.0)
            longitude = _to_number(coords.get("longitude"), 0.0)

    city = _coerce_str(location.get("city"))
    if not city and raw_location.get("city"):
        city = _coerce_str(raw_location.get("city"))

    return {
        "vehicle_id": vehicle_id,
        "timestamp": _coerce_str(payload.get("timestamp") or raw_vehicle.get("timestamp_utc")),
        "received_at": received_at,
        "event_ts": _extract_latest_event_ts({"event_ts": payload.get("event_ts"), "received_at": received_at}),
        "state": _coerce_str(payload.get("state") or raw_trip.get("state") or "UNKNOWN"),
        "speed_kmh": _to_number(payload.get("speed_kmh", raw_trip.get("speed_kmh"))),
        "soc_pct": _to_number(payload.get("soc_pct", raw_battery.get("soc_pct"))),
        "model": _extract_vehicle_meta(payload, "model", ""),
        "driver": _extract_vehicle_meta(payload, "driver", ""),
        "location": {
            "latitude": latitude,
            "longitude": longitude,
            "city": city,
            "heading_deg": _to_number(location.get("heading_deg")),
            "altitude_m": _to_number(location.get("altitude_m")),
            "gps_accuracy_m": _to_number(location.get("gps_accuracy_m")),
        },
        "recent_event": payload.get("recent_event"),
        "raw": payload,
    }


def _build_vehicle_snapshot(payload: Dict[str, Any]) -> Dict[str, Any]:
    raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
    raw_vehicle = raw.get("vehicle") if isinstance(raw.get("vehicle"), dict) else {}

    city = payload.get("city")
    if city is None:
        city = raw.get("location", {}).get("city") if isinstance(raw, dict) else None

    location = payload.get("location") if isinstance(payload.get("location"), dict) else {}
    latitude = _to_number(location.get("latitude", payload.get("latitude")), 0.0)
    longitude = _to_number(location.get("longitude", payload.get("longitude")), 0.0)

    if latitude == 0.0 and longitude == 0.0:
        coords = raw.get("location", {}).get("coordinates") if isinstance(raw.get("location"), dict) else None
        if isinstance(coords, dict):
            latitude = _to_number(coords.get("latitude"), 0.0)
            longitude = _to_number(coords.get("longitude"), 0.0)

    received_at = _coerce_str(
        payload.get("received_at")
        or payload.get("timestamp")
        or raw_vehicle.get("timestamp_utc")
        or payload.get("vehicle", {}).get("timestamp_utc")
        or payload.get("event_ts")
        or str(int(time.time() * 1000))
    )

    return {
        "vehicle_id": _coerce_str(
            payload.get("vehicle_id")
            or raw_vehicle.get("vehicle_id")
            or payload.get("vehicle", {}).get("vehicle_id")
        ),
        "received_at": received_at,
        "event_ts": _extract_latest_event_ts(payload),
        "state": _coerce_str(payload.get("state", payload.get("trip", {}).get("state", "UNKNOWN"))),
        "speed_kmh": _to_number(payload.get("speed_kmh", payload.get("trip", {}).get("speed_kmh"))),
        "soc_pct": _to_number(payload.get("soc_pct", payload.get("battery", {}).get("soc_pct"))),
        "latitude": latitude,
        "longitude": longitude,
        "city": _coerce_str(city),
        "recent_event": payload.get("recent_event"),
        "model": _extract_vehicle_meta(payload, "model", ""),
        "driver": _extract_vehicle_meta(payload, "driver", ""),
    }


def _build_vehicle_summary(payload: Dict[str, Any]) -> Dict[str, Any]:
    raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else {}
    location = payload.get("location") if isinstance(payload.get("location"), dict) else {}
    raw_vehicle = raw.get("vehicle") if isinstance(raw.get("vehicle"), dict) else {}

    city = _coerce_str(location.get("city"), "")
    if not city and isinstance(raw, dict):
        city = _coerce_str(raw.get("location", {}).get("city"), "")

    latitude = _to_number(location.get("latitude", payload.get("latitude")), 0.0)
    longitude = _to_number(location.get("longitude", payload.get("longitude")), 0.0)
    if latitude == 0.0 and longitude == 0.0:
        coords = location.get("coordinates")
        if isinstance(coords, dict):
            latitude = _to_number(coords.get("latitude"), 0.0)
            longitude = _to_number(coords.get("longitude"), 0.0)

    return {
        "vehicle_id": _coerce_str(
            payload.get("vehicle_id")
            or raw_vehicle.get("vehicle_id")
            or payload.get("vehicle", {}).get("vehicle_id")
        ),
        "received_at": _coerce_str(
            payload.get("received_at")
            or payload.get("timestamp")
            or payload.get("event_ts")
            or raw.get("vehicle", {}).get("timestamp_utc")
            or str(int(time.time() * 1000))
        ),
        "event_ts": _extract_latest_event_ts(payload),
        "state": _coerce_str(payload.get("state", payload.get("trip", {}).get("state", "UNKNOWN"))),
        "speed_kmh": _to_number(payload.get("speed_kmh", payload.get("trip", {}).get("speed_kmh"))),
        "soc_pct": _to_number(payload.get("soc_pct", payload.get("battery", {}).get("soc_pct"))),
        "latitude": latitude,
        "longitude": longitude,
        "city": city,
        "recent_event": payload.get("recent_event"),
        "model": _extract_vehicle_meta(payload, "model", ""),
        "driver": _extract_vehicle_meta(payload, "driver", ""),
    }


@app.get("/api/vehicles/replay")
def get_vehicle_replay(
    seconds: int = Query(default=180, ge=10, le=1800),
    bucket_ms: int = Query(default=1000, alias="bucketMs", ge=250, le=10000),
    limit: int = Query(default=180, ge=10, le=600),
) -> Dict[str, Any]:
    collection = _get_mongo_collection()
    if collection is None:
        return {
            "source": "mongo",
            "count": 0,
            "frames": [],
            "detail": "MongoDB replay source is not configured",
        }

    now_ms = int(time.time() * 1000)
    since_ms = now_ms - (seconds * 1000)
    max_docs = min(max(limit * 250, 500), 50000)

    try:
        cursor = collection.find(
            {"created_at": {"$gte": datetime.fromtimestamp(since_ms / 1000, timezone.utc)}},
            projection={"_id": 0},
        ).sort("created_at", 1).limit(max_docs)
        documents = list(cursor)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"failed to load replay data from MongoDB: {exc}")

    if not documents:
        return {
            "source": "mongo",
            "count": 0,
            "frames": [],
            "detail": "No replay data found in MongoDB",
        }

    frames: List[Dict[str, Any]] = []
    current_bucket: Optional[int] = None
    current_state: Dict[str, Dict[str, Any]] = {}

    def flush_frame(bucket: Optional[int]) -> None:
        if bucket is None or not current_state:
            return

        frames.append(
            {
                "frame_ts": bucket,
                "vehicles": sorted(current_state.values(), key=lambda item: _coerce_str(item.get("vehicle_id"))),
            }
        )

    for document in documents:
        snapshot = _build_vehicle_snapshot(document if isinstance(document, dict) else {})
        vehicle_id = _coerce_str(snapshot.get("vehicle_id"))
        if not vehicle_id:
            continue

        event_ms = _extract_latest_event_ts(document if isinstance(document, dict) else {})
        if event_ms <= 0:
            event_ms = _parse_epoch_ms(document.get("created_at") if isinstance(document, dict) else None)
        if event_ms <= 0:
            continue

        bucket = max(since_ms, (event_ms // bucket_ms) * bucket_ms)

        if current_bucket is None:
            current_bucket = bucket
        elif bucket != current_bucket:
            flush_frame(current_bucket)
            current_bucket = bucket

        snapshot["event_ts"] = event_ms
        current_state[vehicle_id] = snapshot

    flush_frame(current_bucket)

    if len(frames) > limit:
        frames = frames[-limit:]

    return {
        "source": "mongo",
        "count": len(frames),
        "frames": frames,
        "since_ms": since_ms,
        "bucket_ms": bucket_ms,
    }


def _vehicle_matches_filter(
    vehicle: Dict[str, Any],
    *,
    vehicle_id: Optional[str],
    state: Optional[str],
    city: Optional[str],
    min_speed: Optional[float],
    max_speed: Optional[float],
    since_ms: Optional[int],
) -> bool:
    if vehicle_id and vehicle.get("vehicle_id") != vehicle_id:
        return False

    if state and vehicle.get("state") != state:
        return False

    vehicle_city = vehicle.get("city")
    if vehicle_city is None:
        vehicle_city = vehicle.get("location", {}).get("city")

    if city and str(vehicle_city or "").lower() != city.lower():
        return False

    if since_ms:
        latest_ts = _extract_latest_event_ts(vehicle)
        if latest_ts <= since_ms:
            return False

    if min_speed is not None and _to_number(vehicle.get("speed_kmh")) < min_speed:
        return False

    if max_speed is not None and _to_number(vehicle.get("speed_kmh")) > max_speed:
        return False

    return True


def _iter_latest_keys() -> Iterable[str]:
    return redis_client.scan_iter(match=REDIS_KEY_PATTERN)


def _latest_payloads() -> Iterable[Dict[str, Any]]:
    for key in _iter_latest_keys():
        if not isinstance(key, str):
            key = str(key)
        vehicle_id = _extract_vehicle_id(key)
        if not vehicle_id:
            continue

        raw_value = redis_client.get(key)
        if not raw_value:
            continue

        payload = _safe_json_loads(raw_value)
        if not isinstance(payload, dict):
            continue

        payload.setdefault("vehicle_id", vehicle_id)
        yield payload


def _collect_vehicles_from_latest(
    *,
    vehicle_id: Optional[str] = None,
    state: Optional[str] = None,
    city: Optional[str] = None,
    min_speed: Optional[float] = None,
    max_speed: Optional[float] = None,
    since_ms: Optional[int] = None,
    compact: bool = False,
    summary: bool = False,
) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for payload in _latest_payloads():
        if summary:
            candidate = _build_vehicle_summary(payload)
        elif compact:
            candidate = _build_vehicle_snapshot(payload)
        else:
            candidate = _build_full_vehicle(payload)
        if _vehicle_matches_filter(
            candidate,
            vehicle_id=vehicle_id,
            state=state,
            city=city,
            min_speed=min_speed,
            max_speed=max_speed,
            since_ms=since_ms,
        ):
            items.append(candidate)

    items.sort(key=lambda item: str(item.get("vehicle_id")))
    return items


def _collect_delta_since(
    since_ms: int,
    *,
    compact: bool = True,
    summary: bool = False,
) -> List[Dict[str, Any]]:
    if since_ms <= 0:
        return []

    updates: Dict[str, Tuple[int, Dict[str, Any]]] = {}

    try:
        entries = redis_client.xrevrange(VEHICLE_UPDATE_STREAM, count=VEHICLE_UPDATE_BATCH)
    except Exception:
        return []

    for _, fields in entries:
        if not isinstance(fields, dict):
            continue

        event_ts = _to_int(fields.get("event_ts"))
        if event_ts <= since_ms:
            continue

        raw_snapshot = fields.get("v")
        payload = _safe_json_loads(raw_snapshot)
        if payload is None and isinstance(raw_snapshot, dict):
            payload = dict(raw_snapshot)

        if not isinstance(payload, dict):
            continue

        payload = dict(payload)
        payload["event_ts"] = event_ts
        vehicle_id = payload.get("vehicle_id")
        if not vehicle_id:
            continue

        if summary:
            built = _build_vehicle_summary(payload)
        elif compact:
            built = _build_vehicle_snapshot(payload)
        else:
            built = _build_full_vehicle(payload)
        latest = built.get("event_ts", 0)
        if not isinstance(latest, int):
            latest = _to_int(latest)

        existing = updates.get(vehicle_id)
        if existing is None or existing[0] < latest:
            updates[vehicle_id] = (latest, built)

    return [updates[key][1] for key in sorted(updates.keys())]


def _filter_updates_by(
    updates: List[Dict[str, Any]],
    *,
    vehicle_id: Optional[str],
    state: Optional[str],
    city: Optional[str],
    min_speed: Optional[float],
    max_speed: Optional[float],
) -> List[Dict[str, Any]]:
    if not updates:
        return []

    if not (vehicle_id or state or city or min_speed is not None or max_speed is not None):
        return updates

    filtered: List[Dict[str, Any]] = []
    for item in updates:
        if vehicle_id and item.get("vehicle_id") != vehicle_id:
            continue
        if state and item.get("state") != state:
            continue
        item_city = item.get("city")
        if item_city is None:
            item_city = item.get("location", {}).get("city")
        if city and str(item_city or "").lower() != city.lower():
            continue
        if min_speed is not None and _to_number(item.get("speed_kmh")) < min_speed:
            continue
        if max_speed is not None and _to_number(item.get("speed_kmh")) > max_speed:
            continue
        filtered.append(item)

    return filtered


def _latest_stream_id() -> int:
    try:
        entries = redis_client.xrevrange(VEHICLE_UPDATE_STREAM, count=1)
    except Exception:
        return 0

    for _, fields in entries:
        if not isinstance(fields, dict):
            continue
        event_ts = _to_int(fields.get("event_ts"))
        if event_ts > 0:
            return event_ts

    return 0


def _sse_event(payload: Dict[str, Any]) -> str:
    return f"data: {_safe_json_dumps(payload)}\n\n"


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "Connected Car Query API",
        "redis_key_pattern": REDIS_KEY_PATTERN,
        "stream": VEHICLE_UPDATE_STREAM,
    }


@app.get("/api/vehicles")
def list_vehicles(
    state: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    since: int = Query(default=0, alias="since"),
    vehicle_id: Optional[str] = Query(default=None),
    min_speed: Optional[float] = Query(default=None, alias="minSpeed"),
    max_speed: Optional[float] = Query(default=None, alias="maxSpeed"),
    limit: int = Query(default=DEFAULT_LIMIT),
) -> Dict[str, Any]:
    normalized_limit = min(max(1, limit), MAX_LIMIT)
    vehicles = _collect_vehicles_from_latest(
        vehicle_id=vehicle_id,
        state=state,
        city=city,
        min_speed=min_speed,
        max_speed=max_speed,
        since_ms=since or None,
        compact=False,
    )

    return {"count": min(len(vehicles), normalized_limit), "vehicles": vehicles[:normalized_limit]}


@app.get("/api/vehicles/list")
def list_vehicles_light(
    state: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    since: int = Query(default=0, alias="since"),
    vehicle_id: Optional[str] = Query(default=None),
    min_speed: Optional[float] = Query(default=None, alias="minSpeed"),
    max_speed: Optional[float] = Query(default=None, alias="maxSpeed"),
    limit: int = Query(default=DEFAULT_LIMIT),
) -> Dict[str, Any]:
    normalized_limit = min(max(1, limit), MAX_LIMIT)
    vehicles = _collect_vehicles_from_latest(
        vehicle_id=vehicle_id,
        state=state,
        city=city,
        min_speed=min_speed,
        max_speed=max_speed,
        since_ms=since or None,
        compact=True,
        summary=True,
    )

    return {
        "type": "snapshot",
        "count": min(len(vehicles), normalized_limit),
        "vehicles": vehicles[:normalized_limit],
        "stream_last_id": _latest_stream_id(),
    }


@app.get("/api/vehicles/query")
def query_vehicles(
    state: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    since: int = Query(default=0, alias="since"),
    vehicle_id: Optional[str] = Query(default=None),
    min_speed: Optional[float] = Query(default=None, alias="minSpeed"),
    max_speed: Optional[float] = Query(default=None, alias="maxSpeed"),
    compact: bool = Query(default=True),
    summary: bool = Query(default=True),
    limit: int = Query(default=DEFAULT_LIMIT),
) -> Dict[str, Any]:
    normalized_limit = min(max(1, limit), MAX_LIMIT)

    if since and since > 0:
        updates = _filter_updates_by(
            _collect_delta_since(since, compact=compact, summary=summary),
            vehicle_id=vehicle_id,
            state=state,
            city=city,
            min_speed=min_speed,
            max_speed=max_speed,
        )

        return {
            "type": "delta",
            "count": min(len(updates), normalized_limit),
            "updates": updates[:normalized_limit],
            "stream_last_id": _latest_stream_id(),
        }

    vehicles = _collect_vehicles_from_latest(
        vehicle_id=vehicle_id,
        state=state,
        city=city,
        min_speed=min_speed,
        max_speed=max_speed,
        compact=compact,
        summary=summary,
    )

    return {
        "type": "snapshot",
        "count": min(len(vehicles), normalized_limit),
        "vehicles": vehicles[:normalized_limit],
        "stream_last_id": _latest_stream_id(),
    }


@app.get("/api/vehicles/watch")
def watch_vehicles(
    state: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    since: int = Query(default=0),
    vehicle_id: Optional[str] = Query(default=None),
    min_speed: Optional[float] = Query(default=None, alias="minSpeed"),
    max_speed: Optional[float] = Query(default=None, alias="maxSpeed"),
    compact: bool = Query(default=True),
    summary: bool = Query(default=False),
    limit: int = Query(default=DEFAULT_LIMIT),
) -> Dict[str, Any]:
    """
    Conditional query endpoint:
    - since=0 -> current snapshot by filters.
    - since>0 -> incremental updates by filters.
    """
    normalized_limit = min(max(1, limit), MAX_LIMIT)

    if since and since > 0:
        updates = _filter_updates_by(
            _collect_delta_since(since, compact=compact, summary=summary),
            vehicle_id=vehicle_id,
            state=state,
            city=city,
            min_speed=min_speed,
            max_speed=max_speed,
        )

        return {
            "type": "delta",
            "count": min(len(updates), normalized_limit),
            "updates": updates[:normalized_limit],
            "stream_last_id": _latest_stream_id(),
        }

    vehicles = _collect_vehicles_from_latest(
        vehicle_id=vehicle_id,
        state=state,
        city=city,
        min_speed=min_speed,
        max_speed=max_speed,
        compact=compact,
        summary=summary,
    )

    return {
        "type": "snapshot",
        "count": min(len(vehicles), normalized_limit),
        "vehicles": vehicles[:normalized_limit],
        "stream_last_id": _latest_stream_id(),
    }


@app.get("/api/vehicles/compact")
def list_vehicles_compact(
    state: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    since: int = Query(default=0, alias="since"),
    vehicle_id: Optional[str] = Query(default=None),
    min_speed: Optional[float] = Query(default=None, alias="minSpeed"),
    max_speed: Optional[float] = Query(default=None, alias="maxSpeed"),
    limit: int = Query(default=DEFAULT_LIMIT),
) -> Dict[str, Any]:
    normalized_limit = min(max(1, limit), MAX_LIMIT)
    vehicles = _collect_vehicles_from_latest(
        vehicle_id=vehicle_id,
        state=state,
        city=city,
        min_speed=min_speed,
        max_speed=max_speed,
        since_ms=since or None,
        compact=True,
    )

    return {"count": min(len(vehicles), normalized_limit), "vehicles": vehicles[:normalized_limit]}


@app.get("/api/vehicles/delta")
def list_vehicles_delta(
    since: int = Query(..., description="last seen event timestamp (epoch ms)"),
    vehicle_id: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    compact: bool = Query(default=True),
    summary: bool = Query(default=False),
    min_speed: Optional[float] = Query(default=None, alias="minSpeed"),
    max_speed: Optional[float] = Query(default=None, alias="maxSpeed"),
    limit: int = Query(default=DEFAULT_LIMIT),
) -> Dict[str, Any]:
    updates = _filter_updates_by(
        _collect_delta_since(since, compact=compact, summary=summary),
        vehicle_id=vehicle_id,
        state=state,
        city=city,
        min_speed=min_speed,
        max_speed=max_speed,
    )

    normalized_limit = min(max(1, limit), MAX_LIMIT)

    return {
        "count": min(len(updates), normalized_limit),
        "updates": updates[:normalized_limit],
        "stream_last_id": _latest_stream_id(),
    }


@app.get("/api/vehicles/changes")
def list_vehicle_changes(
    since: int = Query(..., description="last seen event timestamp (epoch ms)"),
    state: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    vehicle_id: Optional[str] = Query(default=None),
    min_speed: Optional[float] = Query(default=None, alias="minSpeed"),
    max_speed: Optional[float] = Query(default=None, alias="maxSpeed"),
    compact: bool = Query(default=True),
    limit: int = Query(default=DEFAULT_LIMIT),
    summary: bool = Query(default=False),
) -> Dict[str, Any]:
    normalized_limit = min(max(1, limit), MAX_LIMIT)
    updates = _filter_updates_by(
        _collect_delta_since(since, compact=compact, summary=summary),
        vehicle_id=vehicle_id,
        state=state,
        city=city,
        min_speed=min_speed,
        max_speed=max_speed,
    )
    if summary:
        updates = [_build_vehicle_summary(item) for item in updates]
    return {
        "type": "delta",
        "count": min(len(updates), normalized_limit),
        "updates": updates[:normalized_limit],
        "stream_last_id": _latest_stream_id(),
    }


@app.get("/api/vehicles/{vehicle_id}")
def get_vehicle(vehicle_id: str) -> Dict[str, Any]:
    key = f"vehicle:{vehicle_id}:latest"
    raw_value = redis_client.get(key)
    if not raw_value:
        raise HTTPException(status_code=404, detail="vehicle not found")

    payload = _safe_json_loads(raw_value)
    if payload is None:
        raise HTTPException(status_code=500, detail="invalid vehicle payload")

    return _build_full_vehicle(payload if isinstance(payload, dict) else {})


@app.get("/api/vehicles/{vehicle_id}/history")
def get_vehicle_history(
    vehicle_id: str,
    since: int = Query(default=0, alias="since"),
    limit: int = Query(default=20),
) -> Dict[str, Any]:
    max_limit = min(max(1, limit), 500)

    try:
        entries = redis_client.xrevrange(VEHICLE_UPDATE_STREAM, count=1000)
    except Exception:
        return {"vehicle_id": vehicle_id, "count": 0, "history": []}

    history: List[Dict[str, Any]] = []
    for _, fields in entries:
        if not isinstance(fields, dict):
            continue
        if fields.get("vehicle_id") != vehicle_id:
            continue

        event_ts = _to_int(fields.get("event_ts"))
        if since and event_ts <= since:
            continue

        raw_snapshot = fields.get("v")
        payload = _safe_json_loads(raw_snapshot)
        if payload is None and isinstance(raw_snapshot, dict):
            payload = raw_snapshot

        if not isinstance(payload, dict):
            continue

        snapshot = _build_vehicle_snapshot(payload if isinstance(payload, dict) else {})
        snapshot["event_ts"] = event_ts
        history.append(snapshot)

        if len(history) >= max_limit:
            break

    history.sort(key=lambda item: _to_int(item.get("event_ts")))
    return {
        "vehicle_id": vehicle_id,
        "count": len(history),
        "history": history,
    }


@app.get("/api/vehicles/stream")
async def stream_vehicles(
    request: Request,
    compact: bool = Query(default=True),
    summary: bool = Query(default=True),
    since: int = Query(default=0),
    state: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    vehicle_id: Optional[str] = Query(default=None),
    min_speed: Optional[float] = Query(default=None, alias="minSpeed"),
    max_speed: Optional[float] = Query(default=None, alias="maxSpeed"),
    heartbeat_ms: int = Query(default=1000),
    max_updates: int = Query(default=1000),
):
    async def _generator() -> asyncio.AsyncGenerator[str, None]:
        current_since = max(0, since)

        snapshot = _collect_vehicles_from_latest(
            vehicle_id=vehicle_id,
            state=state,
            city=city,
            min_speed=min_speed,
            max_speed=max_speed,
            compact=compact,
            summary=summary,
        )

        snapshot_payload: Dict[str, Any] = {
            "type": "snapshot",
            "count": len(snapshot),
            "vehicles": snapshot,
            "stream_last_id": _latest_stream_id(),
            "received_at": int(time.time() * 1000),
        }
        yield _sse_event(snapshot_payload)

        latest_in_snapshot = max(
            (_extract_latest_event_ts(item) for item in snapshot),
            default=_latest_stream_id(),
        )
        if latest_in_snapshot > current_since:
            current_since = latest_in_snapshot

        while True:
            if await request.is_disconnected():
                break

            updates = _collect_delta_since(current_since, compact=compact, summary=summary)
            filtered = _filter_updates_by(
                updates,
                vehicle_id=vehicle_id,
                state=state,
                city=city,
                min_speed=min_speed,
                max_speed=max_speed,
            )

            if filtered:
                yield _sse_event(
                    {
                        "type": "delta",
                        "count": len(filtered),
                        "updates": filtered[-max(1, max_updates):],
                        "stream_last_id": _latest_stream_id(),
                    }
                )
                current_since = max(
                    current_since,
                    max((_to_int(item.get("event_ts")) for item in filtered), default=current_since),
                )
            else:
                yield _sse_event(
                    {
                        "type": "heartbeat",
                        "stream_last_id": _latest_stream_id(),
                        "received_at": int(time.time() * 1000),
                    }
                )

            await asyncio.sleep(max(0.5, heartbeat_ms / 1000))

    return StreamingResponse(_generator(), media_type="text/event-stream")


@app.websocket("/api/vehicles/ws")
async def websocket_vehicles(
    websocket: WebSocket,
    compact: bool = True,
    summary: bool = True,
    since: int = 0,
    state: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    vehicle_id: Optional[str] = Query(default=None),
    min_speed: Optional[float] = Query(default=None, alias="minSpeed"),
    max_speed: Optional[float] = Query(default=None, alias="maxSpeed"),
):
    await websocket.accept()
    current_since = max(0, since)
    try:
        snapshot = _collect_vehicles_from_latest(
            compact=compact,
            summary=summary,
            vehicle_id=vehicle_id,
            state=state,
            city=city,
            min_speed=min_speed,
            max_speed=max_speed,
        )
        await websocket.send_text(
            _safe_json_dumps(
                {
                    "type": "snapshot",
                    "count": len(snapshot),
                    "vehicles": snapshot,
                    "stream_last_id": _latest_stream_id(),
                }
            )
        )

        latest = max((_extract_latest_event_ts(item) for item in snapshot), default=0)
        if latest > current_since:
            current_since = latest

        while True:
            updates = _filter_updates_by(
                _collect_delta_since(current_since, compact=compact, summary=summary),
                vehicle_id=vehicle_id,
                state=state,
                city=city,
                min_speed=min_speed,
                max_speed=max_speed,
            )
            if updates:
                await websocket.send_text(
                    _safe_json_dumps(
                        {
                            "type": "delta",
                            "count": len(updates),
                            "updates": updates,
                        }
                    )
                )
                current_since = max(
                    current_since,
                    max((_to_int(item.get("event_ts")) for item in updates), default=current_since),
                )

            await asyncio.sleep(1)
    except WebSocketDisconnect:
        return


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("QUERY_API_HOST", "0.0.0.0")
    port = int(os.getenv("QUERY_API_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
