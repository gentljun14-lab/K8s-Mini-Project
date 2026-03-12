import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import { useMemo, useState } from 'react'
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

type VehicleMapProps = {
  vehicles: Vehicle[]
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
  if (rawLocation?.coordinates) {
    const lat = toFiniteNumber(rawLocation.coordinates.latitude)
    const lng = toFiniteNumber(rawLocation.coordinates.longitude)
    if (lat !== undefined && lng !== undefined) {
      return { latitude: lat, longitude: lng }
    }
  }

  const lat = toFiniteNumber(rawLocation?.latitude)
  const lng = toFiniteNumber(rawLocation?.longitude)
  if (lat !== undefined && lng !== undefined) {
    return { latitude: lat, longitude: lng }
  }

  return null
}

function buildLabel(vehicle: Vehicle) {
  const model = vehicle.raw?.vehicle?.model ?? 'Model Unknown'
  const driver = vehicle.raw?.vehicle?.driver ?? 'Driver Unknown'
  const city = vehicle.raw?.location?.city ?? '-'
  return { model, driver, city }
}

function inBounds(vehicles: Vehicle[], bounds: L.LatLngBounds | null): Vehicle[] {
  if (!bounds) {
    return vehicles
  }

  return vehicles.filter((vehicle) => {
    const pos = getVehicleLocation(vehicle)
    if (!pos) {
      return false
    }

    const latLng = L.latLng(pos.latitude, pos.longitude)
    return bounds.contains(latLng)
  })
}

function MapBoundsTracker({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: L.LatLngBounds) => void
}) {
  useMapEvents({
    load: (event) => onBoundsChange(event.target.getBounds()),
    moveend: (event) => onBoundsChange(event.target.getBounds()),
    zoomend: (event) => onBoundsChange(event.target.getBounds()),
  })

  return null
}

export default function VehicleMap({ vehicles }: VehicleMapProps) {
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null)
  const visibleVehicles = useMemo(() => inBounds(vehicles, bounds), [vehicles, bounds])

  return (
    <MapContainer
      center={[36.5, 127.5]}
      zoom={7}
      style={{ width: '100%', height: '100%' }}
    >
      <MapBoundsTracker onBoundsChange={setBounds} />
      <TileLayer
        url={TILE_URL}
        attribution='&copy; OpenStreetMap'
        maxZoom={19}
      />

      {visibleVehicles
        .map((vehicle) => {
          const pos = getVehicleLocation(vehicle)
          if (!pos) {
            return null
          }

          const label = buildLabel(vehicle)

          return (
            <Marker key={vehicle.vehicle_id} position={[pos.latitude, pos.longitude]}>
              <Popup>
                <div style={{ color: '#333' }}>
                  <strong>{label.model}</strong> ({vehicle.vehicle_id})<br />
                  Driver: {label.driver}<br />
                  State: {vehicle.state}<br />
                  Recent: {vehicle.recent_event ?? '-'}<br />
                  Speed: {vehicle.speed_kmh} km/h<br />
                  SOC: {vehicle.soc_pct}%<br />
                  City: {label.city} ({pos.latitude.toFixed(5)}, {pos.longitude.toFixed(5)})
                </div>
              </Popup>
            </Marker>
          )
        })}
    </MapContainer>
  )
}
