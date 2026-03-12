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
        # Redis 키 패턴에 맞는 차량 데이터 키를 SCAN 기반으로 수집 후 MGET로 일괄 조회
        key_pattern = os.getenv("REDIS_KEY_PATTERN", "vehicle:*:latest")
        keys = list(redis_client.scan_iter(match=key_pattern, count=1000))

        if not keys:
            return {"count": 0, "vehicles": []}

        values = redis_client.mget(keys)
        vehicles = []

        for value in values:
            if not value:
                continue
            if isinstance(value, bytes):
                value = value.decode("utf-8")
            try:
                vehicles.append(json.loads(value))
            except (TypeError, json.JSONDecodeError):
                continue

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
    if isinstance(data, bytes):
        data = data.decode("utf-8")
    return json.loads(data)


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
