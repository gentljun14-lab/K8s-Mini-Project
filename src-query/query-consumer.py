import json
import os
import signal
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

    consumer = KafkaConsumer(
        topic,
        bootstrap_servers=bootstrap.split(","),
        group_id=group_id,
        enable_auto_commit=True,          # 자동 커밋 사용; 수동 커밋이 필요하면 False로 바꾼 뒤 주기적으로 commit() 호출
        auto_offset_reset="latest",       # 최신 오프셋부터 읽기(예전 메시지를 다시 읽지 않음)
        value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    )

    print(f"Kafka Consumer 시작... topic={topic}, bootstrap={bootstrap}, group={group_id}")

    try:
        while RUNNING:
            records = consumer.poll(timeout_ms=1000, max_records=100)
            for _, msgs in records.items():
                for msg in msgs:
                    try:
                        vehicle_data = msg.value
                        vehicle_id = vehicle_data.get("vehicle_id")
                        if not vehicle_id:
                            # vehicle_id가 없으면 건너뜁니다.
                            print(f"[WARN] missing vehicle_id: {vehicle_data}")
                            continue

                        key = f"vehicle:{vehicle_id}:latest"
                        redis_client.set(key, json.dumps(vehicle_data), ex=ttl_sec)
                        # Redis의 최근 데이터 조회 속도 개선이 필요하면 zset에 추가하는 방법도 고려
                        # redis_client.zadd("vehicles:recent", {vehicle_id: int(time.time())})

                    except Exception as e:
                        print(f"[ERROR] processing failed: {e}")

    except KafkaError as e:
        print(f"[ERROR] Kafka error: {e}")
    finally:
        consumer.close()
        print("Kafka Consumer 종료")

if __name__ == "__main__":
    start_consumer()


