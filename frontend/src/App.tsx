import VehicleMap from './components/VehicleMap'
import { useVehicles } from './hooks/useVehicles'
import './App.css'

function App() {
  const { vehicles, loading, error, lastUpdated } = useVehicles(3000)

  return (
    <div className="app-container">
      <header className="header">
        <h1>🚗 Connected Car Dashboard - k8s mini project</h1>
      </header>
      <div className="map-wrapper">
        {loading && <div className="status">로딩 중...</div>}
        {error && <div className="status">에러: {error}</div>}
        {lastUpdated && !error && (
          <div className="status">마지막 갱신: {lastUpdated.toLocaleTimeString()}</div>
        )}
        <VehicleMap vehicles={vehicles} />
      </div>
    </div>
  )
}

export default App
