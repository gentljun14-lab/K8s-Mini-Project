import json
import os
import signal
from datetime import datetime, timezone

from kafka import KafkaConsumer
from kafka.errors import KafkaError
from pymongo import MongoClient
from pymongo.errors import BulkWriteError

# 컨슈머 실행 상태를 제어하는 전역 변수
RUNNING = True

def _handle_sigterm(signum, frame):
    global RUNNING
    print("\n[INFO] 종료 시그널 수신. 안전하게 종료를 준비합니다...")
    RUNNING = False

# 컨테이너 종료(SIGTERM)나 Ctrl+C(SIGINT) 입력 시 안전하게 루프를 빠져나가도록 설정
signal.signal(signal.SIGTERM, _handle_sigterm)
signal.signal(signal.SIGINT, _handle_sigterm)

def start_consumer():
    # ---------------------------------------------------------
    # 1. 환경 설정 (팀원분의 FastAPI 설정과 맞춤)
    # ---------------------------------------------------------
    # 토픽 이름을 팀원분 코드의 기본값("car.telemetry.events")과 통일했습니다.
    topic = os.getenv("KAFKA_TOPIC", "car.telemetry.events")
    bootstrap = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
    
    # Redis 컨슈머와 겹치지 않도록 완전히 독립적인 그룹 ID 사용!
    group_id = os.getenv("KAFKA_GROUP_ID", "vehicle-mongo-saver") 
    
    # MongoDB 설정
    mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
    mongo_db_name = os.getenv("MONGO_DB", "connected_car")
    mongo_col_name = os.getenv("MONGO_COLLECTION", "telemetry_history")

    # ---------------------------------------------------------
    # 2. 클라이언트 초기화
    # ---------------------------------------------------------
    try:
        mongo_client = MongoClient(mongo_uri)
        db = mongo_client[mongo_db_name]
        collection = db[mongo_col_name]
        # 연결 테스트 (실패 시 예외 발생)
        mongo_client.admin.command('ping')
        print(f"✅ MongoDB 연결 성공: {mongo_db_name}.{mongo_col_name}")
    except Exception as e:
        print(f"❌ [ERROR] MongoDB 연결 실패: {e}")
        return

    try:
        consumer = KafkaConsumer(
            topic,
            bootstrap_servers=bootstrap.split(","),
            group_id=group_id,
            enable_auto_commit=True,          
            # DB는 데이터의 영구 저장이 목적이므로, 과거에 놓친 데이터부터 전부 가져옵니다.
            auto_offset_reset="earliest",     
            value_deserializer=lambda m: json.loads(m.decode("utf-8")),
        )
        print(f"🚀 Kafka -> MongoDB Consumer 시작 (Topic: {topic}, Group: {group_id})")
    except Exception as e:
        print(f"❌ [ERROR] Kafka 연결 실패: {e}")
        return

    # ---------------------------------------------------------
    # 3. 메인 소비(Consume) 및 적재 루프
    # ---------------------------------------------------------
    try:
        while RUNNING:
            # 1초 동안 대기하며, 최대 500개의 메시지를 한 번에 긁어옵니다.
            records = consumer.poll(timeout_ms=1000, max_records=500)
            
            if not records:
                continue

            batch_documents = []

            for partition, msgs in records.items():
                for msg in msgs:
                    try:
                        vehicle_data = msg.value
                        
                        # 컨슈머가 이 데이터를 처리한 실제 시간을 도장 찍어줍니다 (디버깅/추적용)
                        vehicle_data["_consumed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")

                        # 팀원분이 최상단으로 빼둔 vehicle_id를 바로 읽습니다.
                        vehicle_id = vehicle_data.get("vehicle_id")
                        
                        if not vehicle_id:
                            print(f"⚠️ [WARN] vehicle_id가 없는 비정상 데이터 무시: {vehicle_data}")
                            continue

                        # 정상 데이터를 몽고DB 적재용 리스트에 담습니다.
                        batch_documents.append(vehicle_data)

                    except Exception as e:
                        print(f"❌ [ERROR] 데이터 파싱 실패: {e}")

            # ---------------------------------------------------------
            # 4. MongoDB 일괄 저장 (Bulk Insert)
            # ---------------------------------------------------------
            if batch_documents:
                try:
                    # 500개의 데이터를 한 번의 네트워크 요청으로 몽고DB에 밀어 넣습니다.
                    collection.insert_many(batch_documents)
                    print(f"💾 MongoDB 저장 완료: {len(batch_documents)}건 적재 (최근 차량: {batch_documents[-1].get('vehicle_id')})")
                except BulkWriteError as bwe:
                    print(f"❌ [ERROR] MongoDB Bulk Write 에러 발생: {bwe.details}")
                except Exception as e:
                    print(f"❌ [ERROR] MongoDB 저장 실패: {e}")

    except KafkaError as e:
        print(f"💥 [ERROR] Kafka 통신 에러: {e}")
    finally:
        # 종료 시그널을 받으면 클라이언트 연결을 안전하게 해제합니다.
        consumer.close()
        mongo_client.close()
        print("🛑 Kafka Consumer & MongoDB 클라이언트 안전하게 종료됨")

if __name__ == "__main__":
    start_consumer()
