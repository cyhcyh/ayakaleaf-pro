import { expressify } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import { isUserConfigured } from './personal-ai/Runtime.mjs'

export async function getAiAccess(userId, binding) {
  const denied = { chat: false, errorAssistant: false, enabled: false }
  if (!userId) return denied

  // Read current permissions so an admin can revoke access to an open session.
  const user = await UserGetter.promises.getUser(userId, { aiFeatures: 1 })
  if (!user || user.aiFeatures?.enabled === false) return denied

  return { enabled: true, chat: await isUserConfigured(userId, 'chat', binding), errorAssistant: await isUserConfigured(userId, 'fix') }
}

function requireAccess(feature) {
  return expressify(async (req, res, next) => {
    let access
    try {
      const userId = SessionManager.getLoggedInUserId(req.session)
      let binding = feature === 'chat' && req.body?.sessionContext ? req.body.binding : undefined
      if (feature === 'chat' && req.body?.sessionContext && binding === undefined) {
        const { sessionRow } = await import('./personal-ai/SessionMessages.mjs')
        binding = (await sessionRow(userId, req.body.projectId, req.body.id)).binding
      }
      access = await getAiAccess(userId, binding)
    } catch (error) { return res.status(error.status || 400).json({ error: error.message }) }
    if (!access[feature]) {
      return res.status(403).json({ error: 'ai_access_denied' })
    }
    next()
  })
}

export const requireAiAccess = requireAccess('chat')
export const requireErrorAssistantAccess = requireAccess('errorAssistant')

export default { requireAiAccess, requireErrorAssistantAccess }
