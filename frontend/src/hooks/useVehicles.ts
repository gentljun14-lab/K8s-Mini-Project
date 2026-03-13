import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Vehicle,
  VehicleSnapshot,
  VehicleSummary,
  VehiclesResponse,
  VehicleSnapshotsResponse,
  VehicleListResponse,
  VehicleDeltaResponse,
  VehicleReplayResponse,
} from '../types/vehicle'
import type { RawVehicleData } from '../types/vehicle'

type VehicleQueryFilters = {
  vehicleId?: string
  includeVehicleId?: string
  state?: string
  city?: string
  minSpeed?: number
  maxSpeed?: number
  minLat?: number
  maxLat?: number
  minLng?: number
  maxLng?: number
}

const configuredBase = (import.meta.env.VITE_QUERY_API_URL || '/api').trim()
const MIN_INTERVAL_MS = 1000
const SSE_RETRY_MIN_MS = 1000
const SSE_RETRY_MAX_MS = 15000
const SSE_MAX_FAILURES_BEFORE_DISABLE = 1
const REALTIME_STALE_MS = 8000

const QUERY_API_BASE = (() => {
  if (!configuredBase || configuredBase === '/') return '/api'

  if (
    configuredBase.startsWith('http://') ||
    configuredBase.startsWith('https://') ||
    configuredBase.startsWith('//')
  ) {
    return configuredBase.replace(/\/+$/, '')
  }

  return `/${configuredBase.replace(/^\/+/, '').replace(/\/+$/, '')}`
})()

function stripBasePrefix(path: string, base: string): string {
  if (!base || base === '/') {
    return path.startsWith('/') ? path : `/${path}`
  }

  if (path.startsWith(base)) {
    const sliced = path.slice(base.length)
    return sliced.startsWith('/') ? sliced : `/${sliced}`
  }

  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }

  return path.startsWith('/') ? path : `/${path}`
}

