import crypto from "node:crypto";
import { collection, decrypt, encrypt } from "./ProfileStore.mjs";

const ISSUER = "https://auth.openai.com";
const CLIENT_ID =
  process.env.PERSONAL_AI_CODEX_CLIENT_ID || "app_EMoamEEZ73f0CkXaXp7hrann";
const pending = new Map();

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok)
    throw Object.assign(
      new Error(`Codex 授权请求失败（HTTP ${response.status}）`),
      { remoteStatus: response.status },
    );
  return await response.json();
}

const owner = (userId, connectionId) => `${userId}:${connectionId}`;
async function state(userId, connectionId) {
  return await (
    await collection("Codex")
  ).findOne({ _id: owner(userId, connectionId) });
}

export async function login(userId, connectionId) {
  const device = await json(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!device.device_auth_id || !device.user_code)
    throw new Error("Codex 没有返回设备码");
  const key = owner(userId, connectionId);
  const generation = crypto.randomUUID();
  const interval = Math.max(3, Number(device.interval) || 5);
  const expiresAt = Date.now() + 900000;
  await (
    await collection("Codex")
  ).updateOne(
    { _id: key },
    {
      $set: {
        userId: String(userId),
        connectionId,
        generation,
        device: encrypt({ ...device, interval, expiresAt, nextPoll: 0 }, key),
        tokens: null,
      },
    },
    { upsert: true },
  );
  return {
    userCode: device.user_code,
    verificationURL: `${ISSUER}/codex/device`,
    interval,
    expiresAt,
  };
}

export async function poll(userId, connectionId) {
  const key = owner(userId, connectionId);
  const row = await state(userId, connectionId);
  if (!row) return { status: "logged_out" };
  if (row.tokens) return { status: "ready" };
  const device = decrypt(row.device, key);
  if (!device || Date.now() > device.expiresAt) return { status: "expired" };
  if (Date.now() < device.nextPoll) return { status: "waiting" };
  device.nextPoll = Date.now() + device.interval * 1000;
  await (
    await collection("Codex")
  ).updateOne(
    { _id: key, generation: row.generation },
    { $set: { device: encrypt(device, key) } },
  );
  let code;
  try {
    code = await json(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_auth_id: device.device_auth_id,
        user_code: device.user_code,
      }),
    });
  } catch (error) {
    if ([403, 404, 429].includes(error.remoteStatus))
      return { status: "waiting" };
    throw error;
  }
  if (!code.authorization_code || !code.code_verifier)
    throw new Error("Codex 授权返回不完整");
  const tokens = await json(`${ISSUER}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code.authorization_code,
      code_verifier: code.code_verifier,
      redirect_uri: `${ISSUER}/deviceauth/callback`,
      client_id: CLIENT_ID,
    }),
  });
  if (!tokens.access_token) throw new Error("Codex 授权没有返回访问凭据");
  tokens.expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;
  const result = await (
    await collection("Codex")
  ).updateOne(
    { _id: key, generation: row.generation },
    {
      $set: { tokens: encrypt(tokens, key), device: null },
    },
  );
  return { status: result.matchedCount ? "ready" : "logged_out" };
}

export async function logout(userId, connectionId) {
  await (
    await collection("Codex")
  ).deleteOne({ _id: owner(userId, connectionId) });
}

export async function credentials(userId, connectionId, force = false) {
  const key = owner(userId, connectionId);
  const row = await state(userId, connectionId);
  const tokens = decrypt(row?.tokens, key);
  if (!tokens?.access_token) throw new Error("请先在设置中登录 Codex");
  if (!force && tokens.expiresAt > Date.now() + 60000) return tokens;
  if (pending.has(key)) return await pending.get(key);
  const refresh = (async () => {
    const lease = crypto.randomUUID();
    const store = await collection("Codex");
    const locked = await store.updateOne(
      {
        _id: key,
        generation: row.generation,
        $or: [
          { refreshUntil: { $exists: false } },
          { refreshUntil: { $lt: Date.now() } },
        ],
      },
      { $set: { refreshUntil: Date.now() + 30000, refreshOwner: lease } },
    );
    if (!locked.matchedCount) throw new Error("Codex 授权正在刷新，请稍后重试");
    try {
      const fresh = await json(`${ISSUER}/oauth/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
          client_id: CLIENT_ID,
        }),
      });
      if (!fresh.access_token) throw new Error("Codex 授权需要重新登录");
      const updated = {
        ...tokens,
        ...fresh,
        expiresAt: Date.now() + (fresh.expires_in || 3600) * 1000,
      };
      const result = await store.updateOne(
        { _id: key, generation: row.generation, refreshOwner: lease },
        {
          $set: { tokens: encrypt(updated, key) },
          $unset: { refreshUntil: "", refreshOwner: "" },
        },
      );
      if (!result.matchedCount) throw new Error("Codex 授权状态已变化，请重试");
      return updated;
    } finally {
      await store.updateOne(
        { _id: key, refreshOwner: lease },
        { $unset: { refreshUntil: "", refreshOwner: "" } },
      );
    }
  })();
  pending.set(key, refresh);
  try {
    return await refresh;
  } finally {
    pending.delete(key);
  }
}

export function headers(tokens) {
  let account;
  try {
    account = JSON.parse(
      Buffer.from(tokens.access_token.split(".")[1], "base64url"),
    )["https://api.openai.com/auth"]?.chatgpt_account_id;
  } catch {}
  return {
    Authorization: `Bearer ${tokens.access_token}`,
    "User-Agent": "rogerleaf-personal-ai/1.0",
    ...(account ? { "ChatGPT-Account-Id": account } : {}),
  };
}
