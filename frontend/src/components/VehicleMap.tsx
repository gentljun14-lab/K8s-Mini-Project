import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
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

const VWORLD_KEY = import.meta.env.VITE_VWORLD_API_KEY
const DEFAULT_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const VWORLD_URL = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Base/{z}/{y}/{x}.png`

type VehicleMapProps = {
  vehicles: Vehicle[]
}

function getVehicleLocation(vehicle: Vehicle): { latitude: number; longitude: number } | null {
  const coords =
    vehicle.location &&
    Number.isFinite(vehicle.location.latitude) &&
    Number.isFinite(vehicle.location.longitude)
      ? vehicle.location
      : vehicle.raw?.location?.coordinates
        ? {
            latitude: Number(vehicle.raw.location.coordinates.latitude),
            longitude: Number(vehicle.raw.location.coordinates.longitude),
          }
        : vehicle.raw?.location
          ? {
              latitude: Number(vehicle.raw.location.latitude ?? NaN),
              longitude: Number(vehicle.raw.location.longitude ?? NaN),
            }
          : null

  if (!coords) {
    return null
  }

  if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
    return null
  }

  return coords
}

function buildLabel(vehicle: Vehicle) {
  const model = vehicle.raw?.vehicle?.model ?? '차량 모델 미제공'
  const driver = vehicle.raw?.vehicle?.driver ?? '운전자 정보 없음'
  const city = vehicle.raw?.location?.city ?? '-'
  return { model, driver, city }
}

export default function VehicleMap({ vehicles }: VehicleMapProps) {
  return (
    <MapContainer
      center={[36.5, 127.5]}
      zoom={7}
      style={{ width: '100%', height: '100%' }}
    >
      <TileLayer
        url={VWORLD_KEY ? VWORLD_URL : DEFAULT_TILE_URL}
        attribution='&copy; OpenStreetMap'
        maxZoom={19}
      />

      {vehicles
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
                  운전자: {label.driver}<br />
                  상태: {vehicle.state}<br />
                  최근 이벤트: {vehicle.recent_event ?? '-'}<br />
                  속도: {vehicle.speed_kmh} km/h<br />
                  배터리: {vehicle.soc_pct} %<br />
                  위치: {label.city} ({pos.latitude.toFixed(5)}, {pos.longitude.toFixed(5)})
                </div>
              </Popup>
            </Marker>
          )
        })}
    </MapContainer>
  )
}
