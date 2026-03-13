import { useCallback, useEffect, useMemo, useState } from 'react'
import VehicleMap from './components/VehicleMap'
import { useVehicles } from './hooks/useVehicles'
import type { Vehicle } from './types/vehicle'
import './App.css'

function App() {
  const { vehicles, loading, error, lastUpdated, isRealtimeConnected } = useVehicles(1000, {
    enableSSE: true,
    useCompact: true,
  })

  const [showStatusOverlay, setShowStatusOverlay] = useState(true)
  const [showSnapshotLabel, setShowSnapshotLabel] = useState(false)
  const [focusTracking, setFocusTracking] = useState(true)
  const [controlsExpanded, setControlsExpanded] = useState(false)
  const [focusedVehicleId, setFocusedVehicleId] = useState<string | null>(null)
  const [focusSearchText, setFocusSearchText] = useState('')
  const [replayMode, setReplayMode] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(1)
  const [replayIndex, setReplayIndex] = useState(0)
  const [frameHistory, setFrameHistory] = useState<Vehicle[][]>([])
  const [replayPlay, setReplayPlay] = useState(true)

  useEffect(() => {
    if (!replayMode) {
      setFrameHistory((prev) => {
        const next = [...prev, vehicles]
        if (next.length > 240) {
          next.shift()
        }
        return next
      })
    }
  }, [vehicles, replayMode])

  useEffect(() => {
    if (!focusTracking) {
      return
    }

    if (!focusedVehicleId && vehicles.length > 0) {
      setFocusedVehicleId(vehicles[0].vehicle_id)
    }

    if (focusedVehicleId && vehicles.length > 0 && !vehicles.some((v) => v.vehicle_id === focusedVehicleId)) {
      setFocusedVehicleId(vehicles[0].vehicle_id)
    }
  }, [focusTracking, focusedVehicleId, vehicles])

  const vehicleOptions = useMemo(() => {
    const ids = new Set<string>()
    vehicles.forEach((vehicle) => {
      ids.add(vehicle.vehicle_id)
    })
    return [...ids].sort((a, b) => a.localeCompare(b))
  }, [vehicles])

  useEffect(() => {
    if (!focusSearchText && focusedVehicleId) {
      setFocusSearchText(focusedVehicleId)
    }
  }, [focusedVehicleId, focusSearchText])

  useEffect(() => {
    if (!focusTracking) {
      setFocusedVehicleId(null)
      setFocusSearchText('')
    }
  }, [focusTracking])

  const handleFocusVehicleChange = useCallback((value: string) => {
    const next = value.trim()
    if (!next) {
      setFocusedVehicleId(null)
      return
    }

    if (vehicleOptions.includes(next)) {
      setFocusedVehicleId(next)
      setFocusSearchText(next)
    } else {
      setFocusSearchText(next)
    }
  }, [vehicleOptions])

  useEffect(() => {
    if (!replayMode) {
      setReplayIndex(frameHistory.length - 1)
      return
    }

    if (frameHistory.length === 0) {
      return
    }

    if (replayIndex > frameHistory.length - 1) {
      setReplayIndex(0)
    }
  }, [replayMode, frameHistory.length, replayIndex])

  useEffect(() => {
    if (!replayMode || !replayPlay || frameHistory.length === 0) {
      return
    }

    const tickMs = Math.max(250, 1000 / Math.max(0.5, replaySpeed))
    const timer = window.setInterval(() => {
      setReplayIndex((prev) => (prev + 1) % Math.max(1, frameHistory.length))
    }, tickMs)

    return () => window.clearInterval(timer)
  }, [replayMode, replayPlay, replaySpeed, frameHistory.length])

  const mapVehicles: Vehicle[] = replayMode ? frameHistory[replayIndex] ?? [] : vehicles

  const mapSourceText = useMemo(() => {
    if (replayMode) {
      return '재생 모드로 이전 프레임을 재생 중입니다.'
    }
    if (loading) {
      return '로딩 중...'
    }
    if (error) {
      return `오류: ${error}`
    }
    if (isRealtimeConnected) {
      return '실시간 연결: SSE/WS'
    }
    return '실시간 연결: Polling'
  }, [error, isRealtimeConnected, loading, replayMode])

  const handleVehicleSelect = useCallback(
    (vehicleId: string) => {
      if (!focusTracking) {
        setFocusedVehicleId((prev) => (prev === vehicleId ? null : vehicleId))
        return
      }
      if (vehicleOptions.includes(vehicleId)) {
        setFocusedVehicleId(vehicleId)
        setFocusSearchText(vehicleId)
      }
    },
    [focusTracking, vehicleOptions],
  )

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-copy">
          <p className="eyebrow">Mobility Control Center</p>
          <h1>Connected Car Dashboard</h1>
        </div>
        <div className="header-badge">
          <span className={`live-dot ${isRealtimeConnected && !replayMode ? 'online' : 'offline'}`} />
          {replayMode ? 'Replay Session' : isRealtimeConnected ? 'Live Stream' : 'Polling Mode'}
        </div>
        <button
          type="button"
          className="panel-toggle-button"
          onClick={() => setControlsExpanded((prev) => !prev)}
          aria-expanded={controlsExpanded}
          aria-controls="dashboard-controls"
        >
          {controlsExpanded ? '옵션 숨기기' : '옵션 보기'}
        </button>
      </header>
      <div
        id="dashboard-controls"
        className={`control-panel ${controlsExpanded ? 'expanded' : 'collapsed'}`}
      >
        <section className="panel-section toggle-grid">
          <div className="section-copy">
            <p className="section-label">Visibility</p>
            <h2>지도 표시 옵션</h2>
          </div>
          <label className="toggle-card">
            <input
              type="checkbox"
              checked={showStatusOverlay}
              onChange={(event) => setShowStatusOverlay(event.target.checked)}
            />
            <span className="toggle-switch" aria-hidden="true" />
            <span className="toggle-content">
              <strong>실시간 상태 오버레이</strong>
              <small>속도, 배터리, 상태 정보를 지도에서 바로 확인합니다.</small>
            </span>
          </label>
          <label className="toggle-card">
            <input
              type="checkbox"
              checked={showSnapshotLabel}
              onChange={(event) => setShowSnapshotLabel(event.target.checked)}
            />
            <span className="toggle-switch" aria-hidden="true" />
            <span className="toggle-content">
              <strong>스냅샷 라벨 표시</strong>
              <small>차량 모델과 드라이버 정보를 툴팁에 함께 보여줍니다.</small>
            </span>
          </label>
          <label className="toggle-card">
            <input
              type="checkbox"
              checked={focusTracking}
              onChange={(event) => {
                setFocusTracking(event.target.checked)
              }}
            />
            <span className="toggle-switch" aria-hidden="true" />
            <span className="toggle-content">
              <strong>포커스 차량 트래킹 모드</strong>
              <small>선택한 차량을 따라가며 지도를 자동으로 이동합니다.</small>
            </span>
          </label>
        </section>

        <section className="panel-section search-section">
          <div className="section-copy">
            <p className="section-label">Focus</p>
            <h2>포커스 차량 선택</h2>
          </div>
          <label className="field-card">
            <span className="field-label">Vehicle ID</span>
            <input
              type="text"
              value={focusSearchText}
              onChange={(event) => handleFocusVehicleChange(event.target.value)}
              list="vehicleIds"
              placeholder="차량 ID 검색"
              disabled={!focusTracking}
            />
            <datalist id="vehicleIds">
              {vehicleOptions.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            <small>{focusTracking ? '입력한 차량을 기준으로 지도 포커스를 맞춥니다.' : '트래킹 모드를 켜면 선택할 수 있습니다.'}</small>
          </label>
        </section>

        <section className="panel-section replay-section">
          <div className="section-copy">
            <p className="section-label">Replay</p>
            <h2>주행 기록 재생</h2>
          </div>
          <label className="toggle-card replay-toggle">
            <input
              type="checkbox"
              checked={replayMode}
              onChange={(event) => {
                setReplayMode(event.target.checked)
                if (!event.target.checked) {
                  setReplayPlay(true)
                }
              }}
            />
            <span className="toggle-switch" aria-hidden="true" />
            <span className="toggle-content">
              <strong>재생 모드</strong>
              <small>최근 프레임 히스토리를 시간순으로 다시 살펴봅니다.</small>
            </span>
          </label>
          <div className="replay-controls">
            <button
              type="button"
              className="replay-control"
              onClick={() => setReplayPlay((prev) => !prev)}
              disabled={!replayMode || frameHistory.length <= 1}
            >
              {replayPlay ? '재생 일시정지' : '재생 시작'}
            </button>
            <label className="field-card compact">
              <span className="field-label">속도</span>
              <select
                value={replaySpeed}
                onChange={(event) => setReplaySpeed(Number(event.target.value))}
                disabled={!replayMode}
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={4}>4x</option>
                <option value={8}>8x</option>
              </select>
            </label>
          </div>
          <label className="field-card slider-card">
            <div className="slider-header">
              <span className="field-label">프레임</span>
              <strong>
                {Math.min(replayIndex, Math.max(0, frameHistory.length - 1))} / {Math.max(0, frameHistory.length - 1)}
              </strong>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, frameHistory.length - 1)}
              value={Math.min(replayIndex, Math.max(0, frameHistory.length - 1))}
              onChange={(event) => setReplayIndex(Number(event.target.value))}
              disabled={!replayMode || frameHistory.length <= 1}
            />
          </label>
        </section>
      </div>
      <div className="map-wrapper">
        <div className="status-stack">
          <div className="status">{mapSourceText}</div>
          {lastUpdated && !error ? <div className="status">마지막 업데이트: {lastUpdated.toLocaleTimeString()}</div> : null}
          {focusTracking && !focusedVehicleId ? (
            <div className="status">포커스 차량을 선택하세요.</div>
          ) : null}
        </div>
        <div className="map-surface">
          <VehicleMap
            vehicles={mapVehicles}
            focusedVehicleId={focusTracking ? focusedVehicleId : null}
            showStatusOverlay={showStatusOverlay}
            showSnapshotLabel={showSnapshotLabel}
            onVehicleSelect={handleVehicleSelect}
          />
        </div>
      </div>
    </div>
  )
}

export default App
