import os
import json
from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from database import redis_client

load_dotenv(override=True)

app = FastAPI(title="Connected Car Query API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _parse_vehicle_payload(raw: object | None) -> object | None:
    if raw is None:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")

    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None


@app.get("/health")
async def health_check():
    """헬스체크 API"""
    try:
        redis_client.ping()
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Redis connection failed: {str(e)}")


@app.get("/api/health")
async def api_health_check():
    """Ingress 경로 health check."""
    return await health_check()


@app.get("/api/vehicles")
async def get_all_vehicles():
    """전체 차량의 최근 상태를 조회합니다."""
    try:
        # SCAN으로 키를 순차 수집하고, MGET은 배치 단위로 조회해 메모리/지연을 낮춤
        key_pattern = os.getenv("REDIS_KEY_PATTERN", "vehicle:*:latest")
        scan_count = int(os.getenv("REDIS_SCAN_COUNT", 1000))
        mget_batch = int(os.getenv("REDIS_MGET_BATCH", 200))

        vehicles = []
        key_batch = []
        for key in redis_client.scan_iter(match=key_pattern, count=scan_count):
            key_batch.append(key)
            if len(key_batch) >= mget_batch:
                values = redis_client.mget(key_batch)
                for value in values:
                    parsed = _parse_vehicle_payload(value)
                    if parsed is not None:
                        vehicles.append(parsed)
                key_batch = []

        if key_batch:
            values = redis_client.mget(key_batch)
            for value in values:
                parsed = _parse_vehicle_payload(value)
                if parsed is not None:
                    vehicles.append(parsed)

        return {"count": len(vehicles), "vehicles": vehicles}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


@app.get("/api/vehicles/{vehicle_id}")
async def get_vehicle_by_id(vehicle_id: str):
    """특정 차량의 최근 상태를 조회합니다."""
    key = f"vehicle:{vehicle_id}:latest"
    data = redis_client.get(key)
    if not data:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    parsed = _parse_vehicle_payload(data)
    if parsed is None:
        raise HTTPException(status_code=500, detail="Invalid vehicle payload")
    return parsed


if __name__ == "__main__":
    import uvicorn

    app_port = int(os.getenv("QUERY_API_PORT", 8000))
    app_host = os.getenv("QUERY_API_HOST", "0.0.0.0")

    print(f"Query API start: host={app_host}, port={app_port}")

    uvicorn.run(
        app,
        host=app_host,
        port=app_port,
        reload=False,
    )
