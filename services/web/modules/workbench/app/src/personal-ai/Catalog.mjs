import { collection, getConnection } from './ProfileStore.mjs';
import { credentials, headers } from './Codex.mjs';
import { modelMetadata } from './ModelCapabilities.mjs';

export async function getCapabilities(userId, connection, model) {
  const cached = await (await collection('Catalogs')).findOne({ userId: String(userId), connectionId: connection.id,
    baseURL: connection.baseURL, credentialRevision: connection.credentialRevision });
  return cached?.models.find(item => item.id === model) || modelMetadata({ id: model });
}

export async function updateCatalog(userId, connectionId) {
  const connection = await getConnection(userId, connectionId);
  if (connection.kind === 'google') return { models: [] };
  const auth = connection.kind === 'codex' ? headers(await credentials(userId, connection.id)) : { Authorization: `Bearer ${connection.apiKey}` };
  const suffix = connection.kind === 'codex' ? '/models?client_version=0.160.0' : '/models';
  const response = await fetch(connection.baseURL + suffix, { headers: auth, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`模型目录返回 HTTP ${response.status}；可以手动填写模型 ID`);
  const data = await response.json();
  const models = (data.data || data.models || []).slice(0, 3000).map(modelMetadata).filter(Boolean);
  const live = await getConnection(userId, connectionId);
  if (live.baseURL !== connection.baseURL || live.credentialRevision !== connection.credentialRevision) throw new Error('连接已更新，请重新获取模型');
  const catalog = { userId: String(userId), connectionId, baseURL: connection.baseURL,
    credentialRevision: connection.credentialRevision, models, updatedAt: new Date().toISOString() };
  await (await collection('Catalogs')).updateOne({ _id: `${userId}:${connectionId}` }, { $set: catalog }, { upsert: true });
  return { models, updatedAt: catalog.updatedAt };
}
