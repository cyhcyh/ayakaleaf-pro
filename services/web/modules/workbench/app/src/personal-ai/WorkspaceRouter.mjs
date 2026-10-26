import { z } from 'zod';
import AuthorizationManager from '../../../../../app/src/Features/Authorization/AuthorizationManager.mjs';
import * as sessions from './Sessions.mjs';
import * as edits from './Edits.mjs';
import { stopReview } from './Review.mjs';
import { workspaceIndexes } from './WorkspaceIndexes.mjs';

const uuid = z.string().uuid();
export function applyWorkspaceRoutes({ get, post, user, projectAccess }) {
  const project = async (req, write = false) => {
    const projectId = req.query.projectId || req.body?.projectId;
    await projectAccess(req, projectId);
    await workspaceIndexes();
    if (write && !await AuthorizationManager.promises.canUserWriteProjectContent(user(req), projectId))
      throw Object.assign(new Error('只有可编辑项目正文的用户可以应用或撤销修改'), { status: 403 });
    return projectId;
  };
  get('/sessions', async req => await sessions.listSessions(user(req), await project(req), z.string().max(100).optional().parse(req.query.q), z.string().max(500).optional().parse(req.query.cursor)));
  post('/sessions', async req => await sessions.createSession(user(req), await project(req)));
  get('/sessions/current', async req => {
    const projectId = await project(req);
    const result = await sessions.currentSession(user(req), projectId);
    await stopReview(user(req), projectId, result.id);
    return result;
  });
  get('/sessions/:id', async req => {
    const projectId = await project(req), id = uuid.parse(req.params.id);
    const result = await sessions.loadSession(user(req), projectId, id);
    await stopReview(user(req), projectId, id);
    return result;
  });
  post('/sessions/:id/save', async req => await sessions.saveSession(user(req), await project(req), uuid.parse(req.params.id), req.body));
  post('/sessions/:id/rename', async req => await sessions.renameSession(user(req), await project(req), uuid.parse(req.params.id), req.body.title));
  post('/sessions/delete', async req => await sessions.deleteSessions(user(req), await project(req), req.body.ids));
  get('/edits', async req => ({ items: await edits.listEdits(user(req), await project(req)) }));
  get('/edits/:id', async req => await edits.loadEdit(user(req), await project(req), uuid.parse(req.params.id)));
  post('/edits', async req => await edits.proposeEdit(user(req), await project(req), req.body));
  post('/edits/:id/begin', async req => await edits.beginEdit(user(req), await project(req, true), uuid.parse(req.params.id), req.body));
  post('/edits/:id/reconcile', async req => await edits.reconcileEdit(user(req), await project(req, true), uuid.parse(req.params.id), uuid.parse(req.body.operationId)));
}
