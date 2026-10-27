import Mongoose from '../../../../../app/src/infrastructure/Mongoose.mjs';
import { collection } from './ProfileStore.mjs';

// Writers and permanent deletion serialize on this small project marker. It
// contains no conversation data and prevents late requests recreating records.
export async function projectWrite(projectId, work) {
  const states = await collection('ProjectState');
  await states.updateOne({ _id: projectId }, { $setOnInsert: { expired: false, revision: 0 } }, { upsert: true });
  const session = Mongoose.connection.getClient().startSession();
  try {
    return await session.withTransaction(async () => {
      const result = await states.updateOne({ _id: projectId, expired: false }, { $inc: { revision: 1 } }, { session });
      if (!result.matchedCount) throw Object.assign(new Error('项目已彻底删除'), { status: 410 });
      return await work(session);
    });
  } finally { await session.endSession(); }
}

export async function expireProject(projectId) {
  projectId = String(projectId);
  if (!/^[a-f0-9]{24}$/i.test(projectId)) throw new Error('项目编号无效');
  await (await collection('ProjectState')).updateOne({ _id: projectId }, { $set: { expired: true }, $inc: { revision: 1 } }, { upsert: true });
  // Keep attachment metadata until files are removed, so a failed purge can retry.
  const { removeProjectReferences } = await import('./References.mjs');
  await removeProjectReferences(projectId);
  for (const name of ['Sessions', 'Messages', 'Edits', 'Reviews'])
    await (await collection(name)).deleteMany({ projectId });
  await (await collection('ActiveSessions')).deleteMany({ $or: [{ projectId }, { _id: { $regex: `:${projectId}$` } }] });
}
