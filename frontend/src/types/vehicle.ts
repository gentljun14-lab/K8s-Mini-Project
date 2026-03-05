// 차량 좌표
export interface Coordinates {
  latitude: number
  longitude: number
}

// 차량 기본 정보
export interface VehicleInfo {
  vehicle_id: string
  vin: string
  model: string
  driver: string
  timestamp_utc: string
}

// 위치 정보
export interface LocationInfo {
  city: string
  coordinates: Coordinates
  heading_deg: number
  altitude_m: number
  gps_accuracy_m: number
}

// 주행 정보
export interface TripInfo {
  state: 'DRIVE' | 'IDLE' | 'PARK' | 'CHARGE'
  duration_s: number
  duration_hms: string
  speed_kmh: number
  odometer_km: number
  odometer_delta_km: number
}

// 배터리 정보
export interface BatteryInfo {
  soc_pct: number
  health_pct: number
  pack_voltage_v: number
  pack_current_a: number
  aux_12v_battery_v: number
  is_charging: boolean
}

// 온도 정보
export interface TemperaturesInfo {
  cabin: number
  ambient: number
  engine: number
  coolant: number
}

// 차량 전체 데이터 (Query API 응답 구조)
export interface Vehicle {
  vehicle_id: string
  vehicle: VehicleInfo
  location: LocationInfo
  trip: TripInfo
  battery: BatteryInfo
  temperatures_c: TemperaturesInfo
  events: string[]
}

// API 응답 전체 구조
export interface VehiclesResponse {
  count: number
  vehicles: Vehicle[]
}
