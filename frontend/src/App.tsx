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
  const [showSnapshotLabel, setShowSnapshotLabel] = useState(true)
  const [focusTracking, setFocusTracking] = useState(true)
  const [focusedVehicleId, setFocusedVehicleId] = useState<string | null>(null)
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
  }, [focusTracking, focusedVehicleId, vehicles])

  useEffect(() => {
    if (!focusTracking) {
      setFocusedVehicleId(null)
    }
  }, [focusTracking])

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
      setFocusedVehicleId((prev) => {
        if (!focusTracking) {
          return prev === vehicleId ? null : vehicleId
        }
        return vehicleId
      })
    },
    [focusTracking],
  )

  return (
    <div className="app-container">
      <header className="header">
        <h1>Connected Car Dashboard</h1>
      </header>
      <div className="control-panel">
        <label>
          <input
            type="checkbox"
            checked={showStatusOverlay}
            onChange={(event) => setShowStatusOverlay(event.target.checked)}
          />
          실시간 상태 오버레이
        </label>
        <label>
          <input
            type="checkbox"
            checked={showSnapshotLabel}
            onChange={(event) => setShowSnapshotLabel(event.target.checked)}
          />
          스냅샷 라벨 표시
        </label>
        <label>
          <input
            type="checkbox"
            checked={focusTracking}
            onChange={(event) => {
              setFocusTracking(event.target.checked)
            }}
          />
          포커스 차량 트래킹 모드
        </label>
        <label>
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
          재생 모드
        </label>
        <button
          type="button"
          className="replay-control"
          onClick={() => setReplayPlay((prev) => !prev)}
          disabled={!replayMode || frameHistory.length <= 1}
        >
          {replayPlay ? '재생 일시정지' : '재생 시작'}
        </button>
        <label>
          속도:
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
        <label>
          프레임:
          <input
            type="range"
            min={0}
            max={Math.max(0, frameHistory.length - 1)}
            value={Math.min(replayIndex, Math.max(0, frameHistory.length - 1))}
            onChange={(event) => setReplayIndex(Number(event.target.value))}
            disabled={!replayMode || frameHistory.length <= 1}
          />
        </label>
      </div>
      <div className="map-wrapper">
        <div className="status">{mapSourceText}</div>
        {lastUpdated && !error ? <div className="status">마지막 업데이트: {lastUpdated.toLocaleTimeString()}</div> : null}
        <VehicleMap
          vehicles={mapVehicles}
          focusedVehicleId={focusTracking ? focusedVehicleId : null}
          showStatusOverlay={showStatusOverlay}
          showSnapshotLabel={showSnapshotLabel}
          onVehicleSelect={handleVehicleSelect}
        />
      </div>
    </div>
  )
}

export default App
