import { AsyncLocalStorage } from "node:async_hooks";
import Settings from "@overleaf/settings";
import { loadProfile, getConnection } from "./ProfileStore.mjs";
import { credentials, headers } from "./Codex.mjs";
import { getCapabilities } from "./Catalog.mjs";
import { reasoningOptions } from "./ModelCapabilities.mjs";
import { selectionSchema } from './Pure.mjs';

const context = new AsyncLocalStorage();
export const currentConfig = () => context.getStore() || Settings.workbenchAi;

export async function validateSessionBinding(userId, value) {
  const binding = selectionSchema.parse(value);
  const profile = await loadProfile(userId);
  const connection = profile.connections.find(item => item.id === binding.connectionId && item.kind !== 'google');
  if (!connection || !binding.model) throw Object.assign(new Error('请选择自己的模型连接和模型'), { status: 400 });
  reasoningOptions(binding, await getCapabilities(userId, connection, binding.model));
  return binding;
}

export async function resolveConfig(userId, feature = "chat", override) {
  const profile = await loadProfile(userId);
  const binding = override ? await validateSessionBinding(userId, override) : profile.bindings[feature]?.connectionId
    ? profile.bindings[feature]
    : profile.bindings.chat;
  if (!binding?.connectionId) return Settings.workbenchAi;
  const connection = await getConnection(userId, binding.connectionId);
  const capabilities = await getCapabilities(userId, connection, binding.model);
  const controls = { capabilities, reasoningEffort: reasoningOptions(binding, capabilities) };
  if (connection.kind === "codex") {
    const tokens = await credentials(userId, connection.id);
    return {
      ...Settings.workbenchAi,
      enabled: true,
      kind: "codex",
      connectionId: connection.id,
      baseURL: connection.baseURL,
      apiKey: tokens.access_token,
      headers: headers(tokens),
      model: binding.model,
      imageModel: binding.model,
      ...controls,
    };
  }
  return {
    ...Settings.workbenchAi,
    enabled: true,
    ...connection,
    model: binding.model,
    imageModel: undefined,
    ...controls,
  };
}

export async function isUserConfigured(userId, feature = "chat", override) {
  const profile = await loadProfile(userId);
  const binding = override ? await validateSessionBinding(userId, override) : profile.bindings[feature]?.connectionId
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

export async function withUserAi(userId, feature, callback, override) {
  return await context.run(await resolveConfig(userId, feature, override), callback);
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
