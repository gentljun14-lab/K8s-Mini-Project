import json
import os
from typing import Optional, Dict, Any

from redis import Redis
from pydantic import BaseModel
from dotenv import load_dotenv

# load_dotenv()는 컨테이너 환경에서는 보통 비활성화해도 됩니다.
# 필요 시 주석 해제해서 사용하세요.
# load_dotenv()

# Redis 연결 클라이언트
redis_client = Redis(
    host=os.getenv("REDIS_HOST", "localhost"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    db=int(os.getenv("REDIS_DB", 0)),
    password=os.getenv("REDIS_PASSWORD", ""),
    decode_responses=True,
    health_check_interval=30
)


class VehicleTelemetry(BaseModel):
    """차량별 텔레메트리 데이터 모델"""
    vehicle_id: str
    vin: str
    model: str
    driver: str
    timestamp: str
    location: Dict[str, Any]
    telemetry: Dict[str, Any]
    status: Dict[str, Any]
    diagnostics: Dict[str, Any]
    events: list


def get_vehicle_telemetry(vehicle_id: str) -> Optional[VehicleTelemetry]:
    """차량 ID로 Redis 최신 텔레메트리 데이터를 조회합니다."""
    key = f"vehicle:{vehicle_id}:latest"
    data_str = redis_client.get(key)
    if data_str:
        data = json.loads(data_str)
        return VehicleTelemetry(**data)
    return None


if __name__ == "__main__":
    try:
        if redis_client.ping():
            print("Redis 연결 성공!")
    except Exception as e:
        print(f"Redis 연결 실패: {e}")
