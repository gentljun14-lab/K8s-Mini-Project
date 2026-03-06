import { useState, useEffect } from 'react'
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

export function useVehicles(intervalMs = 3000): UseVehiclesResult {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    const fetchVehicles = async () => {
      const endpoint = getVehiclesEndpoint()

      try {
        const res = await fetch(endpoint)
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        }

        const payload: unknown = await res.json()
        const parsed: Vehicle[] = Array.isArray(payload)
          ? payload
          : 'vehicles' in (payload as Record<string, unknown>)
            ? ((payload as VehiclesResponse).vehicles ?? [])
            : []

        setVehicles(parsed ?? [])
        setError(null)
        setLastUpdated(new Date())
      } catch (e) {
        const message = e instanceof Error ? e.message : 'API request failed'
        setError(message)
      } finally {
        setLoading(false)
      }
    }

    fetchVehicles()

    const interval = setInterval(fetchVehicles, intervalMs)
    return () => clearInterval(interval)
  }, [intervalMs])

  return { vehicles, loading, error, lastUpdated }
}
