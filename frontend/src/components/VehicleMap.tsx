import { MapContainer, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const VWORLD_KEY = import.meta.env.VITE_VWORLD_API_KEY
const VWORLD_URL = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Base/{z}/{y}/{x}.png`

export default function VehicleMap() {
  return (
    <MapContainer
      center={[36.5, 127.5]}
      zoom={7}
      style={{ width: '100%', height: '100%' }}
    >
      <TileLayer
        url={VWORLD_URL}
        attribution='&copy; V World'
        maxZoom={19}
      />
    </MapContainer>
  )
}
