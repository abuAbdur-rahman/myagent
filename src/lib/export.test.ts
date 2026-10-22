import { describe, expect, it } from "vitest";

import { buildChatExport } from "./export";
import type { Conversation, Message } from "./types";
import { chatExportSchema } from "./types";

const chat: Conversation = {
  id: "c1",
  title: "Release notes",
  connection_id: "conn",
  project_id: null,
  pinned: 0,
  compacted: 0,
  model: "deepseek-chat",
  summary: null,
  summary_through: null,
  system_prompt: null,
  created_at: 1,
  updated_at: 2,
};

function message(patch: Partial<Message>): Message {
  return {
    id: "m1",
    conversation_id: "c1",
    role: "assistant",
    content: "Done.",
    reasoning: null,
    thinking_ms: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    finish_reason: "stop",
    tool_log: null,
    artifacts: null,
    attachments: null,
    model: null,
    rating: null,
    created_at: 3,
    ...patch,
  };
}

describe("chat export", () => {
  it("carries a stored rating so a rating has a consumer", () => {
    const exported = buildChatExport(chat, [message({ id: "a", rating: 1 }), message({ id: "b", rating: -1 })]);
    expect(exported.messages.map((entry) => entry.rating)).toEqual([1, -1]);
  });

  it("exports an unrated message as null rather than omitting it", () => {
    const exported = buildChatExport(chat, [message({})]);
    expect(exported.messages[0].rating).toBeNull();
  });

  it("round-trips through the export schema with ratings present", () => {
    const exported = buildChatExport(chat, [message({ rating: 1 })]);
    const parsed = chatExportSchema.parse(exported);
    expect(parsed.messages[0].rating).toBe(1);
  });
});
