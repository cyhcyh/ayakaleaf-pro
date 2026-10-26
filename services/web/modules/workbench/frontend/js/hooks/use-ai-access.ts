import { useEffect, useState } from 'react'
import { getJSON } from '@/infrastructure/fetch-json'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

// Share the permission request across chat and compile-log components.
type AiAccess = { chat: boolean; errorAssistant: boolean }
let access: Promise<AiAccess> | undefined
if (typeof window !== 'undefined') {
  window.addEventListener('personal-ai:settings', () => {
    access = undefined
    window.dispatchEvent(new Event('personal-ai:access'))
  })
}

export default function useAiAccess(feature: keyof AiAccess = 'chat') {
  const { ai } = useInstanceFeatures()
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    if (!ai) return
    let active = true
    const refresh = () => {
    access ??= getJSON('/workbench/access')
      .then((data: { allowed: boolean; errorAssistant: boolean }) => ({
        chat: data.allowed === true,
        errorAssistant: data.errorAssistant === true,
      }))
      .catch(() => {
        access = undefined
        return { chat: false, errorAssistant: false }
      })
    access.then(value => {
      if (active) setAllowed(value[feature])
    })
    }
    refresh()
    window.addEventListener('personal-ai:access', refresh)
    return () => {
      active = false
      window.removeEventListener('personal-ai:access', refresh)
    }
  }, [ai, feature])

  return ai && allowed
}
