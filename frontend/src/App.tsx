import VehicleMap from './components/VehicleMap'
import './App.css'

function App() {
  return (
    <div className="app-container">
      <header className="header">
        <h1>🚗 Connected Car Dashboard</h1>
      </header>
      <div className="map-wrapper">
        <VehicleMap />
      </div>
    </div>
  )
}

export default App
