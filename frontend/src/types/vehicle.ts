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
    latitude?: number
    longitude?: number
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
  event_ts?: number
  location?: VehicleLocation
  recent_event?: string
  raw?: RawVehicleData
}

export interface VehicleSnapshot {
  vehicle_id: string
  received_at: string
  state: string
  speed_kmh: number
  soc_pct: number
  event_ts?: number
  latitude: number
  longitude: number
  city?: string
  recent_event?: string
  model?: string
  driver?: string
}

export interface VehicleSummary {
  vehicle_id: string
  received_at: string
  state: string
  speed_kmh: number
  soc_pct: number
  event_ts?: number
  latitude: number
  longitude: number
  city?: string
  recent_event?: string
  model?: string
  driver?: string
}

export interface VehiclesResponse {
  count: number
  vehicles: Vehicle[]
}

export interface VehicleSnapshotsResponse {
  count: number
  vehicles: VehicleSnapshot[]
}

export interface VehicleDeltaResponse {
  count: number
  updates: Array<Vehicle | VehicleSnapshot>
  stream_last_id?: number
}

export interface VehicleListResponse {
  type?: string
  count: number
  vehicles: VehicleSnapshot[]
  stream_last_id?: number
}
