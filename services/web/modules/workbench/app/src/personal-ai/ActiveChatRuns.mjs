const runs = new Set();

export function registerChatRun(userId, projectId, chatId, controller) {
  const run = { userId: String(userId), projectId, chatId, controller };
  runs.add(run);
  return () => runs.delete(run);
}

export function stopChatRuns(userId, projectId, ids) {
  for (const run of runs) {
    if (run.userId !== String(userId) || (projectId && run.projectId !== projectId) || (ids && !ids.includes(run.chatId))) continue;
    run.controller.abort();
    runs.delete(run);
  }
}
