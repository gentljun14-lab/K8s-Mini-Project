import { useVehicles } from './hooks/useVehicles'
import VehicleMap from './components/VehicleMap'
import './App.css'

// 차량 상태별 색상 (범례용)
const LEGEND = [
  { state: 'DRIVE',  color: '#00ff88', label: '주행 중' },
  { state: 'IDLE',   color: '#ffcc00', label: '공회전' },
  { state: 'PARK',   color: '#888888', label: '주차' },
  { state: 'CHARGE', color: '#00aaff', label: '충전 중' },
]

function App() {
  const { vehicles, loading, error, lastUpdated } = useVehicles(3000)

  return (
    <div className="app-container">

      {/* 상단 헤더 */}
      <header className="header">
        <h1>🚗 Connected Car Dashboard</h1>
        <div className="header-right">
          <span className="vehicle-count">차량 {vehicles.length}대</span>
          {lastUpdated && (
            <span className="last-updated">
              마지막 업데이트: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </header>

      {/* 상태 메시지 */}
      {loading && (
        <div className="status-bar loading">데이터 로딩 중...</div>
      )}
      {error && (
        <div className="status-bar error">⚠️ {error}</div>
      )}

      {/* 지도 영역 */}
      <div className="map-wrapper">
        <VehicleMap vehicles={vehicles} />

        {/* 범례 */}
        <div className="legend">
          {LEGEND.map(({ color, label }) => (
            <div key={label} className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: color }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

export default App
