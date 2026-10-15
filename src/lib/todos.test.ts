import { describe, expect, it } from "vitest";

import { todoSchema, todoStatusSchema } from "./types";

describe("todo schema", () => {
  it("parses a valid todo row", () => {
    const parsed = todoSchema.safeParse({
      id: "t1",
      chat_id: "c1",
      text: "ship D17",
      status: "in_progress",
      position: 0,
      created_at: 1,
      updated_at: 2,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(todoStatusSchema.safeParse("doing").success).toBe(false);
    expect(todoStatusSchema.safeParse("completed").success).toBe(true);
    expect(
      todoSchema.safeParse({
        id: "t1",
        chat_id: "c1",
        text: "x",
        status: "nope",
        position: 0,
        created_at: 1,
        updated_at: 2,
      }).success,
    ).toBe(false);
  });
});
