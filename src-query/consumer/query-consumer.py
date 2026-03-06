import json
import os
import signal
import time

from kafka import KafkaConsumer
from kafka.errors import KafkaError
from database import redis_client

RUNNING = True


def _handle_sigterm(signum, frame):
    global RUNNING
    RUNNING = False


signal.signal(signal.SIGTERM, _handle_sigterm)
signal.signal(signal.SIGINT, _handle_sigterm)


def start_consumer():
    topic = os.getenv("KAFKA_TOPIC", "car.telemetry.events")
    bootstrap = os.getenv("KAFKA_BROKERS", os.getenv("KAFKA_BOOTSTRAP", "kafka-svc:9092"))
    group_id = os.getenv("KAFKA_GROUP_ID", "vehicle-projector")
    ttl_sec = int(os.getenv("REDIS_TTL_SEC", "60"))
    poll_timeout_ms = int(os.getenv("KAFKA_POLL_TIMEOUT_MS", "1000"))
    retry_sec = int(os.getenv("KAFKA_RETRY_SEC", "3"))
    batch_size = int(os.getenv("KAFKA_BATCH_SIZE", "200"))

    consumer = None

    while RUNNING:
        try:
            consumer = KafkaConsumer(
                topic,
                bootstrap_servers=bootstrap.split(","),
                group_id=group_id,
                enable_auto_commit=False,
                auto_offset_reset="latest",
                value_deserializer=lambda m: json.loads(m.decode("utf-8")),
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
                        vehicle_id = vehicle_data.get("vehicle_id")
                        if not vehicle_id:
                            print(f"[WARN] missing vehicle_id: {vehicle_data}")
                            continue

                        key = f"vehicle:{vehicle_id}:latest"
                        redis_client.set(key, json.dumps(vehicle_data), ex=ttl_sec)
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
