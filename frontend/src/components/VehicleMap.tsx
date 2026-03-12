import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMapEvents, useMap } from 'react-leaflet'
import { memo, useEffect, useMemo, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import type { Vehicle } from '../types/vehicle'

import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})
L.Marker.prototype.options.icon = DefaultIcon

const TILE_URL = '/api/map/tiles/{z}/{y}/{x}'
const MAX_VISIBLE_MARKERS = 1200

type VehicleMapProps = {
  vehicles: Vehicle[]
  focusedVehicleId?: string | null
  showStatusOverlay: boolean
  showSnapshotLabel: boolean
  onVehicleSelect: (vehicleId: string) => void
}

type VehiclePoint = {
  latitude: number
  longitude: number
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function getVehicleLocation(vehicle: Vehicle): VehiclePoint | null {
  const top = vehicle.location
  if (top) {
    const lat = toFiniteNumber(top.latitude)
    const lng = toFiniteNumber(top.longitude)
    if (lat !== undefined && lng !== undefined) {
      return { latitude: lat, longitude: lng }
    }
  }

  const rawLocation = vehicle.raw?.location
  const coord = rawLocation?.coordinates
  const lat = toFiniteNumber(coord?.latitude)
  const lng = toFiniteNumber(coord?.longitude)
  if (lat !== undefined && lng !== undefined) {
    return { latitude: lat, longitude: lng }
  }

  return null
}

function buildVehicleLabel(vehicle: Vehicle) {
  const model = vehicle.raw?.vehicle?.model ?? 'Unknown'
  const driver = vehicle.raw?.vehicle?.driver ?? 'Unknown'
  const city = vehicle.raw?.location?.city ?? '-'
  const event = vehicle.recent_event ?? '-'
  const state = vehicle.state || '-'
  const speed = Math.round(toFiniteNumber(vehicle.speed_kmh) ?? 0)
  const soc = Math.round(toFiniteNumber(vehicle.soc_pct) ?? 0)
  const receivedAt = vehicle.received_at ?? vehicle.timestamp

  return {
    model,
    driver,
    city,
    event,
    state,
    speed,
    soc,
    receivedAt,
  }
}

function inBounds(vehicles: Vehicle[], bounds: L.LatLngBounds | null): Vehicle[] {
  if (!bounds) {
    return vehicles.slice(0, MAX_VISIBLE_MARKERS)
  }

  const filtered = vehicles.filter((vehicle) => {
    const pos = getVehicleLocation(vehicle)
    if (!pos) {
      return false
    }
    return bounds.contains(L.latLng(pos.latitude, pos.longitude))
  })

  return filtered.slice(0, MAX_VISIBLE_MARKERS)
}

function getStateColor(state: string): string {
  const normalized = state.toUpperCase()
  switch (normalized) {
    case 'DRIVE':
      return '#16a34a'
    case 'IDLE':
      return '#3b82f6'
    case 'PARK':
      return '#a855f7'
    case 'CHARGE':
      return '#f59e0b'
    case 'STOPPED':
      return '#ef4444'
    default:
      return '#6b7280'
  }
}

function MapBoundsTracker({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: L.LatLngBounds) => void
}) {
  useMapEvents({
    moveend: (event) => onBoundsChange(event.target.getBounds()),
    zoomend: (event) => onBoundsChange(event.target.getBounds()),
    load: (event) => onBoundsChange(event.target.getBounds()),
  })

  return null
}

function createPinClass(selected: boolean, state: string): L.DivIcon {
  const color = selected ? '#2f8cff' : getStateColor(state)
  return L.divIcon({
    className: '',
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 6px rgba(0,0,0,0.45)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

function FocusController({
  focusedVehicleId,
  vehicles,
}: {
  focusedVehicleId: string | null | undefined
  vehicles: Vehicle[]
}) {
  const map = useMap()

  useEffect(() => {
    if (!focusedVehicleId) {
      return
    }

    const focus = vehicles.find((vehicle) => vehicle.vehicle_id === focusedVehicleId)
    if (!focus) {
      return
    }

    const pos = getVehicleLocation(focus)
    if (!pos) {
      return
    }

    map.flyTo([pos.latitude, pos.longitude], 16, {
      animate: true,
      duration: 0.8,
    })
  }, [focusedVehicleId, vehicles, map])

  return null
}

type VehicleMarkerProps = {
  vehicle: Vehicle
  isFocused: boolean
  showStatusOverlay: boolean
  showSnapshotLabel: boolean
  onVehicleSelect: (vehicleId: string) => void
}

const VehicleMarker = memo(function VehicleMarker({
  vehicle,
  isFocused,
  showStatusOverlay,
  showSnapshotLabel,
  onVehicleSelect,
}: VehicleMarkerProps) {
  const pos = getVehicleLocation(vehicle)
  if (!pos) {
    return null
  }

  const label = buildVehicleLabel(vehicle)
  const icon = createPinClass(isFocused, label.state)

  return (
    <Marker
      position={[pos.latitude, pos.longitude]}
      icon={icon}
      eventHandlers={{
        click: () => onVehicleSelect(vehicle.vehicle_id),
      }}
    >
      {(showSnapshotLabel || showStatusOverlay) ? (
        <Tooltip direction="top" offset={[0, -12]} sticky>
          <strong>{vehicle.vehicle_id}</strong>
          <br />
          {showSnapshotLabel ? (
            <>
              {label.model} / {label.driver}
              <br />
            </>
          ) : null}
          {showStatusOverlay ? (
            <span>
              상태: {label.state} | 속도: {label.speed} km/h | SOC: {label.soc}%
            </span>
          ) : null}
        </Tooltip>
      ) : null}

      {showStatusOverlay && isFocused ? (
        <Popup>
          <div style={{ color: '#1f2937', minWidth: 220 }}>
            <strong>{vehicle.vehicle_id}</strong> ({label.model})<br />
            Driver: {label.driver}<br />
            City: {label.city}<br />
            State: {label.state}<br />
            최근 이벤트: {label.event}<br />
            Speed: {label.speed} km/h<br />
            SOC: {label.soc}%<br />
            Updated: {new Date(label.receivedAt).toLocaleTimeString()}
          </div>
        </Popup>
      ) : null}
    </Marker>
  )
})

VehicleMarker.displayName = 'VehicleMarker'

export default function VehicleMap({
  vehicles,
  focusedVehicleId,
  showStatusOverlay,
  showSnapshotLabel,
  onVehicleSelect,
}: VehicleMapProps) {
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null)
  const visibleVehicles = useMemo(() => inBounds(vehicles, bounds), [vehicles, bounds])

  return (
    <MapContainer
      center={[36.5, 127.5]}
      zoom={7}
      style={{ width: '100%', height: '100%' }}
    >
      <MapBoundsTracker onBoundsChange={setBounds} />
      <FocusController focusedVehicleId={focusedVehicleId} vehicles={vehicles} />
      <TileLayer
        url={TILE_URL}
        attribution='&copy; OpenStreetMap contributors'
        maxZoom={19}
      />

      {visibleVehicles.map((vehicle) => (
        <VehicleMarker
          key={vehicle.vehicle_id}
          vehicle={vehicle}
          isFocused={vehicle.vehicle_id === focusedVehicleId}
          showStatusOverlay={showStatusOverlay}
          showSnapshotLabel={showSnapshotLabel}
          onVehicleSelect={onVehicleSelect}
        />
      ))}
    </MapContainer>
  )
}