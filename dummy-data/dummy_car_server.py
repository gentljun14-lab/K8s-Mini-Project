from __future__ import annotations

import asyncio
import copy
import json
import random
import httpx  # 외부 API(카프카 수신 서버)로 POST 요청을 보내기 위해 추가됨
import os
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import cos, radians, sin
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(
    title="Connected Car Dummy Stream Server",
    version="0.1.0",
    description="Connected car dummy data producer for local simulation and API demo",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PROJECT_ROOT = Path(__file__).resolve().parent
DUMMY_DATA_PATH = PROJECT_ROOT / "car_profiles.json"

# 수신 API(Kafka Ingest Server)의 주소입니다. 
EXTERNAL_QUERY_INGEST_URL = os.getenv(
    "INGEST_SERVER_URL",
    "http://192.168.202.243:50031/api/query/telemetry",
)
MAX_SPEED_KMH = 100.0
MAX_ACCEL_KMH_PER_SEC = 8.0
MAX_DECEL_KMH_PER_SEC = 25.0
INGEST_BURST_SIZE = max(1, int(os.getenv("INGEST_BURST_SIZE", "1")))#한번 업데이트 주기마다 몇건을 한번에 보내는지(payload를 ingest_burst_size만큼 복제해서 같은 시간대에 연속 전송)
INGEST_INTERVAL_MIN = float(os.getenv("INGEST_INTERVAL_MIN", "1.0"))#다음 전송까지의 최소 대기시간
INGEST_INTERVAL_MAX = float(os.getenv("INGEST_INTERVAL_MAX", "2.0"))#다음 전송까지의 최대 대기시간
INGEST_REQUEST_TIMEOUT = float(os.getenv("INGEST_REQUEST_TIMEOUT", "2.0"))# 전송 실패동안 기다리는 timeout
INGEST_CONCURRENCY = max(1, int(os.getenv("INGEST_CONCURRENCY", "20")))# 실제 네트워크에 보내는 요청수의 상한
POST_SEMAPHORE = asyncio.Semaphore(INGEST_CONCURRENCY)
MAX_SEED_JITTER_DEG = 0.002  # 약 200m 정도(위치별 차이가 큼)
try:
    DUMMY_SEED_COUNT = max(1, int(os.getenv("DUMMY_SEED_COUNT", "1000")))
except ValueError:
    DUMMY_SEED_COUNT = 1000
KOREA_BOUNDS = [
    (33.1, 124.5, 38.8, 132.0),  # 전국 육지+섬을 넓게 감싸는 범위 (근사)
]

def _load_dummy_data() -> Dict[str, Any]:
    fallback = {
        "vehicle_models": ["Hyundai IONIQ 5", "Tesla Model Y", "Genesis GV80", "Kia EV6", "BMW i4"],
        "drivers": ["김도윤", "이수민", "박소윤", "정은재", "오도희"],
        "city_routes": [
            {"name": "서울 강남", "latitude": 37.4979, "longitude": 127.0276},
            {"name": "용인", "latitude": 37.2411, "longitude": 127.1776},
            {"name": "수원", "latitude": 37.2636, "longitude": 127.0286},
            {"name": "성남", "latitude": 37.42, "longitude": 127.1266},
            {"name": "인천", "latitude": 37.4563, "longitude": 126.7052},
        ],
        "road_events": [
            "고속도로 주행 상태가 정상입니다",
            "도심 교차로에서 정체 구간이 발생했습니다",
            "교차로에서 대기 중입니다",
            "내비게이션 경로 재탐색이 수행되었습니다",
            "차량 상태가 정상입니다",
            "사전 점검이 완료되었습니다",
            "도어 잠금 이벤트가 확인되었습니다",
            "방향지시등이 해제되었습니다",
            "제동유압 라인 점검이 완료되었습니다",
            "원격 진단이 정상입니다",
        ],
    }

    if not DUMMY_DATA_PATH.exists():
        return fallback

    try:
        with DUMMY_DATA_PATH.open("r", encoding="utf-8") as fp:
            loaded = json.load(fp)
        if isinstance(loaded, dict):
            return loaded
        raise ValueError("dummy json top-level must be object")
    except Exception as exc:  # noqa: BLE001
        print(f"[dummy-data] failed to load {DUMMY_DATA_PATH}: {exc}")
        return fallback

def _build_city_routes(data: Dict[str, Any]) -> Dict[str, Tuple[float, float]]:
    routes: Dict[str, Tuple[float, float]] = {}
    for item in data.get("city_routes", []):
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        lat = item.get("latitude")
        lon = item.get("longitude")
        if isinstance(name, str) and isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            routes[name] = (float(lat), float(lon))
    if not routes:
        routes = {"서울": (37.5665, 126.9780)}
    return routes

def _pick_city_route(routes: Dict[str, Tuple[float, float]]) -> Tuple[str, float, float]:
    city = random.choice(list(routes.keys()))
    lat, lon = routes[city]
    return city, lat, lon

def _coerce_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default

def _coerce_str(value: Any, default: str) -> str:
    return value if isinstance(value, str) and value else default

DUMMY_DATA: Dict[str, Any] = _load_dummy_data()
VEHICLE_MODELS: Tuple[str, ...] = tuple(DUMMY_DATA.get("vehicle_models", [])) or (
    "Hyundai IONIQ 5",
    "Tesla Model Y",
    "Genesis GV80",
    "Kia EV6",
    "BMW i4",
)
DRIVERS: Tuple[str, ...] = tuple(DUMMY_DATA.get("drivers", [])) or (
    "김도윤",
    "이수민",
    "박소윤",
    "정은재",
    "오도희",
)
CITY_ROUTES: Dict[str, Tuple[float, float]] = _build_city_routes(DUMMY_DATA)
ROAD_EVENTS = DUMMY_DATA.get("road_events") or [
    "고속도로 주행 상태가 정상입니다",
    "도심 교차로에서 정체 구간이 발생했습니다",
    "교차로에서 대기 중입니다",
    "내비게이션 경로 재탐색이 수행되었습니다",
    "차량 상태가 정상입니다",
    "사전 점검이 완료되었습니다",
    "도어 잠금 이벤트가 확인되었습니다",
    "방향지시등이 해제되었습니다",
    "제동유압 라인 점검이 완료되었습니다",
    "원격 진단이 정상입니다",
]

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

@dataclass
class VehicleState:
    vehicle_id: str
    vin: str
    model: str
    driver: str
    city: str
    latitude: float
    longitude: float
    odometer_km: float
    battery_soc: float
    battery_health: float
    speed_kmh: float
    trip_state: str
    is_locked: bool
    ignition_on: bool
    engine_temp_c: float
    cabin_temp_c: float
    tire_pressure_psi: Dict[str, float]
    heading_deg: float
    ambient_temp_c: float
    last_updated: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    throttle_pct: float = 0.0
    brake_pct: float = 0.0
    steering_deg: float = 0.0
    coolant_temp_c: float = field(default_factory=lambda: random.uniform(70.0, 92.0))
    is_charging: bool = False
    last_move_km: float = 0.0

class VehicleEnvelope(BaseModel):
    vehicle_id: str = Field(..., example="CAR-1001")
    vin: str = Field(..., example="KICF9AA1001000001")
    model: str = Field(..., example="Hyundai IONIQ 5")
    driver: str = Field(..., example="김도윤")
    timestamp: str
    location: Dict[str, Any]
    telemetry: Dict[str, Any]
    status: Dict[str, Any]
    diagnostics: Dict[str, Any]
    events: List[str]

def _build_tire_pressure(raw: Optional[Dict[str, Any]]) -> Dict[str, float]:
    if not isinstance(raw, dict):
        raw = {}
    return {
        "front_left": float(raw.get("front_left", random.uniform(33.0, 36.0))),
        "front_right": float(raw.get("front_right", random.uniform(33.0, 36.0))),
        "rear_left": float(raw.get("rear_left", random.uniform(33.0, 36.0))),
        "rear_right": float(raw.get("rear_right", random.uniform(33.0, 36.0))),
    }

def generate_vehicle_seeds() -> List[VehicleState]:
    seeds: List[VehicleState] = []
    target_count = max(1, DUMMY_SEED_COUNT)
    seed_vehicles = DUMMY_DATA.get("seed_vehicles")

    if isinstance(seed_vehicles, list) and seed_vehicles:
        for raw in seed_vehicles:
            if len(seeds) >= target_count:
                break
            if not isinstance(raw, dict):
                continue
            city_raw = _coerce_str(raw.get("city"), "")
            if city_raw in CITY_ROUTES:
                city_name = city_raw
                lat, lon = CITY_ROUTES[city_name]
            else:
                city_name, lat, lon = _pick_city_route(CITY_ROUTES)

            lat += random.uniform(-MAX_SEED_JITTER_DEG, MAX_SEED_JITTER_DEG)
            lon += random.uniform(-MAX_SEED_JITTER_DEG, MAX_SEED_JITTER_DEG)
            trip_state = _coerce_str(raw.get("trip_state"), random.choice(["PARK", "IDLE"]))
            ignition_on = bool(raw.get("ignition_on", trip_state == "DRIVE"))

            seeds.append(
                VehicleState(
                    vehicle_id=_coerce_str(raw.get("vehicle_id"), f"CAR-{1000 + len(seeds) + 1}"),
                    vin=_coerce_str(raw.get("vin"), f"KICF9AA{100000000 + len(seeds) + 1:09d}"),
                    model=_coerce_str(raw.get("model"), random.choice(VEHICLE_MODELS)),
                    driver=_coerce_str(raw.get("driver"), DRIVERS[len(seeds) % len(DRIVERS)]),
                    city=city_name,
                    latitude=lat,
                    longitude=lon,
                    odometer_km=_coerce_float(raw.get("odometer_km"), random.uniform(5_000, 60_000)),
                    battery_soc=_coerce_float(raw.get("battery_soc"), random.uniform(45.0, 99.0)),
                    battery_health=_coerce_float(raw.get("battery_health"), random.uniform(82.0, 100.0)),
                    speed_kmh=0.0,
                    trip_state=trip_state,
                    is_locked=bool(raw.get("is_locked", True)),
                    ignition_on=ignition_on,
                    engine_temp_c=_coerce_float(raw.get("engine_temp_c"), random.uniform(45.0, 58.0)),
                    cabin_temp_c=_coerce_float(raw.get("cabin_temp_c"), random.uniform(21.0, 26.0)),
                    tire_pressure_psi=_build_tire_pressure(raw.get("tire_pressure_psi")),
                    heading_deg=_coerce_float(raw.get("heading_deg"), random.uniform(0, 360)),
                    ambient_temp_c=_coerce_float(raw.get("ambient_temp_c"), random.uniform(-2.0, 32.0)),
                )
            )

    for idx in range(len(seeds), target_count):
        city_name, lat, lon = _pick_city_route(CITY_ROUTES)
        lat += random.uniform(-MAX_SEED_JITTER_DEG, MAX_SEED_JITTER_DEG)
        lon += random.uniform(-MAX_SEED_JITTER_DEG, MAX_SEED_JITTER_DEG)
        vehicle_num = idx + 1
        vehicle_id = f"CAR-{1000 + vehicle_num}"
        vin = f"KICF9AA{100000000 + vehicle_num:09d}"
        seeds.append(
            VehicleState(
                vehicle_id=vehicle_id,
                vin=vin,
                model=random.choice(VEHICLE_MODELS),
                driver=DRIVERS[(idx) % len(DRIVERS)],
                city=city_name,
                latitude=lat,
                longitude=lon,
                odometer_km=random.uniform(5_000, 60_000),
                battery_soc=random.uniform(45.0, 99.0),
                battery_health=random.uniform(82.0, 100.0),
                speed_kmh=0.0,
                trip_state=random.choice(["PARK", "IDLE"]),
                is_locked=True,
                ignition_on=False,
                engine_temp_c=random.uniform(45.0, 58.0),
                cabin_temp_c=random.uniform(21.0, 26.0),
                tire_pressure_psi={
                    "front_left": random.uniform(33.0, 36.0),
                    "front_right": random.uniform(33.0, 36.0),
                    "rear_left": random.uniform(33.0, 36.0),
                    "rear_right": random.uniform(33.0, 36.0),
                },
                heading_deg=random.uniform(0, 360),
                ambient_temp_c=random.uniform(-2.0, 32.0),
            )
        )
    return seeds

def _clamp(val: float, min_v: float, max_v: float) -> float:
    return max(min_v, min(max_v, val))

def haversine_step(distance_km: float, heading_deg: float, lat: float) -> Tuple[float, float]:
    distance_m = distance_km * 1000.0
    d_lat = (distance_m * cos(radians(heading_deg))) / 111_000.0
    d_lon = (distance_m * sin(radians(heading_deg))) / (111_000.0 * max(0.2, cos(radians(lat))))
    return d_lat, d_lon

def _inside_korea(lat: float, lon: float) -> bool:
    for lat_min, lon_min, lat_max, lon_max in KOREA_BOUNDS:
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
            return True
    return False

def _move_within_area(vehicle: VehicleState, move_km: float) -> Tuple[float, float]:
    """이동 후 좌표가 영역 밖이면 헤딩 반전 후 보정."""
    d_lat, d_lon = haversine_step(move_km, vehicle.heading_deg, vehicle.latitude)
    next_lat = vehicle.latitude + d_lat
    next_lon = vehicle.longitude + d_lon

    if _inside_korea(next_lat, next_lon):
        return next_lat, next_lon

    # 바운더리 탈출 시 반대 방향으로 살짝 튕겨내기
    vehicle.heading_deg = (vehicle.heading_deg + 180.0 + random.uniform(-35.0, 35.0)) % 360
    d_lat, d_lon = haversine_step(move_km, vehicle.heading_deg, vehicle.latitude)
    next_lat = vehicle.latitude + d_lat
    next_lon = vehicle.longitude + d_lon
    if _inside_korea(next_lat, next_lon):
        return next_lat, next_lon

    # 그래도 못 잡으면 정지(좌표 유지)
    return vehicle.latitude, vehicle.longitude

def simulate_trip_state(vehicle: VehicleState, dt: float) -> None:
    p = random.random()
    if vehicle.trip_state == "PARK":
        if p < 0.05:
            vehicle.trip_state = "IDLE"
            vehicle.is_locked = True
            vehicle.ignition_on = False
        elif p < 0.09:
            vehicle.trip_state = "CHARGE"
            vehicle.is_charging = True
    elif vehicle.trip_state == "IDLE":
        if p < 0.06 and vehicle.battery_soc > 5:
            vehicle.trip_state = "DRIVE"
            vehicle.is_locked = False
            vehicle.ignition_on = True
            vehicle.speed_kmh = max(vehicle.speed_kmh, 20.0)
        elif p < 0.09:
            vehicle.trip_state = "PARK"
            vehicle.is_locked = True
            vehicle.ignition_on = False
        elif p < 0.10:
            vehicle.trip_state = "CHARGE"
            vehicle.is_charging = True
    elif vehicle.trip_state == "CHARGE":
        if p < 0.15:
            vehicle.trip_state = "IDLE"
            vehicle.is_charging = False
        elif p < 0.35:
            vehicle.battery_soc = _clamp(vehicle.battery_soc + 0.08 * dt, 0, 100)
    else:
        if p < 0.04:
            vehicle.trip_state = "IDLE"
            vehicle.ignition_on = False
            vehicle.throttle_pct = 0.0
        elif p < 0.06:
            vehicle.speed_kmh = 0.0

def update_telemetry(vehicle: VehicleState, dt: float) -> List[str]:
    events = [random.choice(ROAD_EVENTS)]
    if vehicle.trip_state == "DRIVE":
        acc = random.uniform(-2.0, 4.5)
        vehicle.throttle_pct = _clamp(vehicle.throttle_pct + acc * 0.9 + random.uniform(-1.5, 1.5), 0, 100)
        vehicle.brake_pct = max(0.0, 12.0 - acc + random.uniform(-2.0, 5.0))
        desired_speed = _clamp(55.0 + (vehicle.throttle_pct / 100.0) * 45.0, 0.0, MAX_SPEED_KMH)
        # 가속/감속을 dt 기준으로 제한해 급격한 변화 방지
        max_up = MAX_ACCEL_KMH_PER_SEC * dt
        max_down = MAX_DECEL_KMH_PER_SEC * dt
        speed_delta = _clamp(desired_speed - vehicle.speed_kmh, -max_down, max_up)
        vehicle.speed_kmh = _clamp(vehicle.speed_kmh + speed_delta, 0.0, MAX_SPEED_KMH)
        move_km = vehicle.speed_kmh * dt / 3600.0
        prev_lat, prev_lon = vehicle.latitude, vehicle.longitude
        next_lat, next_lon = _move_within_area(vehicle, move_km)
        vehicle.latitude = next_lat
        vehicle.longitude = next_lon
        if next_lat == prev_lat and next_lon == prev_lon:
            vehicle.last_move_km = 0.0
        else:
            vehicle.last_move_km = move_km
            vehicle.odometer_km += vehicle.last_move_km
        vehicle.battery_soc = _clamp(
            vehicle.battery_soc - (0.6 + vehicle.speed_kmh / 120.0) * dt / 60.0, 0, 100
        )
        vehicle.coolant_temp_c = _clamp(vehicle.coolant_temp_c + random.uniform(0.0, 0.5), 65.0, 118.0)
        vehicle.engine_temp_c = _clamp(vehicle.engine_temp_c + random.uniform(-0.2, 0.6), 30.0, 95.0)
    elif vehicle.trip_state == "CHARGE":
        vehicle.speed_kmh = 0.0
        vehicle.last_move_km = 0.0
        vehicle.throttle_pct = 0.0
        vehicle.brake_pct = 0.0
        vehicle.battery_soc = _clamp(vehicle.battery_soc + random.uniform(0.3, 0.8) * dt / 60.0 * 8.0, 0, 100)
        vehicle.coolant_temp_c = _clamp(vehicle.coolant_temp_c - random.uniform(0.1, 0.5), 60.0, 95.0)
        events.append("충전 중: DC 급속 충전기 연결")
    elif vehicle.trip_state == "IDLE":
        vehicle.speed_kmh = max(0.0, vehicle.speed_kmh * 0.85)
        vehicle.last_move_km = 0.0
        vehicle.throttle_pct = 0.0
        vehicle.brake_pct = 0.0
        vehicle.coolant_temp_c = _clamp(vehicle.coolant_temp_c - random.uniform(0.0, 0.2), 55.0, 100.0)
        vehicle.engine_temp_c = _clamp(vehicle.engine_temp_c - random.uniform(0.0, 0.1), 38.0, 95.0)
    else:
        vehicle.speed_kmh = 0.0
        vehicle.last_move_km = 0.0
        vehicle.throttle_pct = 0.0
        vehicle.brake_pct = 0.0
        vehicle.ignition_on = False
        vehicle.coolant_temp_c = _clamp(vehicle.coolant_temp_c - random.uniform(0.0, 0.2), 50.0, 95.0)

    if vehicle.trip_state == "DRIVE":
        vehicle.heading_deg = (vehicle.heading_deg + random.uniform(-7.0, 7.0)) % 360
    else:
        vehicle.heading_deg = (vehicle.heading_deg + random.uniform(-1.5, 1.5)) % 360

    for tire_key in vehicle.tire_pressure_psi:
        vehicle.tire_pressure_psi[tire_key] = _clamp(
            vehicle.tire_pressure_psi[tire_key] + random.uniform(-0.12, 0.12),
            29.0,
            40.0,
        )

    vehicle.steering_deg = _clamp(vehicle.steering_deg + random.uniform(-8.0, 8.0), -90, 90)
    vehicle.cabin_temp_c = _clamp(vehicle.cabin_temp_c + random.uniform(-0.3, 0.3), 16.0, 32.0)
    vehicle.ambient_temp_c = _clamp(vehicle.ambient_temp_c + random.uniform(-0.1, 0.1), -10.0, 40.0)
    return events

def build_payload(vehicle: VehicleState, events: List[str]) -> Dict[str, Any]:
    ts = utc_now_iso()
    
    # 주행 시간 계산 (초를 시:분:초 포맷으로)
    duration_s = random.randint(0, 7200)
    m, s = divmod(duration_s, 60)
    h, m = divmod(m, 60)
    duration_hms = f"{h:02d}:{m:02d}:{s:02d}"
    
    return {
        "vehicle": {
            "vehicle_id": vehicle.vehicle_id,
            "vin": vehicle.vin,
            "model": vehicle.model,
            "driver": vehicle.driver,
            "timestamp_utc": ts
        },
        "location": {
            "city": vehicle.city,
            "coordinates": {
                "latitude": round(vehicle.latitude, 6),
                "longitude": round(vehicle.longitude, 6)
            },
            "heading_deg": round(vehicle.heading_deg, 2),
            "altitude_m": round(8 + (vehicle.vehicle_id[-1].__hash__() % 40), 2),
            "gps_accuracy_m": round(random.uniform(1.0, 8.0), 2)
        },
        "trip": {
            "state": vehicle.trip_state,
            "duration_s": duration_s,
            "duration_hms": duration_hms,
            "speed_kmh": round(vehicle.speed_kmh, 1),
            "odometer_km": round(vehicle.odometer_km, 2),
            "odometer_delta_km": round(vehicle.last_move_km, 4)
        },
        "battery": {
            "soc_pct": round(vehicle.battery_soc, 2),
            "health_pct": round(vehicle.battery_health, 2),
            "pack_voltage_v": round(370 + (vehicle.battery_soc - 50.0) * 0.09, 2),
            "pack_current_a": round((vehicle.speed_kmh * 0.08) * random.uniform(-1.0, 1.0) * 0.1, 2),
            "aux_12v_battery_v": round(random.uniform(12.0, 12.8), 2),
            "is_charging": vehicle.is_charging
        },
        "temperatures_c": {
            "cabin": round(vehicle.cabin_temp_c, 1),
            "ambient": round(vehicle.ambient_temp_c, 1),
            "engine": round(vehicle.engine_temp_c, 1),
            "coolant": round(vehicle.coolant_temp_c, 1)
        },
        "dynamics": {
            "traction": random.choice(["AWD", "FWD", "RWD"]),
            "acceleration_mps2": round((vehicle.throttle_pct / 100.0) * 3.2, 2),
            "brake_pct": round(vehicle.brake_pct, 1),
            "throttle_pct": round(vehicle.throttle_pct, 1),
            "steering_deg": round(vehicle.steering_deg, 1),
            "gear": "D" if vehicle.speed_kmh > 0.1 and vehicle.ignition_on else ("P" if vehicle.trip_state == "PARK" else "N"),
            "driving_mode": random.choice(["Normal", "Eco", "Sport"])
        },
        "status": {
            "is_locked": vehicle.is_locked,
            "ignition_on": vehicle.ignition_on,
            "park_brake": vehicle.trip_state in ["PARK", "IDLE"],
            "door_locked": {
                "front_left": vehicle.is_locked,
                "front_right": vehicle.is_locked,
                "rear_left": vehicle.is_locked,
                "rear_right": vehicle.is_locked
            },
            "window_position": {
                "front": random.choice(["up", "down"]),
                "rear": random.choice(["up", "down"])
            }
        },
        "diagnostics": {
            "warnings": {
                "abs_warning": random.random() < 0.03,
                "esp_warning": random.random() < 0.02,
                "tpms_warning": any(v < 31 for v in vehicle.tire_pressure_psi.values())
            },
            "tire_pressure_psi": {
                k: round(v, 2) for k, v in vehicle.tire_pressure_psi.items()
            },
            "firmware_ver": "CCU-1.6.3",
            "sensor_health": random.choice(["good", "good", "good", "attention"])
        },
        "events": events if events else ["상태 업데이트"]
    }

vehicle_states: Dict[str, VehicleState] = {v.vehicle_id: v for v in generate_vehicle_seeds()}
history_store: Dict[str, Deque[Dict[str, Any]]] = defaultdict(lambda: deque(maxlen=120))
producer_tasks: List[asyncio.Task[Any]] = []

async def _post_payload_with_limit(client: httpx.AsyncClient, vehicle_id: str, payload: Dict[str, Any]) -> None:
    async with POST_SEMAPHORE:
        try:
            response = await client.post(
                EXTERNAL_QUERY_INGEST_URL,
                json=payload,
                timeout=INGEST_REQUEST_TIMEOUT,
            )
            if response.status_code != 200:
                print(f"[API Error] {vehicle_id} Status {response.status_code} - {response.text}")
        except Exception as exc:
            print(f"[Network Error] Failed to send {vehicle_id}: {exc}")

async def stream_vehicle(vehicle_id: str) -> None:
    vehicle = vehicle_states[vehicle_id]
    
    # 세션 성능 향상을 위해 반복문 바깥에서 클라이언트를 생성하여 재사용합니다.
    async with httpx.AsyncClient() as client:
        while True:
            interval = random.uniform(INGEST_INTERVAL_MIN, INGEST_INTERVAL_MAX)
            await asyncio.sleep(interval)

            now = datetime.now(timezone.utc)
            dt = (now - vehicle.last_updated).total_seconds()
            dt = max(1.0, min(3.5, dt))
            vehicle.last_updated = now

            simulate_trip_state(vehicle, dt)
            events = update_telemetry(vehicle, dt)
            payload = build_payload(vehicle, events)
            history_store[vehicle_id].append(payload)
            vehicle.last_updated = now

            print(
                f"[{payload['vehicle']['timestamp_utc']}] {vehicle_id} | {vehicle.trip_state:<5} | "
                f"{payload['trip']['speed_kmh']:>5} km/h | SOC {payload['battery']['soc_pct']:.1f}%"
            )
            
            # --- API 수신 서버로 POST 전송 ---
            try:
                # payload를 JSON 형태로 직렬화하여 EXTERNAL_QUERY_INGEST_URL로 쏩니다.
                response = await client.post(EXTERNAL_QUERY_INGEST_URL, json=payload, timeout=2.0)
                if response.status_code != 200:
                    print(f"[API Error] Status {response.status_code} - {response.text}")
            except Exception as e:
                print(f"[Network Error] Failed to send {vehicle_id} data: {e}")

def get_envelope(vehicle_id: str) -> Optional[Dict[str, Any]]:
    history = history_store.get(vehicle_id)
    if not history:
        return None
    return history[-1]

@app.get("/", response_model=Dict[str, Any])
def root():
    first = next(iter(history_store.values()), None)
    if first is None or len(first) == 0:
        sample = generate_vehicle_seeds()[0]
        events = update_telemetry(sample, 0.8)
        payload = build_payload(sample, events)
    else:
        payload = first[-1]
    return payload

@app.get("/api/vehicles")
def list_vehicles():
    result = []
    for vehicle_id in vehicle_states:
        latest = get_envelope(vehicle_id)
        if latest:
            result.append(
                {
            "vehicle_id": vehicle_id,
            "vin": latest.get("vehicle", {}).get("vin"),
            "model": latest.get("vehicle", {}).get("model"),
            "driver": latest.get("vehicle", {}).get("driver"),
            "timestamp": latest.get("vehicle", {}).get("timestamp_utc"),
            "trip_state": latest.get("trip", {}).get("state"),
            "speed_kmh": latest.get("trip", {}).get("speed_kmh"),
            "battery_soc_pct": latest.get("battery", {}).get("soc_pct"),
            }
            )
    return {"count": len(result), "vehicles": result}

@app.get("/api/vehicles/{vehicle_id}", response_model=Dict[str, Any])
def get_vehicle(vehicle_id: str):
    payload = get_envelope(vehicle_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="vehicle not found or no data yet")
    return payload

@app.get("/api/vehicles/{vehicle_id}/history")
def get_vehicle_history(vehicle_id: str, limit: int = 20):
    data = history_store.get(vehicle_id, deque())
    if not data:
        return {"vehicle_id": vehicle_id, "history": []}
    max_limit = max(1, min(limit, 120))
    return {"vehicle_id": vehicle_id, "history": list(data)[-max_limit:]}

@app.get("/api/status")
def status():
    return {
        "service": "connected-car-dummy-stream",
        "vehicles": len(vehicle_states),
        "buffered_messages_per_vehicle": {
            vehicle_id: len(msgs) for vehicle_id, msgs in history_store.items()
        },
        "now": utc_now_iso(),
    }

@app.on_event("startup")
async def startup_event() -> None:
    print("Connected Car Dummy Stream starting...")
    # 주의: httpx를 사용하려면 pip install httpx 가 필요합니다.
    for vehicle_id in vehicle_states:
        task = asyncio.create_task(stream_vehicle(vehicle_id))
        producer_tasks.append(task)

@app.on_event("shutdown")
async def shutdown_event() -> None:
    for task in producer_tasks:
        task.cancel()
    await asyncio.gather(*producer_tasks, return_exceptions=True)
