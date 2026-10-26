import { AsyncLocalStorage } from "node:async_hooks";
import Settings from "@overleaf/settings";
import { loadProfile, getConnection } from "./ProfileStore.mjs";
import { credentials, headers } from "./Codex.mjs";

const context = new AsyncLocalStorage();
export const currentConfig = () => context.getStore() || Settings.workbenchAi;

export async function resolveConfig(userId, feature = "chat") {
  const profile = await loadProfile(userId);
  const binding = profile.bindings[feature]?.connectionId
    ? profile.bindings[feature]
    : profile.bindings.chat;
  if (!binding?.connectionId) return Settings.workbenchAi;
  const connection = await getConnection(userId, binding.connectionId);
  if (connection.kind === "codex") {
    const tokens = await credentials(userId, connection.id);
    return {
      ...Settings.workbenchAi,
      enabled: true,
      kind: "codex",
      baseURL: connection.baseURL,
      apiKey: tokens.access_token,
      headers: headers(tokens),
      model: binding.model,
      imageModel: binding.model,
    };
  }
  return {
    ...Settings.workbenchAi,
    enabled: true,
    ...connection,
    model: binding.model,
    imageModel: undefined,
  };
}

export async function isUserConfigured(userId, feature = "chat") {
  const profile = await loadProfile(userId);
  const binding = profile.bindings[feature]?.connectionId
    ? profile.bindings[feature]
    : profile.bindings.chat;
  if (binding?.connectionId) {
    const connection = profile.connections.find(
      (c) => c.id === binding.connectionId,
    );
    return Boolean(
      connection &&
      binding.model &&
      (connection.kind === "codex" || connection.encryptedKey),
    );
  }
  const config = Settings.workbenchAi;
  return Boolean(
    config?.enabled && config.baseURL && config.apiKey && config.model,
  );
}

export async function withUserAi(userId, feature, callback) {
  return await context.run(await resolveConfig(userId, feature), callback);
}

export async function withConnection(userId, connection, model, callback) {
  let config = { ...Settings.workbenchAi, enabled: true, ...connection, model };
  if (connection.kind === "codex") {
    const tokens = await credentials(userId, connection.id);
    config = {
      ...config,
      apiKey: tokens.access_token,
      headers: headers(tokens),
    };
  }
  return await context.run(config, callback);
}

export const runtimeMiddleware = (feature) => async (req, res, next) => {
  try {
    const { default: SessionManager } =
      await import("../../../../../app/src/Features/Authentication/SessionManager.mjs");
    await withUserAi(
      SessionManager.getLoggedInUserId(req.session),
      feature,
      next,
    );
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
