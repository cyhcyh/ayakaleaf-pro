export function editConflict(code, message, details = {}) {
  return Object.assign(new Error(message), { status: 409, code, details });
}

export function encodeEditFailure(error) {
  return JSON.stringify({ kind: 'edit_conflict', code: error.code, message: error.message, details: error.details });
}

export function readEditFailure(text) {
  try {
    const value = JSON.parse(text);
    return value?.kind === 'edit_conflict' && typeof value.code === 'string' && typeof value.message === 'string' ? value : null;
  } catch { return null; }
}

export function createEditRetryGuard() {
  const failures = new Map();
  return {
    reset() { failures.clear(); },
    failed(input, failure) {
      if (!failure || !failure.code.startsWith('edit_')) return false;
      // Rewriting the draft cannot repair a missing or superseded ID. Reading
      // other tools between attempts must not reset this failure count.
      const idOnly = ['edit_target_not_found', 'edit_superseded', 'edit_not_pending', 'edit_in_progress'].includes(failure.code);
      const key = JSON.stringify([failure.code, input.replacesEditId || null, input.path,
        ...(!idOnly ? [input.oldText, !input.oldText ? input.startLine : null] : [])]);
      const count = (failures.get(key) || 0) + 1;
      failures.set(key, count);
      return count >= 2;
    },
  };
}
