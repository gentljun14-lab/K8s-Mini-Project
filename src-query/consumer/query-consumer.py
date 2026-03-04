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
    bootstrap = os.getenv("KAFKA_BROKERS", os.getenv("KAFKA_BOOTSTRAP", "kafka:9092"))
    group_id = os.getenv("KAFKA_GROUP_ID", "vehicle-projector")
    ttl_sec = int(os.getenv("REDIS_TTL_SEC", "60"))
    poll_timeout_ms = int(os.getenv("KAFKA_POLL_TIMEOUT_MS", "1000"))
    retry_sec = int(os.getenv("KAFKA_RETRY_SEC", "3"))

    consumer = None
    while RUNNING:
        try:
            consumer = KafkaConsumer(
                topic,
                bootstrap_servers=bootstrap.split(","),
                group_id=group_id,
                enable_auto_commit=True,
                auto_offset_reset="latest",
                value_deserializer=lambda m: json.loads(m.decode("utf-8")),
            )
            print(f"Kafka Consumer 시작... topic={topic}, bootstrap={bootstrap}, group={group_id}")
            break
        except Exception as e:
            print(f"[ERROR] KafkaConsumer 생성 실패: {e}. {retry_sec}초 후 재시도")
            time.sleep(retry_sec)

    if consumer is None:
        return

    try:
        while RUNNING:
            records = consumer.poll(timeout_ms=poll_timeout_ms, max_records=100)
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
                    except Exception as e:
                        print(f"[ERROR] processing failed: {e}")

    except KafkaError as e:
        print(f"[ERROR] Kafka error: {e}")
    finally:
        consumer.close()
        print("Kafka Consumer 종료")


if __name__ == "__main__":
    start_consumer()
