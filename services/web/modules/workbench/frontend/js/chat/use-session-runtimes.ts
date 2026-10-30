import { useCallback, useEffect, useRef, useState } from 'react'
import type { SavedSession } from '../personal-ai/session-state'

export type RuntimeState = { working: boolean; retain: boolean }
export type SessionRuntime = {
  flush: () => Promise<void>
  stopAndFlush: () => Promise<void>
  rename: (title: string) => Promise<void>
  suspend: (value: boolean) => void
  state: () => RuntimeState
}

// Only the selected conversation renders its messages. Running conversations
// keep their hooks and tools alive until their work and queued messages finish.
export default function useSessionRuntimes() {
  const [sessions, setSessions] = useState<SavedSession[]>([])
  const [currentId, setCurrentId] = useState<string>()
  const selected = useRef<string>()
  const controls = useRef(new Map<string, SessionRuntime>())
  const [activity, setActivity] = useState<Record<string, RuntimeState>>({})
  const releasing = useRef(new Set<string>())
  const activate = useCallback((session: SavedSession) => {
    selected.current = session.id
    setSessions(previous => previous.some(item => item.id === session.id) ? previous : [...previous, session])
    setCurrentId(session.id)
  }, [])
  const register = useCallback((id: string, runtime: SessionRuntime) => {
    controls.current.set(id, runtime)
    return () => {
      if (controls.current.get(id) === runtime) controls.current.delete(id)
    }
  }, [])
  const report = useCallback((id: string, state: RuntimeState) => {
    setActivity(previous => previous[id]?.working === state.working && previous[id]?.retain === state.retain
      ? previous : { ...previous, [id]: state })
  }, [])
  const remove = useCallback((ids: Set<string>) => {
    setSessions(previous => previous.filter(item => !ids.has(item.id)))
    setActivity(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !ids.has(id))))
    if (selected.current && ids.has(selected.current)) {
      selected.current = undefined
      setCurrentId(undefined)
    }
  }, [])
  useEffect(() => {
    for (const session of sessions) {
      const id = session.id, runtime = controls.current.get(id)
      if (id === currentId || !runtime || runtime.state().retain || releasing.current.has(id)) continue
      releasing.current.add(id)
      runtime.flush().then(() => {
        // The user may have returned, or another queued turn may have started
        // while the last incremental save was in flight.
        if (selected.current !== id && controls.current.get(id) === runtime && !runtime.state().retain) remove(new Set([id]))
      }).catch(() => {}).finally(() => releasing.current.delete(id))
    }
  }, [sessions, currentId, activity, remove])
  return { sessions, currentId, activate, register, report, remove, controls, activity }
}
