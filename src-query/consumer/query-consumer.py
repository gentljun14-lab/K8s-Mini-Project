import json
import os
import signal
import time
from typing import Any, Dict

from kafka import KafkaConsumer
from kafka.errors import KafkaError
from database import redis_client

RUNNING = True


def _get_float(value, default=0.0):
  try:
    if value is None:
      return default
    return float(value)
  except (TypeError, ValueError):
    return default


def _coerce_str(value, default=None):
  if value is None:
    return default
  return str(value)


def _pick_vehicle_meta(vehicle_data: dict, key: str, default: str = "") -> str:
  raw = vehicle_data.get("raw")
  raw_vehicle = raw.get("vehicle") if isinstance(raw, dict) else None
  vehicle_root = vehicle_data.get("vehicle")
  candidates = (
    raw_vehicle.get(key) if isinstance(raw_vehicle, dict) else None,
    raw.get(key) if isinstance(raw, dict) else None,
    vehicle_root.get(key) if isinstance(vehicle_root, dict) else None,
    vehicle_data.get(key),
  )
  for value in candidates:
    if value is None:
      continue
    text = str(value).strip()
    if text:
      return text
  return default


def _build_snapshot(vehicle_data: dict) -> dict:
  vehicle_id = vehicle_data.get("vehicle_id", vehicle_data.get("vehicle", {}).get("vehicle_id"))
  if not vehicle_id:
    return {}

  location = vehicle_data.get("location", {}) or {}
  coords = location.get("coordinates") or {}
  latitude = _get_float(coords.get("latitude", location.get("latitude")), 0.0)
  longitude = _get_float(coords.get("longitude", location.get("longitude")), 0.0)
  city = location.get("city")
  state = (
    _coerce_str(vehicle_data.get("state"))
    or _coerce_str(vehicle_data.get("trip", {}).get("state"), "UNKNOWN")
    or "UNKNOWN"
  )
  received = (
    _coerce_str(vehicle_data.get("timestamp"), _coerce_str(vehicle_data.get("vehicle", {}).get("timestamp_utc")))
  )
  if received is None:
    received = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

  return {
    "vehicle_id": vehicle_id,
    "received_at": received,
    "state": state,
    "speed_kmh": _get_float(vehicle_data.get("speed_kmh", vehicle_data.get("trip", {}).get("speed_kmh")), 0.0),
    "soc_pct": _get_float(vehicle_data.get("soc_pct", vehicle_data.get("battery", {}).get("soc_pct")), 0.0),
    "latitude": latitude,
    "longitude": longitude,
    "city": city,
    "recent_event": vehicle_data.get("recent_event"),
    "model": _pick_vehicle_meta(vehicle_data, "model", ""),
    "driver": _pick_vehicle_meta(vehicle_data, "driver", ""),
  }


def _safe_json_loads(raw: bytes | str) -> Dict[str, Any]:
    try:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _handle_sigterm(signum, frame):
  global RUNNING
  RUNNING = False


signal.signal(signal.SIGTERM, _handle_sigterm)
signal.signal(signal.SIGINT, _handle_sigterm)


def start_consumer():
  topic = os.getenv("KAFKA_TOPIC", "car.telemetry.events")
  bootstrap = os.getenv("KAFKA_BOOTSTRAP", "kafka-svc:9092")
  group_id = os.getenv("KAFKA_GROUP_ID", "vehicle-projector")
  ttl_sec = int(os.getenv("REDIS_TTL_SEC", "60"))
  poll_timeout_ms = int(os.getenv("KAFKA_POLL_TIMEOUT_MS", "1000"))
  retry_sec = int(os.getenv("KAFKA_RETRY_SEC", "3"))
  batch_size = int(os.getenv("KAFKA_BATCH_SIZE", "200"))
  update_stream = os.getenv("VEHICLE_UPDATE_STREAM", "vehicle:updates")
  stream_maxlen = int(os.getenv("VEHICLE_UPDATE_STREAM_MAXLEN", "5000"))

  consumer = None

  while RUNNING:
    try:
      consumer = KafkaConsumer(
        topic,
        bootstrap_servers=bootstrap.split(","),
        group_id=group_id,
        enable_auto_commit=False,
        auto_offset_reset="latest",
        value_deserializer=lambda m: _safe_json_loads(m),
      )
      print(f"[INFO] Kafka Consumer started. topic={topic}, bootstrap={bootstrap}, group={group_id}")
      break
    except Exception as e:
      print(f"[ERROR] KafkaConsumer init failed: {e}. retry in {retry_sec}s.")
      time.sleep(retry_sec)

  if consumer is None:
    return

  try:
    while RUNNING:
      records = consumer.poll(timeout_ms=poll_timeout_ms, max_records=batch_size)
      updated = 0

      for _, msgs in records.items():
        for msg in msgs:
          try:
            vehicle_data = msg.value
            if not isinstance(vehicle_data, dict):
              continue

            vehicle_id = vehicle_data.get("vehicle_id") or vehicle_data.get("vehicle", {}).get("vehicle_id")
            if not vehicle_id:
              print(f"[WARN] missing vehicle_id: {vehicle_data}")
              continue

            key = f"vehicle:{vehicle_id}:latest"
            redis_client.set(key, json.dumps(vehicle_data), ex=ttl_sec)

            snapshot = _build_snapshot(vehicle_data)
            if snapshot.get("vehicle_id"):
              event_ts = int(time.time() * 1000)
              snapshot["event_ts"] = event_ts
              payload = {
                "v": json.dumps(snapshot, ensure_ascii=False),
                "vehicle_id": vehicle_id,
                "event_ts": str(event_ts),
              }
              redis_client.xadd(update_stream, payload, maxlen=stream_maxlen, approximate=True)
            updated += 1
          except Exception as e:
            print(f"[ERROR] processing failed: {e}")

      if updated > 0:
        consumer.commit()
        print(f"[INFO] Redis latest key update + offset commit: {updated} rows")

  except KafkaError as e:
    print(f"[ERROR] Kafka error: {e}")
  finally:
    if consumer is not None:
      consumer.close()
    print("[INFO] Kafka Consumer stopped")


if __name__ == "__main__":
  start_consumer()
