// One lookup per login session; subsequent requests use the session preference.
// Domain-based language selection remains the fallback for upstream deployments.
export async function preferredLanguage(req) {
  const userId = (req.session?.user || req.session?.passport?.user)?._id
  if (userId && req.session.uiLanguage === undefined) {
    const { User } = await import('../../../../app/src/models/User.mjs')
    const user = await User.findById(userId, { uiLanguage: 1 }).lean()
    req.session.uiLanguage = user?.uiLanguage || ''
  }
  const language = req.session?.uiLanguage || req.cookies?.['ayaka-language']
  return ['en', 'zh-CN'].includes(language) ? language : undefined
}
