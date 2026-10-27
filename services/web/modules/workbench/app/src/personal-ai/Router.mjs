import { z } from "zod";
import { streamText } from "ai";
import AuthenticationController from "../../../../../app/src/Features/Authentication/AuthenticationController.mjs";
import SessionManager from "../../../../../app/src/Features/Authentication/SessionManager.mjs";
import AuthorizationManager from "../../../../../app/src/Features/Authorization/AuthorizationManager.mjs";
import { publicProfile, saveProfile, saveConnection, getConnection } from "./ProfileStore.mjs";
import * as codex from "./Codex.mjs";
import { translate } from "./Translation.mjs";
import { sendTranslationStream } from './TranslationStream.mjs';
import { upload } from "./References.mjs";
import { approveReview, checkReview, stopReview } from "./Review.mjs";
import { withUserAi, withConnection } from "./Runtime.mjs";
import { getProvider, getProviderOptions } from "../WorkbenchAiClient.mjs";
import { buildCommentTools } from "../../../../mcp-server/app/src/CommentTools.mjs";
import { updateCatalog } from "./Catalog.mjs";
import { applyWorkspaceRoutes } from "./WorkspaceRouter.mjs";
import { getCapabilities } from "./Catalog.mjs";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const projectSchema = z.string().regex(/^[a-f0-9]{24}$/i);
const translationSchema = z.object({
  text: z.string().min(1).max(10000),
  provider: z.enum(['google-free', 'mymemory', 'google', 'llm']).optional(),
  target: z.string().optional(),
  source: z.string().optional(),
});
const user = (req) => String(SessionManager.getLoggedInUserId(req.session));

async function projectAccess(req, projectId, write = false) {
  projectSchema.parse(projectId);
  const allowed = await (
    write
      ? AuthorizationManager.promises.canUserWriteOrReviewProjectContent
      : AuthorizationManager.promises.canUserReadProject
  )(user(req), projectId);
  if (!allowed)
    throw Object.assign(new Error("无权访问该项目"), { status: 403 });
}

const handler = (run) => async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    res.json(await run(req, res));
  } catch (error) {
    res.status(error.status || 400).json({
      error:
        error instanceof z.ZodError ? "提交的配置格式不正确" : error.message,
    });
  }
};

export function applyPersonalAiRouter(router) {
  const login = AuthenticationController.requireLogin();
  const get = (path, run) =>
    router.get(`/personal-ai${path}`, login, handler(run));
  const post = (path, run) =>
    router.post(`/personal-ai${path}`, login, handler(run));
  get("/settings", async (req) => await publicProfile(user(req)));
  post("/settings", async (req) => await saveProfile(user(req), req.body));
  post('/connections/save', async req => await saveConnection(user(req), req.body));
  post('/connections/:id/capabilities', async req => await getCapabilities(user(req), await getConnection(user(req), id.parse(req.params.id)), z.string().min(1).max(200).parse(req.body.model)));
  applyWorkspaceRoutes({ get, post, user, projectAccess });
  post("/connections/:id/models", async (req) => await updateCatalog(user(req), id.parse(req.params.id)));
  post("/connections/:id/test", async (req) => {
    const connection = await getConnection(user(req), id.parse(req.params.id));
    const model = z.string().min(1).max(200).parse(req.body.model);
    await withConnection(user(req), connection, model, async () => {
      const result = streamText({
        model: getProvider()(model),
        providerOptions: getProviderOptions(),
        prompt: "Reply with OK.",
        abortSignal: AbortSignal.timeout(35000),
      });
      if (!(await result.text).trim()) throw new Error("模型没有返回测试文本");
    });
    return { ok: true };
  });
  for (const [action, fn] of Object.entries({
    login: codex.login,
    poll: codex.poll,
    logout: codex.logout,
  })) {
    post(`/connections/:id/codex/${action}`, async (req) => {
      const connection = await getConnection(
        user(req),
        id.parse(req.params.id),
      );
      if (connection.kind !== "codex") throw new Error("请选择 Codex 连接");
      return (await fn(user(req), connection.id)) || { ok: true };
    });
  }
  post("/translate", async (req, res) => {
    const input = translationSchema.parse(req.body);
    const controller = new AbortController();
    req.on("aborted", () => controller.abort());
    res.once("close", () => controller.abort());
    return await translate(user(req), input, controller.signal);
  });
  router.post('/personal-ai/translate/stream', login, async (req, res) => {
    const input = translationSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: '提交的翻译格式不正确' });
    await sendTranslationStream(req, res, (signal, onText) => translate(user(req), input.data, signal, onText));
  });
  post("/references", async (req) => {
    await projectAccess(req, req.body.projectId);
    return await upload(user(req), req.body.projectId, req.body);
  });
  post("/reviews/approve", async (req) => {
    const input = z
      .object({
        projectId: projectSchema,
        chatId: z.string().uuid(),
        scope: z.string().min(1).max(3000),
        focus: z.string().min(1).max(4000),
      })
      .parse(req.body);
    await projectAccess(req, input.projectId, true);
    return await approveReview(
      user(req),
      input.projectId,
      input.chatId,
      input.scope,
      input.focus,
    );
  });
  post("/reviews/check", async (req) => {
    const input = z
      .object({
        projectId: projectSchema,
        chatId: z.string().uuid(),
        reviewId: z.string().uuid(),
        path: z.string().max(1000),
      })
      .parse(req.body);
    await projectAccess(req, input.projectId, true);
    await checkReview(
      user(req),
      input.projectId,
      input.chatId,
      input.reviewId,
      input.path,
    );
    return { approved: true };
  });
  post("/reviews/comments", async (req) => {
    await projectAccess(req, req.body.projectId);
    return await buildCommentTools({
      userId: user(req),
      projectId: req.body.projectId,
    }).list_comments.handler({ includeResolved: false });
  });
  post("/reviews/stop", async (req) => {
    const input = z
      .object({ projectId: projectSchema, chatId: z.string().uuid() })
      .parse(req.body);
    await projectAccess(req, input.projectId);
    await stopReview(user(req), input.projectId, input.chatId);
    return { ok: true };
  });
}

export async function chatRuntime(req, res, next) {
  try {
    const projectId = req.body.projectId;
    if (projectId) await projectAccess(req, projectId);
    if (req.body.sessionContext) {
      if (!projectId) throw new Error('会话缺少项目');
      const { prepareSessionContext } = await import('./SessionMessages.mjs');
      Object.assign(req.body, await prepareSessionContext(user(req), projectId, req.body));
    }
    let feature = "chat";
    if (req.body.reviewId) {
      await checkReview(user(req), projectId, req.body.id, req.body.reviewId);
      feature = "review";
    }
    await withUserAi(user(req), feature, next, req.body.sessionContext ? req.body.binding : undefined);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
}
