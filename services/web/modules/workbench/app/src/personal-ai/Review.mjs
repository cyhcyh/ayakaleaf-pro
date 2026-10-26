import crypto from "node:crypto";
import { collection } from "./ProfileStore.mjs";

export async function approveReview(userId, projectId, chatId, scope, focus) {
  const reviewId = crypto.randomUUID();
  const store = await collection("Reviews");
  await store.updateMany(
    { userId: String(userId), projectId, chatId, stopped: false },
    { $set: { stopped: true } },
  );
  await store.insertOne({
    _id: reviewId,
    userId: String(userId),
    projectId,
    chatId,
    scope,
    focus,
    approvedAt: new Date(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    stopped: false,
  });
  return { reviewId, scope, approved: true };
}

export async function checkReview(
  userId,
  projectId,
  chatId,
  reviewId,
  filePath,
) {
  const review = await (
    await collection("Reviews")
  ).findOne({
    _id: reviewId,
    userId: String(userId),
    projectId,
    chatId,
    stopped: false,
    expiresAt: { $gt: new Date() },
  });
  if (!review)
    throw Object.assign(
      new Error("本轮审阅尚未确认、已停止或已过期，请先征得用户同意"),
      { status: 403 },
    );
  // '*' is explicit whole-project consent; otherwise only named files are allowed.
  if (
    filePath &&
    review.scope !== "*" &&
    !review.scope
      .split("\n")
      .map((p) => p.trim().replace(/^\/+/, ""))
      .includes(filePath.replace(/^\/+/, ""))
  ) {
    throw Object.assign(
      new Error("文件不在已确认的审阅范围内，请重新确认范围"),
      { status: 403 },
    );
  }
  return review;
}

export async function stopReview(userId, projectId, chatId) {
  await (
    await collection("Reviews")
  ).updateMany(
    { userId: String(userId), projectId, chatId },
    { $set: { stopped: true } },
  );
}
