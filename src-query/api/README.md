# 🔍 Mobility Query API

Redis에서 차량 최신 상태를 조회해 제공하는 **Query 서비스**입니다.  
CQRS 패턴에서 **Read(Query) 경로**를 담당하며, 쓰기 부하 없이 Redis 캐시만 조회합니다.

## 데이터 흐름

```
Frontend / 외부 클라이언트
    │  GET /api/vehicles
    ▼
Query API
    │  SCAN vehicle:*:latest → MGET (일괄 조회)
    ▼
Redis
```

## 기술 스택

- Python 3.12, FastAPI 0.133
- redis-py 7.2.0, Pydantic v2

## 디렉토리 구조

```
api/
 ┣ query-api.py    # FastAPI 앱 진입점
 ┣ database.py     # Redis 클라이언트 및 모델 정의
 ┣ requirements.txt
 ┣ Dockerfile
 └ .dockerignore
```

## API 엔드포인트

| Method | Path | 설명 |
| :--- | :--- | :--- |
| `GET` | `/api/vehicles` | 전체 차량 최신 상태 목록 조회 |
| `GET` | `/api/vehicles/{vehicle_id}` | 특정 차량 최신 상태 조회 |
| `GET` | `/health` | 헬스체크 (Redis 연결 상태 포함) |
| `GET` | `/api/health` | Ingress 경로용 헬스체크 |

### GET /api/vehicles 응답 예시

```json
{
  "count": 3,
  "vehicles": [
    {
      "vehicle_id": "CAR-1001",
      "timestamp": "2026-02-24T07:01:08Z",
      "state": "DRIVE",
      "speed_kmh": 40.1,
      "soc_pct": 92.44,
      "location": { "latitude": 37.4979, "longitude": 127.0276 },
      "recent_event": "교차로 대기 중"
    }
  ]
}
```

## Redis 키 구조

```
vehicle:{vehicle_id}:latest  →  JSON 직렬화된 텔레메트리 스냅샷 (TTL 60초)
```

조회 방식: `SCAN vehicle:*:latest` → `MGET` 일괄 조회

## 환경변수

| 변수 | 기본값 | 설명 |
| :--- | :--- | :--- |
| `REDIS_HOST` | `localhost` | Redis 호스트 |
| `REDIS_PORT` | `6379` | Redis 포트 |
| `REDIS_DB` | `0` | Redis DB 번호 |
| `REDIS_PASSWORD` | — | Redis 비밀번호 (**Secret 주입**) |
| `REDIS_KEY_PATTERN` | `vehicle:*:latest` | 차량 키 조회 패턴 |
| `QUERY_API_PORT` | `8000` | 서버 리슨 포트 |

> `REDIS_PASSWORD`는 반드시 **Kubernetes Secret**(`mobility-secret`)으로 주입해야 합니다.

## 로컬 실행

```bash
pip install -r requirements.txt
REDIS_HOST=localhost REDIS_PASSWORD=yourpassword python query-api.py
```

## Docker 빌드

```bash
docker build -t mobility-query-api:local .
docker run \
  -e REDIS_HOST=redis \
  -e REDIS_PASSWORD=yourpassword \
  -p 8000:8000 \
  mobility-query-api:local
```

## K8s 리소스

| 리소스 | 값 |
| :--- | :--- |
| Deployment | `connected-car-query` |
| Service | `connected-car-query-svc` (ClusterIP, port 80 → 8000) |
| HPA | CPU 50% 기준, 2~10 replicas |
| Readiness Probe | `GET /health` |
| REDIS_PASSWORD | `mobility-secret` Secret에서 주입 |
