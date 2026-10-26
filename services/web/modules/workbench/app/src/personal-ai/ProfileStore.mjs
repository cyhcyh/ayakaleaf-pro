import crypto from "node:crypto";
import Settings from "@overleaf/settings";
import Mongoose from "../../../../../app/src/infrastructure/Mongoose.mjs";
import { emptySettings, seal, unseal, validateSettings } from "./Pure.mjs";

export async function collection(name) {
  await Mongoose.connectionPromise;
  return Mongoose.connection.collection(`personalAi${name}`);
}

const secret = () =>
  process.env.PERSONAL_AI_ENCRYPTION_KEY || Settings.security?.sessionSecret;
export const encrypt = (value, owner) => seal(value, secret(), owner);
export const decrypt = (value, owner) => unseal(value, secret(), owner);

export async function loadProfile(userId) {
  if (!userId) return emptySettings();
  return (
    (await (await collection("Profiles")).findOne({ _id: String(userId) })) ||
    emptySettings()
  );
}

export async function publicProfile(userId) {
  const profile = await loadProfile(userId);
  const auth = await (await collection("Codex"))
    .find({ userId: String(userId) })
    .toArray();
  return {
    revision: profile.revision,
    bindings: profile.bindings,
    translation: profile.translation,
    connections: profile.connections.map(({ encryptedKey, ...connection }) => {
      const state = auth.find((a) => a.connectionId === connection.id);
      return {
        ...connection,
        hasKey: Boolean(encryptedKey),
        authStatus: state?.tokens
          ? "ready"
          : state?.device
            ? "waiting"
            : "logged_out",
      };
    }),
  };
}

export async function saveProfile(userId, input) {
  const next = validateSettings(input);
  const old = await loadProfile(userId);
  const owner = String(userId);
  next.connections = next.connections.map(
    ({ apiKey, clearKey, ...connection }) => {
      const previous = old.connections.find(
        (c) => c.id === connection.id && c.kind === connection.kind,
      );
      const addressChanged =
        previous && previous.baseURL !== connection.baseURL;
      return {
        ...connection,
        encryptedKey:
          clearKey || (addressChanged && !apiKey)
            ? null
            : apiKey
              ? encrypt(apiKey, `${owner}:${connection.id}:key`)
              : previous?.encryptedKey || null,
      };
    },
  );
  const profiles = await collection("Profiles");
  const revision = crypto.randomUUID();
  if (old._id) {
    const result = await profiles.updateOne(
      { _id: owner, revision: next.revision || "" },
      { $set: { ...next, revision } },
    );
    if (!result.matchedCount)
      throw Object.assign(
        new Error("设置已在其他页面更新，请重新加载后再保存"),
        { status: 409 },
      );
  } else {
    try {
      await profiles.insertOne({ ...next, _id: owner, revision });
    } catch (error) {
      if (error.code === 11000)
        throw Object.assign(new Error("设置已更新，请重新加载"), {
          status: 409,
        });
      throw error;
    }
  }
  const retained = next.connections
    .filter((c) => c.kind === "codex")
    .map((c) => c.id);
  await (
    await collection("Codex")
  ).deleteMany({ userId: owner, connectionId: { $nin: retained } });
  return await publicProfile(owner);
}

export async function getConnection(userId, id) {
  const profile = await loadProfile(userId);
  const connection = profile.connections.find((c) => c.id === id);
  if (!connection) throw new Error("模型连接不存在");
  return {
    ...connection,
    apiKey: decrypt(connection.encryptedKey, `${userId}:${id}:key`),
  };
}
