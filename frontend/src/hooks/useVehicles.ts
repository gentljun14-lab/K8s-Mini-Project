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

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const isMountedRef = useRef(true)
  const requestSeqRef = useRef(0)
  const clampedIntervalMs = Math.max(1000, intervalMs)
  const endpoint = getVehiclesEndpoint()

  useEffect(() => {
    const fetchVehicles = async () => {
      if (!isMountedRef.current) {
        return
      }

      const requestId = ++requestSeqRef.current
      const controller = new AbortController()
      abortRef.current?.abort()
      abortRef.current = controller

      const timeoutId = window.setTimeout(() => {
        controller.abort(new DOMException('Request timeout', 'AbortError'))
      }, 8000)

      if (requestId === 1 && vehicles.length === 0) {
        setLoading(true)
      }

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
        const parsed: Vehicle[] =
          Array.isArray(payload)
            ? payload
            : typeof payload === 'object' &&
              payload !== null &&
              'vehicles' in (payload as Record<string, unknown>)
              ? ((payload as VehiclesResponse).vehicles ?? [])
              : []

        if (requestId !== requestSeqRef.current || !isMountedRef.current) {
          return
        }

        setVehicles(parsed ?? [])
        setError(null)
        setLastUpdated(new Date())
      } catch (e) {
        if (requestId !== requestSeqRef.current) {
          return
        }

        if (controller.signal.aborted) {
          return
        }

        const message = e instanceof Error ? e.message : 'API request failed'
        if (requestId === requestSeqRef.current) {
          setError(message)
        }
      } finally {
        window.clearTimeout(timeoutId)

        if (requestId === requestSeqRef.current && isMountedRef.current) {
          setLoading(false)
        }
      }
    }

    isMountedRef.current = true
    fetchVehicles()

    intervalRef.current = window.setInterval(() => {
      fetchVehicles()
    }, clampedIntervalMs)

    return () => {
      isMountedRef.current = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
      abortRef.current?.abort(new DOMException('Component unmounted', 'AbortError'))
    }
  }, [clampedIntervalMs, endpoint])

  return { vehicles, loading, error, lastUpdated }
}
