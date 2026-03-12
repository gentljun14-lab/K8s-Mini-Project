# 📥 Telemetry Ingest API

차량 텔레메트리 데이터를 수신해 Kafka로 발행하는 **Command 서비스**입니다.  
CQRS 패턴에서 **Write(Command) 경로**를 담당합니다.

## 데이터 흐름

```
외부 클라이언트 (Dummy Server / 실제 차량)
    │  POST /api/query/telemetry
    ▼
Ingest API  ──Kafka Produce──▶  car.telemetry.events
```

## 기술 스택

- Python 3.11, FastAPI 0.133
- kafka-python 2.3.0, Pydantic v2

## 디렉토리 구조

```
ingest/
 ┣ ingest_server.py   # FastAPI 앱 진입점
 ┣ requirements.txt
 ┣ Dockerfile
 └ .dockerignore
```

## API 엔드포인트

| Method | Path | 설명 |
| :--- | :--- | :--- |
| `POST` | `/api/query/telemetry` | 차량 텔레메트리 수신 및 Kafka 발행 |
| `GET` | `/health` | 헬스체크 (Kafka 연결 상태 포함) |

### POST /api/query/telemetry 요청 예시

```json
{
  "vehicle": {
    "vehicle_id": "CAR-1001",
    "vin": "KICF9AA1001000001",
    "model": "Hyundai IONIQ 5",
    "timestamp_utc": "2026-02-24T07:01:08Z"
  },
  "location": {
    "coordinates": { "latitude": 37.4979, "longitude": 127.0276 },
    "heading_deg": 82.0
  },
  "trip": {
    "state": "DRIVE",
    "speed_kmh": 40.1
  }
}
```

### Kafka 발행 메시지 구조

```json
{
  "vehicle_id": "CAR-1001",
  "timestamp": "2026-02-24T07:01:08Z",
  "received_at": "2026-02-24T07:01:09Z",
  "state": "DRIVE",
  "speed_kmh": 40.1,
  "soc_pct": 92.44,
  "location": { "latitude": 37.4979, "longitude": 127.0276 },
  "recent_event": "교차로 대기 중",
  "raw": { /* 원본 전체 페이로드 */ }
}
```

## 환경변수

| 변수 | 기본값 | 설명 |
| :--- | :--- | :--- |
| `KAFKA_BROKERS` | `localhost:9092` | Kafka 브로커 주소 (콤마 구분) |
| `KAFKA_TOPIC` | `car.telemetry.events` | 발행할 토픽명 |
| `KAFKA_CLIENT_ID` | `command-api-producer` | Kafka 프로듀서 클라이언트 ID |
| `KAFKA_ENABLED` | `true` | Kafka 발행 활성화 여부 |

## 로컬 실행

```bash
pip install -r requirements.txt
KAFKA_BROKERS=localhost:9092 uvicorn ingest_server:app --host 0.0.0.0 --port 8000
```

## Docker 빌드

```bash
docker build -t telemetry-ingest-api:local .
docker run -e KAFKA_BROKERS=kafka:9092 -p 8000:8000 telemetry-ingest-api:local
```

## K8s 리소스

| 리소스 | 값 |
| :--- | :--- |
| Deployment | `connected-car-command` |
| Service | `connected-car-command-svc` (ClusterIP, port 80 → 8000) |
| HPA | CPU 50% 기준, 2~10 replicas |
| Readiness Probe | `GET /health` |
