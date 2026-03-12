# 💾 Telemetry MongoDB Consumer

Kafka 토픽에서 차량 텔레메트리 이벤트를 소비해 **MongoDB에 영구 저장**하는 Command 서비스입니다.  
CQRS 패턴에서 **이력 저장소(Write Store)** 역할을 합니다.

## 데이터 흐름

```
Kafka (car.telemetry.events)
    │  poll (배치, 최대 500건)
    ▼
MongoDB Consumer
    │  insert_many
    ▼
MongoDB  telemetry_history 컬렉션
```

## 기술 스택

- Python 3.11
- kafka-python 2.0.2, pymongo 4.6.1

## 디렉토리 구조

```
consumer/
 ┣ consumer_mongodb.py   # 소비자 메인 로직
 ┣ requirements.txt
 ┣ Dockerfile
 └ .dockerignore
```

## 동작 방식

1. Kafka 토픽 `car.telemetry.events` 구독 (**earliest** offset — 이력 전체 저장)
2. `poll()`로 최대 `MONGO_BATCH_SIZE`건 배치 수집
3. `created_at`, `_consumed_at` 타임스탬프 주입
4. `insert_many()`로 MongoDB 일괄 저장
5. 성공 시에만 Kafka offset `commit()` (최소 1회 보장)
6. SIGTERM / SIGINT 수신 시 graceful shutdown

> **Query Consumer와의 차이:** MongoDB Consumer는 `earliest` offset으로 이력 전체를 저장하고,  
> Query Consumer(Redis)는 `latest` offset으로 최신 스냅샷만 유지합니다.

## 환경변수

| 변수 | 기본값 | 설명 |
| :--- | :--- | :--- |
| `KAFKA_BROKERS` | `kafka-svc:9092` | Kafka 브로커 주소 |
| `KAFKA_TOPIC` | `car.telemetry.events` | 구독 토픽 |
| `KAFKA_GROUP_ID` | `vehicle-mongo-saver` | 컨슈머 그룹 ID |
| `MONGO_URI` | — | 인증 포함 MongoDB URI (**Secret 주입**) |
| `MONGO_DB` | `car_db` | 저장할 DB명 |
| `MONGO_COLLECTION` | `telemetry_history` | 저장할 컬렉션명 |
| `MONGO_BATCH_SIZE` | `500` | 한 번에 처리할 최대 메시지 수 |
| `MONGO_TTL_DAYS` | `7` | TTL 인덱스 보관 기간 (일) |

> `MONGO_URI`는 인증 정보가 포함되므로 반드시 **Kubernetes Secret**(`mobility-secret`)으로 주입해야 합니다.

## TTL 인덱스

컨슈머 기동 시 `created_at` 필드에 TTL 인덱스를 자동 생성합니다.

```python
collection.create_index("created_at", expireAfterSeconds=MONGO_TTL_DAYS * 86400)
```

별도로 15분마다 실행되는 **CronJob**이 조건 기반 삭제(`deleteMany`)도 수행합니다.

## 로컬 실행

```bash
pip install -r requirements.txt
MONGO_URI="mongodb://localhost:27017" \
KAFKA_BROKERS="localhost:9092" \
python consumer_mongodb.py
```

## Docker 빌드

```bash
docker build -t telemetry-mongo-consumer:local .
docker run \
  -e KAFKA_BROKERS=kafka:9092 \
  -e MONGO_URI=mongodb://user:pass@mongo:27017 \
  telemetry-mongo-consumer:local
```

## K8s 리소스

| 리소스 | 값 |
| :--- | :--- |
| Deployment | `connected-car-command-consumer` |
| replicas | 2 |
| MONGO_URI | `mobility-secret` Secret에서 주입 |
