import { useState, useEffect } from 'react'
import { Vehicle, VehiclesResponse } from '../types/vehicle'

// .env의 VITE_QUERY_API_URL 값을 읽어옴, 없으면 localhost:30003 사용
const API_BASE = import.meta.env.VITE_QUERY_API_URL || 'http://localhost:30003'

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
      try {
        const res = await fetch(`${API_BASE}/api/vehicles`)

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        }

        const data: VehiclesResponse = await res.json()
        setVehicles(data.vehicles ?? [])
        setError(null)
        setLastUpdated(new Date())
      } catch (e) {
        const message = e instanceof Error ? e.message : 'API 연결 실패'
        setError(message)
      } finally {
        setLoading(false)
      }
    }

    // 최초 1회 즉시 실행
    fetchVehicles()

    // 이후 intervalMs 마다 반복 실행
    const interval = setInterval(fetchVehicles, intervalMs)

    // 컴포넌트 언마운트 시 인터벌 정리
    return () => clearInterval(interval)
  }, [intervalMs])

  return { vehicles, loading, error, lastUpdated }
}
