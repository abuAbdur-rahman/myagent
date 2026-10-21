import { describe, expect, it } from "vitest";

import { activityState } from "./activity";
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
