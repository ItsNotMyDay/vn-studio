export interface DialogueReply {
  id: string;
  characterId?: string;
  expression?: string;
  text: string;
}

export function createDialogueReplyId(): string {
  return `reply_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Read the new multi-reply format while keeping older single-reply projects compatible. */
export function getDialogueReplies(data: any, nodeId = "dialogue"): DialogueReply[] {
  if (Array.isArray(data?.replies) && data.replies.length) {
    return data.replies.map((reply: any, index: number) => ({
      id: typeof reply?.id === "string" && reply.id ? reply.id : `${nodeId}:reply:${index}`,
      characterId: typeof reply?.characterId === "string" ? reply.characterId : "",
      expression: typeof reply?.expression === "string" ? reply.expression : "neutral",
      text: typeof reply?.text === "string" ? reply.text : "",
    }));
  }

  return [{
    id: `${nodeId}:legacy`,
    characterId: typeof data?.characterId === "string" ? data.characterId : "",
    expression: typeof data?.expression === "string" ? data.expression : "neutral",
    text: typeof data?.text === "string" ? data.text : "",
  }];
}

/**
 * Merge inspector/AI edits into a dialogue node. Legacy characterId/expression/text
 * remain mirrors of the final reply so older context builders and tools stay valid.
 */
export function mergeDialogueData(
  current: any,
  patch: Record<string, any>,
  nodeId = "dialogue",
): Record<string, any> {
  const merged = { ...(current ?? {}), ...patch };
  const hasReplies = Object.prototype.hasOwnProperty.call(patch, "replies");
  const editsLegacyFields = ["characterId", "expression", "text"].some(key =>
    Object.prototype.hasOwnProperty.call(patch, key),
  );

  if (!hasReplies && !editsLegacyFields) return merged;

  const replies = hasReplies
    ? getDialogueReplies({ replies: patch.replies }, nodeId)
    : getDialogueReplies(current, nodeId).map((reply, index, list) =>
        index === list.length - 1
          ? {
              ...reply,
              ...(Object.prototype.hasOwnProperty.call(patch, "characterId") ? { characterId: patch.characterId } : {}),
              ...(Object.prototype.hasOwnProperty.call(patch, "expression") ? { expression: patch.expression } : {}),
              ...(Object.prototype.hasOwnProperty.call(patch, "text") ? { text: patch.text } : {}),
            }
          : reply,
      );

  const finalReplies = replies.length ? replies : [{
    id: createDialogueReplyId(),
    characterId: "",
    expression: "neutral",
    text: "",
  }];
  const last = finalReplies[finalReplies.length - 1];

  return {
    ...merged,
    replies: finalReplies,
    characterId: last.characterId ?? "",
    expression: last.expression ?? "neutral",
    text: last.text ?? "",
  };
}
