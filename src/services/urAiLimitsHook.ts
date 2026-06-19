import { useEffect, useState } from 'react'
import {
  type URAILimits,
  currentLimits,
  statusListeners,
} from './urAiLimits.js'

export function useURAiLimits(): URAILimits {
  const [limits, setLimits] = useState<URAILimits>({ ...currentLimits })

  useEffect(() => {
    const listener = (newLimits: URAILimits) => {
      setLimits({ ...newLimits })
    }
    statusListeners.add(listener)

    return () => {
      statusListeners.delete(listener)
    }
  }, [])

  return limits
}
