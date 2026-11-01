// Keep chat requests below the default 12 MiB JSON limit, including metadata.
// This is a transport budget, independent of the model's token/context budget.
export const CHAT_REQUEST_BYTES = 10 * 1024 * 1024;
export const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;

// Tool interruption can copy a message/parts array without changing any parts.
// Compare references rather than serializing old images on every request.
export function sameSavedMessage(message, saved) {
  if (message === saved) return true;
  if (!saved) return false;
  const keys = Object.keys(message);
  return keys.length === Object.keys(saved).length && keys.every(key => key === 'parts'
    ? message.parts.length === saved.parts.length && message.parts.every((part, index) => part === saved.parts[index])
    : message[key] === saved[key]);
}

export function pendingSessionMessages(messages, saved, messageOffset) {
  let start = 0;
  // Always include the final message. A live assistant's tool state must
  // override restoredMessage's interrupted-tool normalization on the server.
  while (start < messages.length - 1 && sameSavedMessage(messages[start], saved.get(messages[start].id))) start++;
  return { messages: messages.slice(start), messageOffset: messageOffset + start };
}