export function buildApiUrl(path: string) {
  const base = QUERY_API_BASE.replace(/\/+$/, '')
  const normalizedPath = stripBasePrefix(path, base)
  return `${base}${normalizedPath}`
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : 0
  }
  if (typeof value === 'string') {
    const num = Number(value)
    if (Number.isFinite(num)) {
      return Math.trunc(num)
    }
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

function parseReceivedAt(accepted: unknown): number {
  const numberValue = parseNumber(accepted)
  if (numberValue > 0) {
    return numberValue
  }
  return 0
}

function normalizeTimestamp(accepted: unknown, fallback: number): number {
  const value = parseReceivedAt(accepted)
  if (value > 0) {
    return value
  }
  return fallback
}

function isVehicleSnapshot(input: unknown): input is Record<string, any> {
  return (
    input !== null &&
    typeof input === 'object' &&
    !('location' in input) &&
    typeof (input as any).latitude === 'number' &&
    typeof (input as any).longitude === 'number'
  )
}

export function normalizeVehicle(input: any): Vehicle {
  if (isVehicleSnapshot(input)) {
    const normalizedTripState = 'UNKNOWN' as NonNullable<RawVehicleData['trip']>['state']
    const snapshotInput = input as Record<string, any>

    return {
      vehicle_id: snapshotInput.vehicle_id as string,
      timestamp: snapshotInput.received_at as string,
      received_at: snapshotInput.received_at as string,
      event_ts: snapshotInput.event_ts as number | undefined,
      state: snapshotInput.state as string,
      speed_kmh: Number(snapshotInput.speed_kmh) || 0,
      soc_pct: Number(snapshotInput.soc_pct) || 0,
      location: {
        latitude: Number(snapshotInput.latitude),
        longitude: Number(snapshotInput.longitude),
      },
      recent_event: snapshotInput.recent_event as string | undefined,
      raw: {
        vehicle: {
          model: snapshotInput.model as string | undefined,
          driver: snapshotInput.driver as string | undefined,
        },
        location: {
          city: snapshotInput.city as string | undefined,
        },
        trip: {
          state: normalizedTripState,
          speed_kmh: Number(snapshotInput.speed_kmh) || 0,
        },
        battery: {
          soc_pct: Number(snapshotInput.soc_pct) || 0,
        },
      },
    }
  }

  return {
    vehicle_id: input.vehicle_id,
    timestamp: input.timestamp ?? input.received_at,
    received_at: input.received_at,
    event_ts: input.event_ts,
    state: input.state,
    speed_kmh: Number(input.speed_kmh) || 0,
    soc_pct: Number(input.soc_pct) || 0,
    location: input.location
      ? {
          latitude: Number(input.location.latitude),
          longitude: Number(input.location.longitude),
        }
      : undefined,
    recent_event: input.recent_event,
    raw: input.raw,
  }
}

function parseVehicles(payload: unknown): Vehicle[] {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const asVehiclePayload = payload as VehiclesResponse | VehicleSnapshotsResponse | VehicleListResponse | VehicleDeltaResponse

  if ('vehicles' in asVehiclePayload && Array.isArray(asVehiclePayload.vehicles)) {
    return asVehiclePayload.vehicles
      .map((item) => normalizeVehicle(item as Vehicle | VehicleSnapshot | VehicleSummary))
      .filter((item) => Boolean(item.vehicle_id))
  }

  if ('updates' in asVehiclePayload && Array.isArray((asVehiclePayload as VehicleDeltaResponse).updates)) {
    return (asVehiclePayload as VehicleDeltaResponse).updates
      .map((item) => normalizeVehicle(item as Vehicle | VehicleSnapshot | VehicleSummary))
      .filter((item) => Boolean(item.vehicle_id))
  }

  return []
}

function getVehicleClock(vehicle: Vehicle): number {
  return normalizeTimestamp(vehicle.event_ts, parseReceivedAt(vehicle.received_at))
}

export function parseReplayFrames(payload: unknown): Vehicle[][] {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const asReplay = payload as VehicleReplayResponse
  if (!Array.isArray(asReplay.frames)) {
    return []
  }

  return asReplay.frames.map((frame) =>
    Array.isArray(frame.vehicles)
      ? frame.vehicles
          .map((vehicle) => normalizeVehicle(vehicle))
          .filter((vehicle) => Boolean(vehicle.vehicle_id))
      : [],
  )
}

function applyVehicles(prev: Vehicle[], next: Vehicle[]): Vehicle[] {
  const map = new Map<string, Vehicle>()
  prev.forEach((vehicle) => {
    if (vehicle.vehicle_id) {
      map.set(vehicle.vehicle_id, vehicle)
    }
  })

  next.forEach((vehicle) => {
    if (!vehicle.vehicle_id) {
      return
    }

    const existing = map.get(vehicle.vehicle_id)
    if (existing) {
      const existingClock = getVehicleClock(existing)
      const incomingClock = getVehicleClock(vehicle)
      if (incomingClock > 0 && existingClock > incomingClock) {
        return
      }
    }

    map.set(vehicle.vehicle_id, {
      ...existing,
      ...vehicle,
    })
  })

  return [...map.values()].sort((a, b) => a.vehicle_id.localeCompare(b.vehicle_id))
}

interface UseVehiclesOptions {
  intervalMs?: number
  enableSSE?: boolean
  useCompact?: boolean
  useWebSocket?: boolean
  allowPollingFallback?: boolean
  filters?: VehicleQueryFilters
}

interface UseVehiclesResult {
  vehicles: Vehicle[]
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  isRealtimeConnected: boolean
}

export function useVehicles(intervalMs = 1000, options: UseVehiclesOptions = {}): UseVehiclesResult {
  const {
    enableSSE = true,
    useCompact = true,
    useWebSocket = false,
    allowPollingFallback = true,
    filters,
  } = options
  const clampedIntervalMs = Math.max(MIN_INTERVAL_MS, intervalMs)

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isRealtimeConnected, setIsRealtimeConnected] = useState<boolean>(false)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const websocketRef = useRef<WebSocket | null>(null)
  const isMountedRef = useRef(true)
  const isPollingRef = useRef(false)
  const sinceRef = useRef(0)
  const retryDelayRef = useRef(SSE_RETRY_MIN_MS)
  const requestControllerRef = useRef<AbortController | null>(null)
  const sseFailureCountRef = useRef(0)
  const sseDisabledRef = useRef(false)
  const realtimeWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastRealtimeMessageAtRef = useRef(0)

  const filterSignature = useMemo(
    () =>
      JSON.stringify({
        vehicleId: filters?.vehicleId?.trim() || '',
        includeVehicleId: filters?.includeVehicleId?.trim() || '',
        state: filters?.state?.trim() || '',
        city: filters?.city?.trim() || '',
        minSpeed: filters?.minSpeed ?? null,
        maxSpeed: filters?.maxSpeed ?? null,
        minLat: filters?.minLat ?? null,
        maxLat: filters?.maxLat ?? null,
        minLng: filters?.minLng ?? null,
        maxLng: filters?.maxLng ?? null,
      }),
    [
      filters?.vehicleId,
      filters?.includeVehicleId,
      filters?.state,
      filters?.city,
      filters?.minSpeed,
      filters?.maxSpeed,
      filters?.minLat,
      filters?.maxLat,
      filters?.minLng,
      filters?.maxLng,
    ],
  )

  const closeRealtime = useCallback(() => {
    if (realtimeWatchdogRef.current) {
      clearInterval(realtimeWatchdogRef.current)
      realtimeWatchdogRef.current = null
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    if (websocketRef.current) {
      websocketRef.current.close()
      websocketRef.current = null
    }

    setIsRealtimeConnected(false)
  }, [])

  const markRealtimeMessage = useCallback(() => {
    lastRealtimeMessageAtRef.current = Date.now()
  }, [])

  const startRealtimeWatchdog = useCallback((mode: 'sse' | 'websocket') => {
    if (realtimeWatchdogRef.current) {
      clearInterval(realtimeWatchdogRef.current)
    }

    lastRealtimeMessageAtRef.current = Date.now()
    realtimeWatchdogRef.current = window.setInterval(() => {
      if (!isMountedRef.current) {
        return
      }

      if (!lastRealtimeMessageAtRef.current) {
        return
      }

      if (Date.now() - lastRealtimeMessageAtRef.current < REALTIME_STALE_MS) {
        return
      }

      setError(mode === 'websocket' ? 'WebSocket 응답이 지연되어 재연결합니다.' : 'SSE 응답이 지연되어 재연결합니다.')

      if (mode === 'websocket' && websocketRef.current) {
        websocketRef.current.close()
        return
      }

      if (mode === 'sse' && eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }, 2000)
  }, [])

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    isPollingRef.current = false
  }, [])

  const stopRealtime = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    closeRealtime()
  }, [closeRealtime])

  const scheduleReconnect = useCallback((fn: () => void, delayMs?: number) => {
    const delay = Math.max(
      SSE_RETRY_MIN_MS,
      Math.min(SSE_RETRY_MAX_MS, delayMs ?? retryDelayRef.current),
    )

    retryDelayRef.current = Math.min(SSE_RETRY_MAX_MS, delay * 2)

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
    }

    retryTimerRef.current = window.setTimeout(() => {
      if (!isMountedRef.current) {
        return
      }
      fn()
    }, delay)
  }, [])

  function addFilters(url: URL) {
    if (filters?.vehicleId) {
      url.searchParams.set('vehicle_id', filters.vehicleId)
    }
    if (filters?.includeVehicleId) {
      url.searchParams.set('includeVehicleId', filters.includeVehicleId)
    }
    if (filters?.state) {
      url.searchParams.set('state', filters.state)
    }
    if (filters?.city) {
      url.searchParams.set('city', filters.city)
    }
    if (filters?.minSpeed !== undefined) {
      url.searchParams.set('minSpeed', String(filters.minSpeed))
    }
    if (filters?.maxSpeed !== undefined) {
      url.searchParams.set('maxSpeed', String(filters.maxSpeed))
    }
    if (filters?.minLat !== undefined) {
      url.searchParams.set('minLat', String(filters.minLat))
    }
    if (filters?.maxLat !== undefined) {
      url.searchParams.set('maxLat', String(filters.maxLat))
    }
    if (filters?.minLng !== undefined) {
      url.searchParams.set('minLng', String(filters.minLng))
    }
    if (filters?.maxLng !== undefined) {
      url.searchParams.set('maxLng', String(filters.maxLng))
    }
  }

  function updateCursorFromVehicles(updates: Vehicle[]) {
    if (updates.length === 0) {
      return
    }

    const latest = updates.reduce(
      (acc, cur) => Math.max(
        acc,
        normalizeTimestamp(
          cur.event_ts,
          parseReceivedAt(cur.received_at),
        ),
      ),
      0,
    )

    if (latest > 0) {
      sinceRef.current = Math.max(sinceRef.current, latest)
    }
  }

  function applyQueryParams(url: URL, { withSince = false }: { withSince?: boolean } = {}) {
    if (withSince && sinceRef.current) {
      url.searchParams.set('since', String(sinceRef.current))
    }

    url.searchParams.set('compact', String(useCompact))
    url.searchParams.set('summary', String(useCompact))

    addFilters(url)
    return url
  }

  async function fetchSnapshot(signal?: AbortSignal): Promise<Vehicle[]> {
    const path = useCompact ? '/api/vehicles/list' : '/api/vehicles'
    const url = applyQueryParams(new URL(buildApiUrl(path), window.location.origin), {
      withSince: false,
    })

    const res = await fetch(url.toString(), {
      signal,
      headers: {
        'Cache-Control': 'no-cache',
      },
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }

    const payload: unknown = await res.json()
    const loaded = parseVehicles(payload)
    updateCursorFromVehicles(loaded)
    return loaded
  }

  async function fetchDelta(signal?: AbortSignal): Promise<Vehicle[]> {
    if (!sinceRef.current) {
      return fetchSnapshot(signal)
    }

    const endpoint = useCompact ? '/api/vehicles/changes' : '/api/vehicles/delta'
    const url = applyQueryParams(new URL(buildApiUrl(endpoint), window.location.origin), {
      withSince: true,
    })

    const res = await fetch(url.toString(), {
      signal,
      headers: {
        'Cache-Control': 'no-cache',
      },
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }

    const payload: unknown = await res.json()
    if (!payload || typeof payload !== 'object') {
      return []
    }

    const asDelta = payload as VehicleDeltaResponse
    if (typeof asDelta.stream_last_id !== 'undefined') {
      sinceRef.current = Math.max(sinceRef.current, parseNumber(asDelta.stream_last_id))
    }
    const updates = parseVehicles(asDelta)
    updateCursorFromVehicles(updates)
    return updates
  }

  function connectSse() {
    if (
      !enableSSE ||
      useWebSocket ||
      eventSourceRef.current ||
      !isMountedRef.current ||
      sseDisabledRef.current
    ) {
      return
    }

    retryDelayRef.current = SSE_RETRY_MIN_MS
    const url = applyQueryParams(new URL(buildApiUrl('/api/vehicles/stream'), window.location.origin), {
      withSince: true,
    })
    url.searchParams.set('heartbeat_ms', '500')

    const eventSource = new EventSource(url.toString())
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      if (!isMountedRef.current) return
      sseFailureCountRef.current = 0
      sseDisabledRef.current = false
      stopPolling()
      markRealtimeMessage()
      startRealtimeWatchdog('sse')
      setIsRealtimeConnected(true)
      setError(null)
      retryDelayRef.current = SSE_RETRY_MIN_MS
    }

    eventSource.onmessage = (event) => {
      if (!isMountedRef.current) return

      try {
        const parsed = JSON.parse(event.data)
        markRealtimeMessage()
        if (typeof parsed?.stream_last_id !== 'undefined') {
          sinceRef.current = Math.max(sinceRef.current, parseNumber(parsed.stream_last_id))
        }
        if (parsed?.type === 'error') {
          setError(typeof parsed?.message === 'string' ? parsed.message : 'SSE 오류가 발생했습니다.')
          return
        }
        if (parsed?.type === 'heartbeat') {
          return
        }

        if (parsed?.type === 'snapshot' && Array.isArray(parsed?.vehicles)) {
          const normalized = parseVehicles(parsed as VehicleSnapshotsResponse)
          setVehicles(normalized)
          updateCursorFromVehicles(normalized)
          setLastUpdated(new Date())
          return
        }

        if (Array.isArray(parsed?.updates)) {
          const updates = parseVehicles(parsed as VehicleDeltaResponse)
          setVehicles((prev) => applyVehicles(prev, updates))
          updateCursorFromVehicles(updates)
          setLastUpdated(new Date())
        }
      } catch {
        if (!isMountedRef.current) return
        setError('잘못된 실시간 데이터 형식입니다.')
      }
    }

    eventSource.onerror = () => {
      if (!isMountedRef.current) return
      closeRealtime()
      if (allowPollingFallback && !intervalRef.current) {
        startPolling()
      }

      sseFailureCountRef.current += 1
      if (sseFailureCountRef.current >= SSE_MAX_FAILURES_BEFORE_DISABLE) {
        sseDisabledRef.current = true
        setError(
          allowPollingFallback
            ? 'SSE(/api/vehicles/stream)가 응답하지 않아 폴링(/api/vehicles/changes)으로 전환합니다.'
            : 'SSE(/api/vehicles/stream)가 응답하지 않습니다.',
        )
        return
      }

      scheduleReconnect(() => {
        if (!isMountedRef.current) {
          return
        }
        connectSse()
      }, SSE_RETRY_MIN_MS)
    }
  }

  function connectWebSocket() {
    if (!useWebSocket || !enableSSE || websocketRef.current || !isMountedRef.current) {
      return
    }

    retryDelayRef.current = SSE_RETRY_MIN_MS
    const baseUrl = new URL(buildApiUrl('/api/vehicles/ws'), window.location.origin)
    addFilters(baseUrl)
    const protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = baseUrl.searchParams
    params.set('compact', useCompact ? '1' : '0')
    params.set('summary', String(useCompact))
    params.set('since', String(sinceRef.current))

    const wsUrl = `${protocol}//${baseUrl.host}${baseUrl.pathname}?${params.toString()}`
    const socket = new WebSocket(wsUrl)
    websocketRef.current = socket

    socket.onopen = () => {
      if (!isMountedRef.current) return
      stopPolling()
      markRealtimeMessage()
      startRealtimeWatchdog('websocket')
      setIsRealtimeConnected(true)
      setError(null)
      retryDelayRef.current = SSE_RETRY_MIN_MS
    }

    socket.onmessage = (event) => {
      if (!isMountedRef.current) return
      try {
        const parsed = JSON.parse(event.data)
        markRealtimeMessage()
        if (typeof parsed?.stream_last_id !== 'undefined') {
          sinceRef.current = Math.max(sinceRef.current, parseNumber(parsed.stream_last_id))
        }
        if (parsed?.type === 'subscribed' || parsed?.type === 'heartbeat') {
          return
        }
        if (parsed?.type === 'error') {
          setError(typeof parsed?.message === 'string' ? parsed.message : 'WebSocket 오류가 발생했습니다.')
          return
        }
        if (parsed?.type === 'snapshot' && Array.isArray(parsed?.vehicles)) {
          const normalized = parseVehicles(parsed as VehicleSnapshotsResponse)
          setVehicles(normalized)
          updateCursorFromVehicles(normalized)
          setLastUpdated(new Date())
          return
        }

        if (Array.isArray(parsed?.updates)) {
          const updates = parseVehicles(parsed as VehicleDeltaResponse)
          setVehicles((prev) => applyVehicles(prev, updates))
          updateCursorFromVehicles(updates)
          setLastUpdated(new Date())
        }
      } catch {
        if (!isMountedRef.current) return
        setError('잘못된 실시간 데이터 형식입니다.')
      }
    }

    socket.onerror = () => {
      if (!isMountedRef.current) return
      setError('WebSocket 연결 중 오류가 발생했습니다.')
    }

    socket.onclose = () => {
      closeRealtime()
      if (!isMountedRef.current) {
        return
      }

      if (allowPollingFallback && !intervalRef.current) {
        startPolling()
      }

      scheduleReconnect(() => {
        if (!isMountedRef.current) {
          return
        }
        connectWebSocket()
      }, SSE_RETRY_MIN_MS)
    }
  }

  function startPolling() {
    if (intervalRef.current || !isMountedRef.current || isPollingRef.current) {
      return
    }

    const poll = async () => {
      if (!isMountedRef.current || isPollingRef.current) {
        return
      }

      isPollingRef.current = true

      if (requestControllerRef.current) {
        requestControllerRef.current.abort()
      }

      const controller = new AbortController()
      requestControllerRef.current = controller
      try {
        const next = await fetchDelta(controller.signal)
        if (!isMountedRef.current) {
          return
        }

        if (sinceRef.current === 0) {
          setVehicles(next)
        } else {
          setVehicles((prev) => applyVehicles(prev, next))
        }

        setError(null)
        setLastUpdated(new Date())
      } catch (e) {
        if (!isMountedRef.current) {
          return
        }
        if (controller.signal.aborted) {
          return
        }
        setError(e instanceof Error ? e.message : 'API 요청 실패')
      } finally {
        isPollingRef.current = false
        if (isMountedRef.current) {
          setLoading(false)
        }
      }
    }

    poll()
    intervalRef.current = window.setInterval(() => {
      poll()
    }, clampedIntervalMs)
  }

  useEffect(() => {
    isMountedRef.current = true
    setLoading(true)
    sinceRef.current = 0
    sseFailureCountRef.current = 0
    sseDisabledRef.current = false

    if (requestControllerRef.current) {
      requestControllerRef.current.abort()
    }

    const controller = new AbortController()
    requestControllerRef.current = controller

    const init = async () => {
      const shouldUsePollingOnly = !enableSSE
      const shouldPrefetchSnapshot = !enableSSE || allowPollingFallback

      if (shouldPrefetchSnapshot) {
        try {
          const snapshot = await fetchDelta(controller.signal)
          if (!isMountedRef.current || controller.signal.aborted) {
            return
          }
          setVehicles(snapshot)
          setError(null)
          setLastUpdated(new Date())
        } catch (e) {
          if (isMountedRef.current && !controller.signal.aborted) {
            setError(e instanceof Error ? e.message : 'API 요청 실패')
          }
        } finally {
          if (isMountedRef.current && !controller.signal.aborted) {
            setLoading(false)
          }
        }
      }

      if (enableSSE) {
        if (!shouldPrefetchSnapshot && isMountedRef.current && !controller.signal.aborted) {
          setLoading(false)
        }

        if (useWebSocket) {
          connectWebSocket()
          if (allowPollingFallback && !websocketRef.current) {
            startPolling()
          }
        } else {
          connectSse()
          if (allowPollingFallback && !eventSourceRef.current) {
            startPolling()
          }
        }
      } else if (shouldUsePollingOnly) {
        startPolling()
      }
    }

    init()

    return () => {
      isMountedRef.current = false
      isPollingRef.current = false
      sseFailureCountRef.current = 0
      sseDisabledRef.current = false
      if (requestControllerRef.current) {
        requestControllerRef.current.abort()
      }
      stopPolling()
      stopRealtime()
    }
  }, [
    clampedIntervalMs,
    enableSSE,
    filterSignature,
    allowPollingFallback,
    useCompact,
    useWebSocket,
  ])

  return {
    vehicles,
    loading,
    error,
    lastUpdated,
    isRealtimeConnected,
  }
}
