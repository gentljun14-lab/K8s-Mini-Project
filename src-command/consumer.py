import json
import logging
import os
import signal
import time
from datetime import datetime
from typing import Any, Dict, Mapping, Optional, Tuple

from kafka import KafkaConsumer
from kafka.errors import KafkaError
from pymongo import MongoClient, errors as mongo_errors


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("telemetry-consumer")


def _get_env(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


def _as_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _as_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name, str(default)).strip().lower()
    return value in {"1", "true", "yes", "on", "y"}


MONGO_URI = _get_env("MONGO_URI", _get_env("MONGO_URL", "mongodb://mongo:27017/"))
MONGO_DB = _get_env("MONGO_DB", "car_db")
MONGO_COLLECTION = _get_env("MONGO_COLLECTION", "telemetry_history")
MONGO_LATEST_COLLECTION = _get_env("MONGO_LATEST_COLLECTION", "telemetry_latest")
MONGO_DLQ_COLLECTION = _get_env("MONGO_DLQ_COLLECTION", "telemetry_dlq")

KAFKA_BROKERS = _get_env("KAFKA_BROKERS", "localhost:9092")
KAFKA_TOPIC = _get_env("KAFKA_TOPIC", "car.telemetry.events")
KAFKA_GROUP_ID = _get_env("KAFKA_GROUP_ID", "telemetry-writer")
KAFKA_AUTO_OFFSET_RESET = _get_env("KAFKA_AUTO_OFFSET_RESET", "latest")
KAFKA_ENABLE_AUTO_COMMIT = _as_bool("KAFKA_ENABLE_AUTO_COMMIT", False)
KAFKA_MAX_POLL_RECORDS = _as_int("KAFKA_MAX_POLL_RECORDS", 200)
KAFKA_CLIENT_ID = _get_env("KAFKA_CLIENT_ID", "telemetry-consumer")
KAFKA_POLL_TIMEOUT_MS = _as_int("KAFKA_POLL_TIMEOUT_MS", 1000)
KAFKA_COMMIT_BATCH_SEC = _as_int("KAFKA_COMMIT_BATCH_SEC", 5)
KAFKA_SHUTDOWN_TIMEOUT_SEC = _as_int("KAFKA_SHUTDOWN_TIMEOUT_SEC", 10)

MONGO_HISTORY_INDEX_FIELD = _get_env("MONGO_HISTORY_INDEX_FIELD", "vehicle.vehicle_id")
MONGO_HISTORY_TTL_DAYS = _as_int("MONGO_HISTORY_TTL_DAYS", 0)
MONGO_HISTORY_TTL_SECONDS = (
    MONGO_HISTORY_TTL_DAYS * 24 * 3600 if MONGO_HISTORY_TTL_DAYS > 0 else None
)

running = True


def _build_consumer() -> KafkaConsumer:
    return KafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=[s.strip() for s in KAFKA_BROKERS.split(",") if s.strip()],
        group_id=KAFKA_GROUP_ID,
        value_deserializer=lambda raw: json.loads(raw.decode("utf-8")),
        auto_offset_reset=KAFKA_AUTO_OFFSET_RESET,
        enable_auto_commit=KAFKA_ENABLE_AUTO_COMMIT,
        max_poll_records=KAFKA_MAX_POLL_RECORDS,
        client_id=KAFKA_CLIENT_ID,
        consumer_timeout_ms=KAFKA_POLL_TIMEOUT_MS + 100,
    )


def _mongo_connect() -> Tuple[MongoClient, Any, Any, Any]:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    db = client[MONGO_DB]
    history_col = db[MONGO_COLLECTION]
    latest_col = db[MONGO_LATEST_COLLECTION]
    dlq_col = db[MONGO_DLQ_COLLECTION]
    _ensure_indexes(history_col, latest_col, dlq_col)
    return client, history_col, latest_col, dlq_col


def _ensure_indexes(history_col, latest_col, dlq_col) -> None:
    # create once at startup; safe for repeated startup in normal environments
    history_col.create_index(MONGO_HISTORY_INDEX_FIELD, unique=False)
    if MONGO_HISTORY_TTL_SECONDS:
        history_col.create_index("received_at", expireAfterSeconds=MONGO_HISTORY_TTL_SECONDS)
    latest_col.create_index("vehicle_id", unique=True)
    dlq_col.create_index("failed_at", unique=False)


def _safe_get_vehicle_id(payload: Mapping[str, Any]) -> Optional[str]:
    vehicle_id = payload.get("vehicle_id")
    if not vehicle_id and isinstance(payload.get("vehicle"), Mapping):
        vehicle_id = payload["vehicle"].get("vehicle_id")
    return str(vehicle_id) if vehicle_id else None


