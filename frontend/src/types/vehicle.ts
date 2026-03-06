export interface VehicleLocation {
  latitude: number
  longitude: number
}

export interface RawVehicleData {
  vehicle?: {
    vehicle_id?: string
    vin?: string
    model?: string
    driver?: string
    timestamp_utc?: string
  }
  location?: {
    city?: string
    coordinates?: VehicleLocation
    heading_deg?: number
    altitude_m?: number
    gps_accuracy_m?: number
  }
  trip?: {
    state?: 'DRIVE' | 'IDLE' | 'PARK' | 'CHARGE' | 'STOPPED' | 'UNKNOWN'
    speed_kmh?: number
  }
  battery?: {
    soc_pct?: number
    health_pct?: number
    pack_voltage_v?: number
    pack_current_a?: number
    aux_12v_battery_v?: number
    is_charging?: boolean
  }
}

export interface Vehicle {
  vehicle_id: string
  timestamp: string
  received_at: string
  state: string
  speed_kmh: number
  soc_pct: number
  location?: VehicleLocation
  recent_event?: string
  raw?: RawVehicleData
}

// API 응답 전체 구조
export interface VehiclesResponse {
  count: number
  vehicles: Vehicle[]
}
