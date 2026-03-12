import { useEffect, useRef, useState } from 'react'
import type { Vehicle, VehiclesResponse } from '../types/vehicle'

const configuredBase = (import.meta.env.VITE_QUERY_API_URL || '/api').trim()

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

function getVehiclesEndpoint(): string {
  return `${QUERY_API_BASE}/vehicles`
}

interface UseVehiclesResult {
  vehicles: Vehicle[]
  loading: boolean
  error: string | null
  lastUpdated: Date | null
}

export function useVehicles(intervalMs = 1000): UseVehiclesResult {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const isMountedRef = useRef(true)
  const isRunningRef = useRef(false)
  const clampedIntervalMs = Math.max(1000, intervalMs)

  useEffect(() => {
    const fetchVehicles = async () => {
      if (!isMountedRef.current || isRunningRef.current) {
        return
      }

      isRunningRef.current = true
      const endpoint = getVehiclesEndpoint()
      const controller = new AbortController()
      abortRef.current?.abort()
      abortRef.current = controller

      const timeoutId = window.setTimeout(() => {
        controller.abort(new DOMException('Request timeout', 'AbortError'))
      }, 8000)

      setLoading(true)

      try {
        const res = await fetch(endpoint, {
          signal: controller.signal,
          headers: {
            'Cache-Control': 'no-cache',
          },
        })

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        }

        const payload: unknown = await res.json()
        const parsed: Vehicle[] = Array.isArray(payload)
          ? payload
          : typeof payload === 'object' && payload !== null && 'vehicles' in (payload as Record<string, unknown>)
            ? ((payload as VehiclesResponse).vehicles ?? [])
            : []

        setVehicles(parsed ?? [])
        setError(null)
        setLastUpdated(new Date())
      } catch (e) {
        if (controller.signal.aborted && !isMountedRef.current) {
          return
        }

        const message = e instanceof Error ? e.message : 'API request failed'
        setError(message)
      } finally {
        window.clearTimeout(timeoutId)
        isRunningRef.current = false
        setLoading(false)

        if (isMountedRef.current) {
          timerRef.current = window.setTimeout(fetchVehicles, clampedIntervalMs)
        }
      }
    }

    isMountedRef.current = true
    fetchVehicles()

    return () => {
      isMountedRef.current = false
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      abortRef.current?.abort(new DOMException('Component unmounted', 'AbortError'))
    }
  }, [clampedIntervalMs])

  return { vehicles, loading, error, lastUpdated }
}
