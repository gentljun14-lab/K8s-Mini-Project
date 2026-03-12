# ⚡ Mobility Query Consumer

Kafka 토픽에서 차량 텔레메트리 이벤트를 소비해 **Redis에 최신 상태를 캐싱**하는 Query 서비스입니다.  
CQRS 패턴에서 **Read Model 동기화(Projection)** 역할을 합니다.

## 데이터 흐름

```
Kafka (car.telemetry.events)
    │  poll (latest offset, 배치 최대 200건)
    ▼
Query Consumer
    │  SET vehicle:{id}:latest  (TTL 60s)
    ▼
Redis
    │  GET vehicle:*:latest
    ▼
Query API → Frontend
```

## 기술 스택

- Python 3.12
- kafka-python 2.3.0, redis-py 7.2.0

## 디렉토리 구조

```
consumer/
 ┣ query-consumer.py   # 소비자 메인 로직
 ┣ database.py         # Redis 클라이언트 모듈
 ┣ requirements.txt
 ┣ Dockerfile
 └ .dockerignore
```

## 동작 방식

1. Kafka 토픽 `car.telemetry.events` 구독 (**latest** offset — 최신 상태만 유지)
2. `poll()`로 최대 `KAFKA_BATCH_SIZE`건 배치 수집
3. `vehicle_id` 기준으로 `vehicle:{id}:latest` 키에 JSON 저장 (TTL 적용)
4. 성공한 메시지만 Kafka offset `commit()`
5. Kafka 연결 실패 시 `KAFKA_RETRY_SEC` 후 재시도 (무한 루프)
6. SIGTERM / SIGINT 수신 시 graceful shutdown

> **MongoDB Consumer와의 차이:** MongoDB Consumer는 `earliest` offset으로 이력 전체를 저장하고,  
> Query Consumer는 `latest` offset으로 최신 스냅샷만 유지합니다.

## 환경변수

| 변수 | 기본값 | 설명 |
| :--- | :--- | :--- |
| `KAFKA_BROKERS` | `kafka-svc:9092` | Kafka 브로커 주소 |
| `KAFKA_TOPIC` | `car.telemetry.events` | 구독 토픽 |
| `KAFKA_GROUP_ID` | `vehicle-projector` | 컨슈머 그룹 ID |
| `KAFKA_POLL_TIMEOUT_MS` | `1000` | poll 대기 시간 (ms) |
| `KAFKA_RETRY_SEC` | `3` | 연결 실패 시 재시도 간격 (초) |
| `KAFKA_BATCH_SIZE` | `200` | 한 번에 처리할 최대 메시지 수 |
| `REDIS_HOST` | `localhost` | Redis 호스트 |
| `REDIS_PORT` | `6379` | Redis 포트 |
| `REDIS_PASSWORD` | — | Redis 비밀번호 (**Secret 주입**) |
| `REDIS_TTL_SEC` | `60` | 캐시 키 TTL (초) |

> `REDIS_PASSWORD`는 반드시 **Kubernetes Secret**(`mobility-secret`)으로 주입해야 합니다.

## 로컬 실행

```bash
pip install -r requirements.txt
KAFKA_BROKERS=localhost:9092 \
REDIS_HOST=localhost \
REDIS_PASSWORD=yourpassword \
python query-consumer.py
```

## Docker 빌드

```bash
docker build -t mobility-query-consumer:local .
docker run \
  -e KAFKA_BROKERS=kafka:9092 \
  -e REDIS_HOST=redis \
  -e REDIS_PASSWORD=yourpassword \
  mobility-query-consumer:local
```

## K8s 리소스

| 리소스 | 값 |
| :--- | :--- |
| Deployment | `connected-car-query-consumer` |
| replicas | 2 |
| REDIS_PASSWORD | `mobility-secret` Secret에서 주입 |
