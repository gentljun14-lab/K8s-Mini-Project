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
const ICON_CACHE = new Map<string, L.DivIcon>()

type VehicleMapProps = {
  vehicles: Vehicle[]
  focusedVehicleId?: string | null
  showStatusOverlay: boolean
  showSnapshotLabel: boolean
  onVehicleSelect: (vehicleId: string) => void
  onViewportChange?: (viewport: {
    minLat: number
    maxLat: number
    minLng: number
    maxLng: number
    zoom: number
  }) => void
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
  const model =
    (typeof vehicle.raw?.vehicle?.model === 'string' && vehicle.raw.vehicle.model.trim())
      ? vehicle.raw.vehicle.model.trim()
      : ((typeof vehicle.raw?.model === 'string' && vehicle.raw.model.trim())
        ? vehicle.raw.model.trim()
        : ((typeof (vehicle as any).model === 'string' && (vehicle as any).model.trim())
          ? (vehicle as any).model.trim()
          : 'Unknown'))

  const driver =
    (typeof vehicle.raw?.vehicle?.driver === 'string' && vehicle.raw.vehicle.driver.trim())
      ? vehicle.raw.vehicle.driver.trim()
      : ((typeof vehicle.raw?.driver === 'string' && vehicle.raw.driver.trim())
        ? vehicle.raw.driver.trim()
        : ((typeof (vehicle as any).driver === 'string' && (vehicle as any).driver.trim())
          ? (vehicle as any).driver.trim()
          : 'Unknown'))
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

function maxVisibleMarkersForZoom(zoom: number | null): number {
  if (zoom === null) return 300
  if (zoom <= 7) return 180
  if (zoom <= 9) return 320
  if (zoom <= 11) return 520
  if (zoom <= 13) return 800
  return 1200
}

function inBounds(
  vehicles: Vehicle[],
  bounds: L.LatLngBounds | null,
  zoom: number | null,
  focusedVehicleId?: string | null,
): Vehicle[] {
  const maxVisible = maxVisibleMarkersForZoom(zoom)
  if (!bounds) {
    return vehicles.slice(0, maxVisible)
  }

  const paddedBounds = bounds.pad(0.2)

  const filtered = vehicles.filter((vehicle) => {
    const pos = getVehicleLocation(vehicle)
    if (!pos) {
      return false
    }
    return paddedBounds.contains(L.latLng(pos.latitude, pos.longitude))
  })

  const focusedVehicle =
    focusedVehicleId
      ? vehicles.find((vehicle) => vehicle.vehicle_id === focusedVehicleId) ?? null
      : null

  if (
    focusedVehicle &&
    !filtered.some((vehicle) => vehicle.vehicle_id === focusedVehicle.vehicle_id)
  ) {
    filtered.unshift(focusedVehicle)
  }

  return filtered.slice(0, maxVisible)
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
  onBoundsChange: (bounds: L.LatLngBounds, zoom: number) => void
}) {
  useMapEvents({
    moveend: (event) => onBoundsChange(event.target.getBounds(), event.target.getZoom()),
    zoomend: (event) => onBoundsChange(event.target.getBounds(), event.target.getZoom()),
    load: (event) => onBoundsChange(event.target.getBounds(), event.target.getZoom()),
  })

  return null
}

function createPinClass(selected: boolean, state: string): L.DivIcon {
  const key = `${selected ? 'selected' : 'normal'}:${state.toUpperCase()}`
  const cached = ICON_CACHE.get(key)
  if (cached) {
    return cached
  }

  const color = getStateColor(state)
  const size = selected ? 18 : 16
  const dotSize = selected ? 14 : 12
  const border = selected ? 4 : 3
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${color};border:${border}px solid white;box-shadow:0 0 6px rgba(0,0,0,0.45), 0 0 0 ${selected ? 4 : 0}px rgba(47,140,255,0.22)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
  ICON_CACHE.set(key, icon)
  return icon
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

    map.stop()
    map.setView([pos.latitude, pos.longitude], Math.max(map.getZoom(), 16), {
      animate: false,
    })

    const refreshMap = () => map.invalidateSize(false)
    refreshMap()
    const timer = window.setTimeout(refreshMap, 120)

    return () => window.clearTimeout(timer)
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
              이벤트: {label.event}
              <br />
              좌표: {pos.latitude.toFixed(6)}, {pos.longitude.toFixed(6)}
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
  onViewportChange,
}: VehicleMapProps) {
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const visibleVehicles = useMemo(
    () => inBounds(vehicles, bounds, zoom, focusedVehicleId),
    [vehicles, bounds, focusedVehicleId, zoom],
  )

  return (
    <MapContainer
      center={[36.5, 127.5]}
      zoom={7}
      style={{ width: '100%', height: '100%' }}
      preferCanvas
    >
      <MapBoundsTracker
        onBoundsChange={(nextBounds, nextZoom) => {
          setBounds(nextBounds)
          setZoom(nextZoom)
          onViewportChange?.({
            minLat: nextBounds.getSouth(),
            maxLat: nextBounds.getNorth(),
            minLng: nextBounds.getWest(),
            maxLng: nextBounds.getEast(),
            zoom: nextZoom,
          })
        }}
      />
      <FocusController focusedVehicleId={focusedVehicleId} vehicles={vehicles} />
      <TileLayer
        url={TILE_URL}
        attribution='&copy; OpenStreetMap contributors'
        maxZoom={19}
        keepBuffer={6}
        updateWhenZooming={false}
        updateWhenIdle
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
