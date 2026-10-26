import { collection } from './ProfileStore.mjs';
let ready;
export function workspaceIndexes() {
  ready ||= (async () => {
    const sessions = await collection('Sessions'), messages = await collection('Messages'), edits = await collection('Edits');
    await Promise.all([
      sessions.createIndex({ userId: 1, projectId: 1, deleted: 1, updatedAt: -1, _id: -1 }),
      messages.createIndex({ sessionId: 1, userId: 1, projectId: 1, order: 1 }),
      edits.createIndex({ userId: 1, projectId: 1, createdAt: -1 }),
      edits.createIndex({ id: 1 }, { unique: true }),
    ]);
  })().catch(error => { ready = undefined; throw error });
  return ready;
}
