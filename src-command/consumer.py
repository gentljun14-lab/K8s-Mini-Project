import os
import signal
from datetime import datetime
from typing import Any, Dict

from kafka import KafkaConsumer
from pymongo import MongoClient, errors as mongo_errors


def _get_env(name: str, default: str) -> str:
    return os.getenv(name, default).strip()


def _as_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


MONGO_URI = _get_env("MONGO_URI", _get_env("MONGO_URL", "mongodb://mongo:27017/"))
MONGO_DB = _get_env("MONGO_DB", "car_db")
MONGO_COLLECTION = _get_env("MONGO_COLLECTION", "telemetry_history")
MONGO_LATEST_COLLECTION = _get_env("MONGO_LATEST_COLLECTION", "telemetry_latest")

KAFKA_BROKERS = _get_env("KAFKA_BROKERS", "localhost:9092")
KAFKA_TOPIC = _get_env("KAFKA_TOPIC", "car.telemetry.events")
KAFKA_GROUP_ID = _get_env("KAFKA_GROUP_ID", "telemetry-writer")
KAFKA_AUTO_OFFSET_RESET = _get_env("KAFKA_AUTO_OFFSET_RESET", "latest")
KAFKA_ENABLE_AUTO_COMMIT = _get_env("KAFKA_ENABLE_AUTO_COMMIT", "false").lower() in {"1", "true", "yes"}
KAFKA_MAX_POLL_RECORDS = _as_int("KAFKA_MAX_POLL_RECORDS", 200)
KAFKA_CLIENT_ID = _get_env("KAFKA_CLIENT_ID", "telemetry-consumer")


running = True


def _build_consumer() -> KafkaConsumer:
    return KafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=[s.strip() for s in KAFKA_BROKERS.split(",") if s.strip()],
        group_id=KAFKA_GROUP_ID,
        value_deserializer=lambda v: v.decode("utf-8"),
        auto_offset_reset=KAFKA_AUTO_OFFSET_RESET,
        enable_auto_commit=KAFKA_ENABLE_AUTO_COMMIT,
        max_poll_records=KAFKA_MAX_POLL_RECORDS,
        client_id=KAFKA_CLIENT_ID,
    )


def _mongo_connect():
    client = MongoClient(MONGO_URI)
    db = client[MONGO_DB]
    return client, db[MONGO_COLLECTION], db[MONGO_LATEST_COLLECTION]


def _upsert_latest(collection, payload: Dict[str, Any], vehicle_id: str):
    collection.update_one(
        {"vehicle_id": vehicle_id},
        {
            "$set": {
                **payload.get("raw", payload),
                "updated_at": datetime.utcnow(),
            }
        },
        upsert=True,
    )


def _handle_message(raw_value: str, history_col, latest_col):
    payload = __import__("json").loads(raw_value)
    history_col.insert_one(payload)

    vehicle_id = payload.get("vehicle_id")
    if not vehicle_id:
        vehicle = payload.get("raw", {}).get("vehicle", {})
        vehicle_id = vehicle.get("vehicle_id")
    if vehicle_id:
        _upsert_latest(latest_col, payload, vehicle_id)


def _shutdown(signum, frame):
    global running
    running = False
    print(f"Shutdown signal received: {signum}")


def main():
    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    mongo_client = None
    consumer = None
    try:
        mongo_client, history_col, latest_col = _mongo_connect()
        history_col.create_index("vehicle.vehicle_id", unique=False)
        latest_col.create_index("vehicle_id", unique=True)

        consumer = _build_consumer()
        print(f"[consumer] started topic={KAFKA_TOPIC}, group={KAFKA_GROUP_ID}, brokers={KAFKA_BROKERS}")

        while running:
            for msg in consumer:
                try:
                    _handle_message(msg.value, history_col, latest_col)
                    if not KAFKA_ENABLE_AUTO_COMMIT:
                        consumer.commit()
                except Exception as exc:
                    print(f"[consumer] failed processing msg: {exc}")
    except mongo_errors.PyMongoError as exc:
        print(f"[consumer] MongoDB error: {exc}")
    except Exception as exc:
        print(f"[consumer] fatal error: {exc}")
    finally:
        if consumer is not None:
            consumer.close()
        if mongo_client is not None:
            mongo_client.close()
        print("[consumer] stopped")


if __name__ == "__main__":
    main()
