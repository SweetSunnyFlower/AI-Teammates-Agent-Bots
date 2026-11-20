export interface ThreadMessageLike {
  id: string;
  role: string;
  parts: Array<{ type: string; text?: string }>;
  metadata?: {
    createdAt?: string;
    divider?: boolean;
  };
}

/**
 * Merge a persisted server snapshot into the live chat state.
 *
 * Existing objects are kept so Streamdown and the message scroller do not remount an already
 * visible streamed reply. Messages that exist only in the client (usually a reply whose stream
 * ended just before its database insert) stay at the end until the next persisted snapshot
 * contains them.
 */
export function mergeThreadMessages<T extends ThreadMessageLike>(current: T[], incoming: T[]): T[] {
  const existing = new Map(current.map((message) => [message.id, message]));
  const persistedIds = new Set(incoming.map((message) => message.id));
  const merged = incoming.map((message) => existing.get(message.id) ?? message);
  const localOnly = current.filter((message) => !persistedIds.has(message.id));
  return [...merged, ...localOnly];
}
