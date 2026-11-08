export interface QueuedMessage<T> {
  id: string;
  conversationId: string;
  text: string;
  attachments: T[];
}

export function enqueueMessage<T>(list: QueuedMessage<T>[], item: QueuedMessage<T>): QueuedMessage<T>[] {
  return [...list, item];
}

export function removeQueuedMessage<T>(
  list: QueuedMessage<T>[],
  id: string,
): QueuedMessage<T>[] {
  return list.filter((item) => item.id !== id);
}

export function moveQueuedMessage<T>(
  list: QueuedMessage<T>[],
  id: string,
  toIndex: number,
): QueuedMessage<T>[] {
  const from = list.findIndex((item) => item.id === id);
  if (from < 0) return list;
  const bounded = Math.max(0, Math.min(list.length - 1, toIndex));
  if (from === bounded) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(bounded, 0, item);
  return next;
}

export function moveQueuedMessageToFront<T>(
  list: QueuedMessage<T>[],
  id: string,
): QueuedMessage<T>[] {
  return moveQueuedMessage(list, id, 0);
}

export function queuedFor<T>(
  list: QueuedMessage<T>[],
  conversationId: string,
): QueuedMessage<T>[] {
  return list.filter((item) => item.conversationId === conversationId);
}

export function queuePreview(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}
