import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import WorkbenchController from './WorkbenchController.mjs'
import PermissionsMiddleware from './PermissionsMiddleware.mjs'
import { applyPersonalAiRouter, chatRuntime } from './personal-ai/Router.mjs'

export default {
  apply(webRouter) {
    applyPersonalAiRouter(webRouter)
    webRouter.use('/project', (req, res, next) => {
      res.locals.ExposedSettings.aiAvailable = true
      next()
    })
    webRouter.get(
      '/workbench/access',
      AuthenticationController.requireLogin(),
      WorkbenchController.getAccess
    )
    // Workbench AI chat (Vercel AI SDK useChat endpoint). The global JSON body
    // parser (12 MB by default) handles the UI-message history payload.
    webRouter.post(
      '/workbench/chat',
      AuthenticationController.requireLogin(),
      PermissionsMiddleware.requireAiAccess,
      chatRuntime,
      WorkbenchController.chat
    )
  },
}
