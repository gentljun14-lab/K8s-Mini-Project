import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { Vehicle } from '../types/vehicle'

// .env의 VITE_VWORLD_API_KEY 값을 읽어옴
const VWORLD_KEY = import.meta.env.VITE_VWORLD_API_KEY

// V World WMTS 타일 URL
const VWORLD_URL = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Base/{z}/{y}/{x}.png`

// 차량 상태별 마커 색상
const STATE_COLOR: Record<string, string> = {
  DRIVE:  '#00ff88',  // 초록 - 주행 중
  IDLE:   '#ffcc00',  // 노랑 - 공회전
  PARK:   '#888888',  // 회색 - 주차
  CHARGE: '#00aaff',  // 파랑 - 충전 중
}

// 차량 상태 한글 변환
const STATE_LABEL: Record<string, string> = {
  DRIVE:  '주행 중',
  IDLE:   '공회전',
  PARK:   '주차',
  CHARGE: '충전 중',
}

interface VehicleMapProps {
  vehicles: Vehicle[]
}

export default function VehicleMap({ vehicles }: VehicleMapProps) {
  return (
    <MapContainer
      center={[36.5, 127.5]}   // 대한민국 중심 좌표
      zoom={7}
      style={{ width: '100%', height: '100%' }}
      zoomControl={true}
    >
      {/* V World 타일 레이어 */}
      <TileLayer
        url={VWORLD_URL}
        attribution='&copy; <a href="https://www.vworld.kr">V World</a>'
        maxZoom={19}
      />

      {/* 차량 마커 */}
      {vehicles.map((v) => {
        const { latitude, longitude } = v.location.coordinates
        const color = STATE_COLOR[v.trip.state] ?? '#ffffff'

        return (
          <CircleMarker
            key={v.vehicle_id}
            center={[latitude, longitude]}
            radius={10}
            color={color}
            fillColor={color}
            fillOpacity={0.85}
            weight={2}
          >
            <Popup>
              <div style={{ minWidth: '160px', fontSize: '13px' }}>
                <b>{v.vehicle.model}</b>
                <hr style={{ margin: '4px 0' }} />
                <div>운전자: {v.vehicle.driver}</div>
                <div>상태: {STATE_LABEL[v.trip.state] ?? v.trip.state}</div>
                <div>속도: {v.trip.speed_kmh} km/h</div>
                <div>배터리: {v.battery.soc_pct}%</div>
                <div>위치: {v.location.city}</div>
              </div>
            </Popup>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
