import { useEffect, useState } from 'react'
import { getJSON } from '@/infrastructure/fetch-json'

export type InstanceFeatures = {
  loaded: boolean
  canConfigure: boolean
  gitBridge: boolean
  ai: boolean
  githubSync: boolean
  gitlabSync: boolean
  giteaSync: boolean
  dropbox: boolean
  zotero: boolean
  mendeley: boolean
}

const DISABLED: InstanceFeatures = {
  loaded: false,
  canConfigure: false,
  gitBridge: false,
  ai: false,
  githubSync: false,
  gitlabSync: false,
  giteaSync: false,
  dropbox: false,
  zotero: false,
  mendeley: false,
}

// The frontend is compiled once, so it can't read the operator's env vars.
// Instead it asks the server (GET /system/features) which instance-level
// features are enabled, and statically bundled UI (github-sync, gitlab-sync,
// gitea-sync, dropbox, zotero, mendeley) hides itself when its feature is off. Fetched at most once per page
// load and shared across every caller.
let cache: InstanceFeatures | null = null
let inflight: Promise<InstanceFeatures> | null = null

function loadInstanceFeatures(): Promise<InstanceFeatures> {
  if (cache) {
    return Promise.resolve(cache)
  }
  if (!inflight) {
    inflight = getJSON('/system/features')
      .then((data: Partial<InstanceFeatures>) => {
        cache = {
          loaded: true,
          canConfigure: Boolean(data?.canConfigure),
          gitBridge: Boolean(data?.gitBridge),
          ai: Boolean(data?.ai),
          githubSync: Boolean(data?.githubSync),
          gitlabSync: Boolean(data?.gitlabSync),
          giteaSync: Boolean(data?.giteaSync),
          dropbox: Boolean(data?.dropbox),
          zotero: Boolean(data?.zotero),
          mendeley: Boolean(data?.mendeley),
        }
        return cache
      })
      .catch(() => DISABLED)
  }
  return inflight
}

// Defaults to all-disabled until the request resolves, so we never briefly
// flash UI for a feature that might be turned off.
export default function useInstanceFeatures(): InstanceFeatures {
  const [features, setFeatures] = useState<InstanceFeatures>(cache || DISABLED)

  useEffect(() => {
    let mounted = true
    loadInstanceFeatures().then(f => {
      if (mounted) {
        setFeatures(f)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  return features
}
