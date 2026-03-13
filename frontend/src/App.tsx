import { useCallback, useEffect, useMemo, useState } from 'react'
import VehicleMap from './components/VehicleMap'
import { buildApiUrl, parseReplayFrames, useVehicles } from './hooks/useVehicles'
import type { Vehicle, VehicleIdsResponse } from './types/vehicle'
import './App.css'

function App() {
  const [transportMode, setTransportMode] = useState<'polling' | 'stream' | 'websocket'>('polling')
  const [viewportFilter, setViewportFilter] = useState<{
    minLat: number
    maxLat: number
    minLng: number
    maxLng: number
    zoom: number
  } | null>(null)
  const { vehicles, loading, error, lastUpdated, isRealtimeConnected } = useVehicles(1000, {
    enableSSE: transportMode !== 'polling',
    useCompact: true,
    useWebSocket: transportMode === 'websocket',
    allowPollingFallback: transportMode === 'polling',
    filters: viewportFilter
      ? {
          minLat: viewportFilter.minLat,
          maxLat: viewportFilter.maxLat,
          minLng: viewportFilter.minLng,
          maxLng: viewportFilter.maxLng,
        }
      : undefined,
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
  const [replayLoading, setReplayLoading] = useState(false)
  const [replayError, setReplayError] = useState<string | null>(null)
  const [allVehicleIds, setAllVehicleIds] = useState<string[]>([])
  const [totalVehicleCount, setTotalVehicleCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    const loadVehicleIds = async () => {
      try {
        const response = await fetch(buildApiUrl('/api/vehicles/ids'), {
          headers: { 'Cache-Control': 'no-cache' },
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const payload = await response.json() as VehicleIdsResponse
        const ids = Array.isArray(payload.vehicle_ids)
          ? [...payload.vehicle_ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
          : []

        if (!cancelled) {
          setAllVehicleIds(ids)
          setTotalVehicleCount(typeof payload.count === 'number' ? payload.count : ids.length)
        }
      } catch {
        if (!cancelled) {
          setAllVehicleIds([])
          setTotalVehicleCount(0)
        }
      }
    }

    void loadVehicleIds()
    const timer = window.setInterval(() => {
      void loadVehicleIds()
    }, 15000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!focusTracking) {
      return
    }

    if (!focusedVehicleId && allVehicleIds.length > 0) {
      setFocusedVehicleId(allVehicleIds[0])
    }
  }, [allVehicleIds, focusTracking, focusedVehicleId])

  const vehicleOptions = useMemo(() => {
    return allVehicleIds
  }, [allVehicleIds])

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
      setReplayLoading(false)
      setReplayError(null)
      return
    }

    const controller = new AbortController()

    const loadReplayFrames = async () => {
      setReplayLoading(true)
      setReplayError(null)

      try {
        const response = await fetch(buildApiUrl('/api/vehicles/replay?seconds=180&bucketMs=1000&limit=180'), {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Replay API 응답이 올바르지 않습니다. (${response.status})`)
        }

        const payload = await response.json()
        const frames = parseReplayFrames(payload)

        setFrameHistory(frames)
        setReplayIndex(0)

        if (frames.length === 0) {
          setReplayError(
            typeof payload?.detail === 'string'
              ? payload.detail
              : 'MongoDB에서 재생 이력을 찾지 못했습니다.',
          )
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return
        }

        setFrameHistory([])
        setReplayError(loadError instanceof Error ? loadError.message : '재생 이력을 불러오지 못했습니다.')
      } finally {
        if (!controller.signal.aborted) {
          setReplayLoading(false)
        }
      }
    }

    void loadReplayFrames()

    return () => controller.abort()
  }, [replayMode])

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

  const focusedVehicle = useMemo(
    () => mapVehicles.find((vehicle) => vehicle.vehicle_id === focusedVehicleId) ?? null,
    [focusedVehicleId, mapVehicles],
  )

  const dashboardStats = useMemo(() => ([
    { label: '표시 차량', value: String(mapVehicles.length) },
    { label: '전체 차량', value: String(totalVehicleCount) },
    { label: '포커스', value: focusedVehicleId ?? '없음' },
    { label: '업데이트', value: lastUpdated ? lastUpdated.toLocaleTimeString() : '대기 중' },
  ]), [focusedVehicleId, lastUpdated, mapVehicles.length, totalVehicleCount])

  const mapStatus = useMemo(() => {
    if (replayMode) {
      if (replayLoading) {
        return {
          tone: 'info',
          title: 'MongoDB 재생 이력 로딩 중',
          description: '최근 주행 히스토리를 MongoDB에서 불러오고 있습니다.',
        }
      }
      if (replayError) {
        return {
          tone: 'error',
          title: '재생 이력을 불러오지 못했습니다',
          description: replayError,
        }
      }
      return {
        tone: 'info',
        title: '재생 모드',
        description: 'MongoDB에 저장된 최근 프레임 기록을 다시 재생하고 있습니다.',
      }
    }
    if (loading) {
      return {
        tone: 'info',
        title: '로딩 중',
        description: '차량 위치와 상태 정보를 불러오고 있습니다.',
      }
    }
    if (error) {
      return {
        tone: 'error',
        title: '차량 데이터를 불러오지 못했습니다',
        description: error,
      }
    }
    if (isRealtimeConnected) {
      return {
        tone: 'success',
        title: '실시간 연결',
        description: 'SSE/WS 연결로 최신 차량 데이터를 수신 중입니다.',
      }
    }
    return {
      tone: 'warning',
      title: 'Polling 모드',
      description: '실시간 연결이 없어 주기적으로 데이터를 새로고침합니다.',
    }
  }, [error, isRealtimeConnected, loading, replayError, replayLoading, replayMode])

  const selectionStatus = useMemo(() => {
    if (focusTracking && !focusedVehicleId) {
      return {
        tone: 'warning',
        title: '포커스 차량을 선택하세요',
        description: '차량 ID를 검색하거나 지도 마커를 눌러 추적을 시작할 수 있습니다.',
      }
    }

    if (!loading && !error && mapVehicles.length === 0) {
      return {
        tone: 'info',
        title: '표시 가능한 차량이 없습니다',
        description: '데이터가 들어오면 지도에 마커와 상태가 표시됩니다.',
      }
    }

    return null
  }, [error, focusTracking, focusedVehicleId, loading, mapVehicles.length])

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
          <p className="header-subtitle">실시간 차량 위치와 재생 이력을 하나의 지도에서 관리합니다.</p>
        </div>
        <div className="header-actions">
          <div className="mode-switcher" role="group" aria-label="데이터 수신 모드 선택">
            <button
              type="button"
              className={`mode-option ${transportMode === 'polling' ? 'active' : ''}`}
              onClick={() => setTransportMode('polling')}
            >
              Polling
            </button>
            <button
              type="button"
              className={`mode-option ${transportMode === 'stream' ? 'active' : ''}`}
              onClick={() => setTransportMode('stream')}
            >
              Stream
            </button>
            <button
              type="button"
              className={`mode-option ${transportMode === 'websocket' ? 'active' : ''}`}
              onClick={() => setTransportMode('websocket')}
            >
              WebSocket
            </button>
          </div>
          <div className="header-badge">
            <span className={`live-dot ${isRealtimeConnected && !replayMode ? 'online' : 'offline'}`} />
            {replayMode
              ? 'Replay Session'
              : transportMode === 'polling'
                ? 'Polling Mode'
                : transportMode === 'websocket'
                  ? (isRealtimeConnected ? 'WebSocket Live' : 'WebSocket Retry')
                  : (isRealtimeConnected ? 'Live Stream' : 'Stream Retry')}
          </div>
        </div>
      </header>
      <div className={`controls-slot ${controlsExpanded ? 'expanded' : 'collapsed'}`}>
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
            <div className="search-input-row">
              <input
                type="text"
                value={focusSearchText}
                onChange={(event) => handleFocusVehicleChange(event.target.value)}
                list="vehicleIds"
                placeholder="차량 ID 검색"
                disabled={!focusTracking}
              />
              <select
                value={focusedVehicleId ?? ''}
                onChange={(event) => handleFocusVehicleChange(event.target.value)}
                disabled={!focusTracking || vehicleOptions.length === 0}
                aria-label="차량 ID 전체 목록"
              >
                <option value="">전체 차량 목록</option>
                {vehicleOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setFocusedVehicleId(null)
                  setFocusSearchText('')
                }}
                disabled={!focusTracking || (!focusSearchText && !focusedVehicleId)}
              >
                초기화
              </button>
            </div>
            <datalist id="vehicleIds">
              {vehicleOptions.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            <small>{focusTracking ? `입력한 차량을 기준으로 지도 포커스를 맞춥니다.${focusedVehicle ? ` 현재 선택: ${focusedVehicle.vehicle_id}` : ''}` : '트래킹 모드를 켜면 선택할 수 있습니다.'}</small>
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
              <small>최근 프레임 히스토리를 시간순으로 다시 살펴봅니다. 세부 조작은 지도 옆 컨트롤에서 합니다.</small>
            </span>
          </label>
          <div className="replay-summary">
            <span>현재 프레임</span>
            <strong>{Math.min(replayIndex, Math.max(0, frameHistory.length - 1))} / {Math.max(0, frameHistory.length - 1)}</strong>
          </div>
        </section>
        </div>
        <div className="controls-row">
          {replayMode ? (
            <div className="replay-inline-dock">
              <div className="replay-inline-summary">
                <span className="field-label">Replay</span>
                <strong>
                  {Math.min(replayIndex, Math.max(0, frameHistory.length - 1))} / {Math.max(0, frameHistory.length - 1)}
                </strong>
              </div>
              <button
                type="button"
                className="replay-control replay-inline-button"
                onClick={() => setReplayPlay((prev) => !prev)}
                disabled={replayLoading || frameHistory.length <= 1}
              >
                {replayPlay ? '일시정지' : '재생'}
              </button>
              <label className="field-card compact replay-inline-speed">
                <span className="field-label">속도</span>
                <select
                  value={replaySpeed}
                  onChange={(event) => setReplaySpeed(Number(event.target.value))}
                  disabled={replayLoading || frameHistory.length <= 1}
                >
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                  <option value={8}>8x</option>
                </select>
              </label>
              <label className="field-card slider-card replay-inline-slider">
                <div className="slider-header">
                  <span className="field-label">프레임 이동</span>
                  <strong>{frameHistory.length <= 1 ? '대기 중' : '드래그해서 탐색'}</strong>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, frameHistory.length - 1)}
                  value={Math.min(replayIndex, Math.max(0, frameHistory.length - 1))}
                  onChange={(event) => setReplayIndex(Number(event.target.value))}
                  disabled={replayLoading || frameHistory.length <= 1}
                />
              </label>
            </div>
          ) : null}
          <button
            type="button"
            className="panel-toggle-button"
            onClick={() => setControlsExpanded((prev) => !prev)}
            aria-expanded={controlsExpanded}
            aria-controls="dashboard-controls"
            aria-label={controlsExpanded ? '옵션 숨기기' : '옵션 보기'}
          >
            <span className={`panel-toggle-icon ${controlsExpanded ? 'expanded' : 'collapsed'}`} aria-hidden="true" />
            <span className="sr-only">{controlsExpanded ? '옵션 숨기기' : '옵션 보기'}</span>
          </button>
        </div>
      </div>
      <div className="map-wrapper">
        <div className="stats-strip">
          {dashboardStats.map((stat) => (
            <div key={stat.label} className="stat-card">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>
        <div className="status-stack">
          <div className={`status status-${mapStatus.tone}`}>
            <strong>{mapStatus.title}</strong>
            <span>{mapStatus.description}</span>
          </div>
          {selectionStatus ? (
            <div className={`status status-${selectionStatus.tone}`}>
              <strong>{selectionStatus.title}</strong>
              <span>{selectionStatus.description}</span>
            </div>
          ) : null}
        </div>
        <div className="map-surface">
          <VehicleMap
            vehicles={mapVehicles}
            focusedVehicleId={focusTracking ? focusedVehicleId : null}
            showStatusOverlay={showStatusOverlay}
            showSnapshotLabel={showSnapshotLabel}
            onVehicleSelect={handleVehicleSelect}
            onViewportChange={(nextViewport) => {
              setViewportFilter((prev) => {
                if (
                  prev &&
                  prev.zoom === nextViewport.zoom &&
                  Math.abs(prev.minLat - nextViewport.minLat) < 0.0001 &&
                  Math.abs(prev.maxLat - nextViewport.maxLat) < 0.0001 &&
                  Math.abs(prev.minLng - nextViewport.minLng) < 0.0001 &&
                  Math.abs(prev.maxLng - nextViewport.maxLng) < 0.0001
                ) {
                  return prev
                }

                return nextViewport
              })
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default App