def _build_metadata(msg) -> Dict[str, Any]:
    return {
        "topic": msg.topic,
        "partition": msg.partition,
        "offset": msg.offset,
        "key": msg.key.decode("utf-8") if isinstance(msg.key, (bytes, bytearray)) else msg.key,
    }


def _handle_message(payload: Mapping[str, Any], meta: Mapping[str, Any], history_col, latest_col) -> None:
    payload_dict = dict(payload)
    now = datetime.utcnow()
    if "received_at" not in payload_dict:
        payload_dict["received_at"] = now.isoformat()

    history_doc = {
        "received_at": now,
        "topic": meta["topic"],
        "partition": meta["partition"],
        "offset": meta["offset"],
        "key": meta["key"],
        "payload": payload_dict,
    }
    history_col.insert_one(history_doc)

    vehicle_id = _safe_get_vehicle_id(payload_dict)
    if not vehicle_id:
        raise ValueError("vehicle_id missing in payload")

    latest_col.update_one(
        {"vehicle_id": vehicle_id},
        {
            "$set": {
                "vehicle_id": vehicle_id,
                "updated_at": now,
                "state": {
                    "vehicle_id": vehicle_id,
                    "state": payload_dict.get("state"),
                    "speed_kmh": payload_dict.get("speed_kmh"),
                    "soc_pct": payload_dict.get("soc_pct"),
                    "location": payload_dict.get("location"),
                    "recent_event": payload_dict.get("recent_event"),
                },
                "payload": payload_dict,
                "raw": payload_dict.get("raw", payload_dict),
            }
        },
        upsert=True,
    )


def _handle_dlq(exc: Exception, payload: Any, meta: Mapping[str, Any], dlq_col) -> None:
    dlq_col.insert_one(
        {
            "failed_at": datetime.utcnow(),
            "error": repr(exc),
            "topic": meta.get("topic"),
            "partition": meta.get("partition"),
            "offset": meta.get("offset"),
            "key": meta.get("key"),
            "payload": payload,
        }
    )
    logger.warning(
        "message moved to dlq topic=%s partition=%s offset=%s error=%s",
        meta.get("topic"), meta.get("partition"), meta.get("offset"), exc
    )


def _shutdown(signum, frame):
    global running
    running = False
    logger.info("Shutdown signal received: %s", signum)


def main() -> None:
    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    mongo_client = None
    consumer = None
    processed_since_commit = 0
    last_commit_at = time.time()

    try:
        mongo_client, history_col, latest_col, dlq_col = _mongo_connect()
        consumer = _build_consumer()
        logger.info(
            "[consumer] started topic=%s group=%s brokers=%s auto_commit=%s",
            KAFKA_TOPIC,
            KAFKA_GROUP_ID,
            KAFKA_BROKERS,
            KAFKA_ENABLE_AUTO_COMMIT,
        )

        while running:
            try:
                record_map = consumer.poll(timeout_ms=KAFKA_POLL_TIMEOUT_MS, max_records=KAFKA_MAX_POLL_RECORDS)
            except KafkaError as exc:
                logger.exception("[consumer] poll failed: %s", exc)
                time.sleep(1.0)
                continue

            if not record_map:
                continue

            for _, msgs in record_map.items():
                for msg in msgs:
                    metadata = _build_metadata(msg)
                    try:
                        payload = msg.value
                        if not isinstance(payload, Mapping):
                            raise ValueError("message value is not a JSON object")

                        _handle_message(payload, metadata, history_col, latest_col)
                    except Exception as exc:
                        logger.exception(
                            "[consumer] failed message processing topic=%s partition=%s offset=%s",
                            metadata.get("topic"), metadata.get("partition"), metadata.get("offset")
                        )
                        _handle_dlq(exc, msg.value, metadata, dlq_col)
                    finally:
                        processed_since_commit += 1

            if not KAFKA_ENABLE_AUTO_COMMIT:
                now = time.time()
                if processed_since_commit >= KAFKA_MAX_POLL_RECORDS or (
                    now - last_commit_at
                ) >= KAFKA_COMMIT_BATCH_SEC:
                    try:
                        consumer.commit()
                        processed_since_commit = 0
                        last_commit_at = now
                    except KafkaError as exc:
                        logger.exception("[consumer] commit failed: %s", exc)

    except mongo_errors.PyMongoError as exc:
        logger.exception("[consumer] MongoDB error: %s", exc)
    except Exception as exc:
        logger.exception("[consumer] fatal error: %s", exc)
    finally:
        # best effort final commit before stop
        if consumer is not None and not KAFKA_ENABLE_AUTO_COMMIT:
            try:
                consumer.commit()
            except Exception:
                logger.exception("[consumer] final commit failed")
        if consumer is not None:
            consumer.close()
        if mongo_client is not None:
            mongo_client.close()
        logger.info("[consumer] stopped")


if __name__ == "__main__":
    main()
