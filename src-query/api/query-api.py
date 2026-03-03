import os
import json
from dotenv import load_dotenv

# 환경 설정을 로딩하고 .env의 값으로 환경변수를 덮어씁니다.
# override=True로 지정하면 .env 값이 기존 환경변수보다 우선합니다.
load_dotenv(override=True)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from database import redis_client


app = FastAPI(title="Connected Car Query API")

# 현재는 개발/테스트 환경을 위해 CORS를 전체 허용으로 둡니다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """서비스 상태 점검용 헬스체크. Redis 연결도 함께 확인합니다."""
    try:
        redis_client.ping()
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Redis connection failed: {str(e)}")


@app.get("/api/health")
async def api_health_check():
    """Ingress 라우팅용 /api/health 별칭."""
    return await health_check()


@app.get("/api/vehicles")
async def get_all_vehicles():
    """전체 차량의 최근 상태를 조회합니다."""
    try:
        # Redis 키 패턴에 맞는 차량 데이터 키 목록을 조회합니다.
        key_pattern = os.getenv("REDIS_KEY_PATTERN", "vehicle:*:latest")
        keys = redis_client.keys(key_pattern)

        if not keys:
            return {"count": 0, "vehicles": []}

        vehicles = [json.loads(redis_client.get(k)) for k in keys if redis_client.get(k)]
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
    return json.loads(data)


if __name__ == "__main__":
    import uvicorn

    # 로컬 실행 시 기본 포트를 8000으로 사용합니다.
    # 환경변수 QUERY_API_PORT로 실행 포트를 덮어쓸 수 있습니다.
    app_port = int(os.getenv("QUERY_API_PORT", 8000))
    app_host = os.getenv("QUERY_API_HOST", "0.0.0.0")

    print(f"Query API 시작: host={app_host}, port={app_port}")

    uvicorn.run(
        app,
        host=app_host,
        port=app_port,
        reload=False
    )
