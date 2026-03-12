# 🚗 Connected Car Dummy Stream Server

한국 전국 도로를 시뮬레이션하는 **가상 차량 텔레메트리 생성기**입니다.  
실제 차량 없이도 Ingest API로 실시간 데이터를 전송해 전체 파이프라인을 테스트할 수 있습니다.

## 기능

- 설정한 수만큼 가상 차량(`DUMMY_SEED_COUNT`)을 생성
- 각 차량이 한국 주요 도시 반경 내에서 독립적으로 주행 시뮬레이션
- 주기적으로 텔레메트리를 Ingest API(`POST /api/query/telemetry`)로 전송
- REST API를 통해 현재 차량 상태 및 이력 조회 가능

## 기술 스택

- Python 3.11, FastAPI 0.133
- httpx 0.28 (비동기 HTTP 클라이언트), Pydantic v2

## 디렉토리 구조

```
dummy-data/
 ┣ dummy_car_server.py   # FastAPI 앱 + 시뮬레이터 엔진
 ┣ car_profiles.json     # 차량 모델, 드라이버, 도시, 시드 차량 정의
 ┣ dummydata.json        # 샘플 페이로드 (참고용)
 ┣ requirements.txt
 ┣ Dockerfile
 └ .dockerignore
```

## 차량 상태 전이

```
PARK ──▶ IDLE ──▶ DRIVE ──▶ IDLE ──▶ PARK
  └──▶ CHARGE ◀──┘
```

| 상태 | 속도 | 위치 이동 | 배터리 |
| :--- | :--- | :--- | :--- |
| DRIVE | 최대 100 km/h | O | 감소 |
| IDLE | 감속 후 정지 | X | 유지 |
| PARK | 0 | X | 유지 |
| CHARGE | 0 | X | 증가 |

차량 위치는 20개 앵커 도시(서울, 부산, 제주 등) 기반으로 한국 영토 내로 제한됩니다.  
바운더리 이탈 시 방향을 반전시켜 재진입합니다.

## 환경변수

| 변수 | 기본값 | 설명 |
| :--- | :--- | :--- |
| `INGEST_SERVER_URL` | `http://localhost:8080/api/query/telemetry` | Ingest API 엔드포인트 |
| `DUMMY_SEED_COUNT` | `1000` | 생성할 가상 차량 수 |
| `INGEST_BURST_SIZE` | `1` | 한 주기에 보낼 요청 수 |
| `INGEST_CONCURRENCY` | `20` | 동시 전송 상한 (Semaphore) |
| `INGEST_INTERVAL_MIN` | `1.0` | 전송 최소 간격 (초) |
| `INGEST_INTERVAL_MAX` | `2.0` | 전송 최대 간격 (초) |
| `INGEST_REQUEST_TIMEOUT` | `2.0` | 요청 타임아웃 (초) |

## 내부 REST API

| Method | Path | 설명 |
| :--- | :--- | :--- |
| `GET` | `/` | 임의 차량 최신 스냅샷 |
| `GET` | `/api/vehicles` | 전체 차량 목록 및 요약 |
| `GET` | `/api/vehicles/{vehicle_id}` | 특정 차량 최신 텔레메트리 |
| `GET` | `/api/vehicles/{vehicle_id}/history` | 차량 이력 (최대 120건) |
| `GET` | `/api/status` | 서버 상태 및 버퍼 현황 |

## 로컬 실행

```bash
pip install -r requirements.txt
INGEST_SERVER_URL=http://localhost:8080/api/query/telemetry \
DUMMY_SEED_COUNT=10 \
uvicorn dummy_car_server:app --host 0.0.0.0 --port 8001 --reload
```

## Docker 빌드

```bash
docker build -t dummy-car-server:local .
docker run \
  -e INGEST_SERVER_URL=http://ingest-api/api/query/telemetry \
  -e DUMMY_SEED_COUNT=10 \
  -p 8001:8001 \
  dummy-car-server:local
```

## car_profiles.json 구조

시드 차량 및 프로필을 커스터마이징할 수 있습니다.

```json
{
  "vehicle_models": ["Hyundai IONIQ 5", "Tesla Model Y", ...],
  "drivers": ["김도윤", "이수민", ...],
  "city_routes": [
    { "name": "서울 강남", "latitude": 37.4979, "longitude": 127.0276 }
  ],
  "seed_vehicles": [
    {
      "vehicle_id": "CAR-1001",
      "model": "Hyundai IONIQ 5",
      "trip_state": "PARK"
    }
  ]
}
```

`seed_vehicles`에 정의된 차량은 지정된 초기 상태로 시작하고, 나머지는 랜덤 생성됩니다.
