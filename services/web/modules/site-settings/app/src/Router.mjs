import path from 'node:path'
import Authentication from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import Authorization from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import { publicConfig, saveConfig } from '../../shared/store.mjs'

const handle = run => async (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  try { await run(req, res) } catch (error) {
    const chinese = {
      'Invalid integration configuration': '集成配置格式不正确。',
      'Use an HTTP or HTTPS service address': '请填写 HTTP 或 HTTPS 服务地址。',
      'Enter the application ID and secret before enabling this integration': '启用前请填写应用 ID 和密钥。',
      'Settings changed in another window. Reload and try again.': '配置已在其他窗口更新，请刷新后重试。',
    }
    res.status(error.status || 400).json({ error: req.language === 'zh-CN' ? chinese[error.message] || error.message : error.message })
  }
}

export default {
  apply(router) {
    const admin = Authorization.ensureUserIsSiteAdmin
    router.get('/admin/integrations', admin, (req, res) => {
      res.render(path.resolve(import.meta.dirname, '../views/integrations'), { title: req.i18n.t('ayaka_integrations_configuration') })
    })
    router.get('/admin/integrations/config', admin, handle(async (req, res) => res.json(await publicConfig())))
    router.post('/admin/integrations/config', admin, handle(async (req, res) => {
      await saveConfig(req.body)
      res.json(await publicConfig())
    }))
    router.get('/interface-language', Authentication.requireLogin(), handle(async (req, res) => res.json({ language: req.language })))
    router.get('/reference-providers/status', Authentication.requireLogin(), handle(async (req, res) => {
      const user = await User.findById(SessionManager.getLoggedInUserId(req.session), { refProviders: 1 }).lean()
      res.json({ zotero: Boolean(user?.refProviders?.zotero), mendeley: Boolean(user?.refProviders?.mendeley) })
    }))
    router.post('/interface-language', Authentication.requireLogin(), handle(async (req, res) => {
      if (!['en', 'zh-CN'].includes(req.body.language)) return res.status(400).json({ error: 'Invalid interface language' })
      await User.updateOne({ _id: SessionManager.getLoggedInUserId(req.session) }, { $set: { uiLanguage: req.body.language } })
      req.session.uiLanguage = req.body.language
      res.cookie('ayaka-language', req.body.language, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 365 * 24 * 60 * 60 * 1000 })
      res.json({ language: req.body.language })
    }))
  },
}
