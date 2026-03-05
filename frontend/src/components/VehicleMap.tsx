import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Leaflet 기본 마커 아이콘 깨짐 방지 설정
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
// API 키가 없을 경우를 대비해 OpenStreetMap 기본 URL도 준비해둡니다.
const DEFAULT_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const VWORLD_URL = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Base/{z}/{y}/{x}.png`

// 테스트용 더미 데이터
const DUMMY_VEHICLES = [
  {
    vehicle_id: 'V-001',
    vehicle: { model: 'Ionic 5', driver: 'Kim', vin: 'EV12345' },
    location: {
      coordinates: { latitude: 37.5665, longitude: 126.978 }, // 서울
    },
    trip: { state: 'DRIVE', speed_kmh: 65 },
    battery: { soc_pct: 82 },
  },
  {
    vehicle_id: 'V-002',
    vehicle: { model: 'EV6', driver: 'Lee', vin: 'EV67890' },
    location: {
      coordinates: { latitude: 36.3504, longitude: 127.3845 }, // 대전
    },
    trip: { state: 'IDLE', speed_kmh: 0 },
    battery: { soc_pct: 45 },
  },
]

export default function VehicleMap() {
  return (
    <MapContainer
      center={[36.5, 127.5]}
      zoom={7}
      style={{ width: '100%', height: '100%' }}
    >
      <TileLayer
        url={VWORLD_KEY ? VWORLD_URL : DEFAULT_TILE_URL}
        attribution='&copy; V World'
        maxZoom={19}
      />
      
      {DUMMY_VEHICLES.map((v) => (
        <Marker 
          key={v.vehicle_id} 
          position={[v.location.coordinates.latitude, v.location.coordinates.longitude]}
        >
          <Popup>
            <div style={{ color: '#333' }}>
              <strong>{v.vehicle.model}</strong> ({v.vehicle_id})<br />
              상태: {v.trip.state}<br />
              속도: {v.trip.speed_kmh} km/h<br />
              배터리: {v.battery.soc_pct}%
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
