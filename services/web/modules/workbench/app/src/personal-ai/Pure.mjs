import crypto from "node:crypto";
import { z } from "zod";

export const FEATURES = ["chat", "fix", "review", "translation"];
export const selectionSchema = z.object({
  connectionId: z.string().max(80),
  model: z.string().trim().max(200),
});
export const settingsSchema = z.object({
  revision: z.string().optional(),
  connections: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
        name: z.string().trim().min(1).max(100),
        kind: z.enum(["cloud", "codex", "google"]),
        baseURL: z.string().trim().max(1000).default(""),
        apiKey: z.string().max(4000).optional(),
        clearKey: z.boolean().optional(),
      }),
    )
    .max(20),
  bindings: z.object(
    Object.fromEntries(FEATURES.map((key) => [key, selectionSchema])),
  ),
  translation: z.object({
    enabled: z.boolean(),
    provider: z.enum(["google-free", "mymemory", "google", "llm"]),
    target: z.string().regex(/^[a-zA-Z-]{2,20}$/),
    googleConnectionId: z.string().max(80).default(""),
  }),
});

export function validateSettings(input) {
  const settings = settingsSchema.parse(input);
  const ids = new Set();
  for (const connection of settings.connections) {
    if (ids.has(connection.id)) throw new Error("连接 ID 重复");
    ids.add(connection.id);
    if (connection.kind === "cloud") {
      const url = new URL(connection.baseURL);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new Error("请输入不包含密钥或查询参数的 HTTP/HTTPS API 地址");
      }
      connection.baseURL = url.href.replace(/\/$/, "");
    } else {
      connection.baseURL =
        connection.kind === "codex"
          ? "https://chatgpt.com/backend-api/codex"
          : "https://translation.googleapis.com/language/translate/v2";
    }
  }
  for (const binding of Object.values(settings.bindings)) {
    if (Boolean(binding.connectionId) !== Boolean(binding.model))
      throw new Error("连接和模型需要同时选择");
    if (
      binding.connectionId &&
      !settings.connections.some(
        (c) => c.id === binding.connectionId && c.kind !== "google",
      )
    ) {
      throw new Error("功能分配引用了不存在的模型连接");
    }
  }
  if (
    settings.translation.googleConnectionId &&
    !settings.connections.some(
      (c) =>
        c.id === settings.translation.googleConnectionId && c.kind === "google",
    )
  ) {
    throw new Error("请选择 Google Cloud 翻译连接");
  }
  return settings;
}

export function seal(value, secret, context) {
  if (!secret)
    throw new Error(
      "请先配置稳定的 OVERLEAF_SESSION_SECRET 或 PERSONAL_AI_ENCRYPTION_KEY",
    );
  const key = crypto
    .createHash("sha256")
    .update("personal-ai:v1\0")
    .update(secret)
    .digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), data]
    .map((part) => part.toString("base64"))
    .join(".");
}

export function unseal(value, secret, context) {
  if (!value) return null;
  const [iv, tag, data] = value
    .split(".")
    .map((part) => Buffer.from(part, "base64"));
  const key = crypto
    .createHash("sha256")
    .update("personal-ai:v1\0")
    .update(secret)
    .digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"),
  );
}

export { findUniqueQuote } from "../../../shared/quote-position.mjs";

export const emptySettings = () => ({
  revision: "",
  connections: [],
  bindings: Object.fromEntries(
    FEATURES.map((key) => [key, { connectionId: "", model: "" }]),
  ),
  translation: {
    enabled: true,
    provider: "google-free",
    target: "zh-CN",
    googleConnectionId: "",
  },
});
