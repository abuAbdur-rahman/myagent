import { describe, expect, it } from "vitest";

import { pendingForConversation } from "./PendingMemoryBar";

describe("pendingForConversation", () => {
  it("keeps only the notes proposed in the open chat", () => {
    const rows = [
      { id: "a", conversation_id: "c1" },
      { id: "b", conversation_id: "c2" },
      { id: "c", conversation_id: null },
    ];
    expect(pendingForConversation(rows, "c1").map((row) => row.id)).toEqual(["a"]);
    expect(pendingForConversation(rows, null).map((row) => row.id)).toEqual(["c"]);
  });
});
