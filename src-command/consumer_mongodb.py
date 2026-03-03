import json
import os
import signal
from kafka import KafkaConsumer
from kafka.errors import KafkaError
from pymongo import MongoClient
from pymongo.errors import BulkWriteError
from datetime import datetime, timezone

RUNNING = True

def _handle_sigterm(signum, frame):
    global RUNNING
    print("\n[INFO] 종료 시그널 수신. 안전하게 종료를 준비합니다...")
    RUNNING = False

signal.signal(signal.SIGTERM, _handle_sigterm)
signal.signal(signal.SIGINT, _handle_sigterm)

def start_consumer():
    # --- Kafka 설정 ---
    topic = os.getenv("KAFKA_TOPIC", "vehicle-events")
    bootstrap = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")  # K8s Service DNS 권장
    group_id = os.getenv("KAFKA_GROUP_ID", "vehicle-mongo-saver") # Redis 워커와 그룹 ID가 달라야 합니다!
    
    # --- MongoDB 설정 ---
    mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
    mongo_db_name = os.getenv("MONGO_DB", "connected_car")
    mongo_col_name = os.getenv("MONGO_COLLECTION", "telemetry_history")

    # MongoDB 클라이언트 초기화
    mongo_client = MongoClient(mongo_uri)
    db = mongo_client[mongo_db_name]
    collection = db[mongo_col_name]

    # Kafka Consumer 초기화
    consumer = KafkaConsumer(
        topic,
        bootstrap_servers=bootstrap.split(","),
        group_id=group_id,
        enable_auto_commit=True,          # 데이터를 읽으면 자동으로 읽었다고 처리
        auto_offset_reset="earliest",     # DB 저장이 목적이므로, 처음 띄울 때 놓친 데이터가 있다면 과거부터 다 가져옵니다 ("latest" 대신 "earliest" 권장)
        value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    )

    print(f"🚀 Kafka -> MongoDB Consumer 시작...")
    print(f"Topic: {topic} | DB: {mongo_db_name}.{mongo_col_name} | Group: {group_id}")

    try:
        while RUNNING:
            # timeout_ms 동안 기다리며 최대 max_records 만큼의 데이터를 한 번에 쓸어 담습니다.
            records = consumer.poll(timeout_ms=1000, max_records=500)
            
            if not records:
                continue

            # DB에 한 번에 꽂아넣을 문서(Document)들을 모아둘 리스트
            batch_documents = []

            for partition, msgs in records.items():
                for msg in msgs:
                    try:
                        vehicle_data = msg.value
                        
                        # [선택사항] 데이터가 DB에 적재된 실제 시간을 추가해두면 나중에 디버깅하기 좋습니다.
                        vehicle_data["_consumed_at"] = datetime.now(timezone.utc).isoformat()

                        vehicle_id = vehicle_data.get("vehicle", {}).get("vehicle_id") or vehicle_data.get("vehicle_id")
                        if not vehicle_id:
                            print(f"[WARN] missing vehicle_id: {vehicle_data}")
                            continue

                        # 리스트에 차곡차곡 담습니다.
                        batch_documents.append(vehicle_data)

                    except Exception as e:
                        print(f"[ERROR] 데이터 파싱 실패: {e}")

            # 모아둔 데이터가 있다면 MongoDB에 한 번에 Bulk Insert 합니다.
            if batch_documents:
                try:
                    collection.insert_many(batch_documents)
                    print(f"✅ MongoDB 저장 완료: {len(batch_documents)}건 적재")
                except BulkWriteError as bwe:
                    print(f"❌ [ERROR] MongoDB Bulk Write 에러: {bwe.details}")
                except Exception as e:
                    print(f"❌ [ERROR] MongoDB 저장 실패: {e}")

    except KafkaError as e:
        print(f"💥 [ERROR] Kafka 통신 에러: {e}")
    finally:
        consumer.close()
        mongo_client.close()
        print("🛑 Kafka Consumer & MongoDB 클라이언트 안전하게 종료됨")

if __name__ == "__main__":
    start_consumer()
