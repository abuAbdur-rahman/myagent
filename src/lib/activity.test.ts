import { describe, expect, it } from "vitest";

import { activityState, pillState } from "./activity";
import type { Message } from "./types";

function message(role: Message["role"], content: string): Message {
  return { id: `${role}-1`, conversation_id: "c1", role, content, created_at: 1 };
}

describe("activityState", () => {
  it("is null when the turn is not running", () => {
    expect(activityState([message("user", "hi"), message("assistant", "there")], false)).toBeNull();
  });

  it("thinks before the reply has any text", () => {
    expect(activityState([message("user", "hi")], true)).toBe("thinking");
    expect(activityState([message("user", "hi"), message("assistant", "")], true)).toBe("thinking");
    expect(activityState([message("user", "hi"), message("assistant", "   ")], true)).toBe("thinking");
  });

  it("writes once the reply has text", () => {
    expect(activityState([message("user", "hi"), message("assistant", "once")], true)).toBe("writing");
  });

  it("thinks again while a tool runs after the prose", () => {
    expect(activityState([message("user", "hi"), message("assistant", "")], true)).toBe("thinking");
  });
});

describe("pillState", () => {
  const idle = { messages: [message("user", "hi")], streaming: false, compacting: false };

  it("is null when nothing runs and the mic is idle", () => {
    expect(pillState({ ...idle, voice: "idle" })).toBeNull();
  });

  it("puts the mic ahead of the model, because the user is holding it", () => {
    expect(pillState({ ...idle, streaming: true, voice: "recording" })).toBe("recording");
    expect(pillState({ ...idle, streaming: true, voice: "transcribing" })).toBe("transcribing");
  });

  it("beats compaction while transcribed text is on its way", () => {
    expect(pillState({ ...idle, compacting: true, voice: "transcribing" })).toBe("transcribing");
  });

  it("falls back to compaction and then to the model", () => {
    expect(pillState({ ...idle, compacting: true, voice: "idle" })).toBe("compacting");
    expect(pillState({ ...idle, streaming: true, voice: "idle" })).toBe("thinking");
  });
});
