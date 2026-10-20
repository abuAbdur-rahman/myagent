import { describe, expect, it } from "vitest";

import { approvalFootnote, approvalKind, approvalSubtitle, screenNote } from "./approvals";

describe("approvalKind", () => {
  it("classifies shell tools as commands", () => {
    expect(approvalKind("run_powershell")).toBe("command");
    expect(approvalKind("sandbox_run")).toBe("command");
  });

  it("classifies web tools", () => {
    expect(approvalKind("web_fetch")).toBe("web");
    expect(approvalKind("web_search")).toBe("web");
  });

  it("classifies everything else as a call", () => {
    expect(approvalKind("delete_memory")).toBe("call");
    expect(approvalKind("mcp__srv__tool")).toBe("call");
  });
});

describe("approvalSubtitle", () => {
  it("says command only for shell tools", () => {
    expect(approvalSubtitle("run_powershell")).toContain("this command");
    expect(approvalSubtitle("delete_memory")).toContain("this call");
    expect(approvalSubtitle("web_fetch")).toContain("this call");
  });
});

describe("screenNote", () => {
  it("suggests deny for a flagged verdict", () => {
    expect(
      screenNote({ label: "INJECTION", score: 0.973, suggest_deny: true }),
    ).toBe("injection 0.97 · suggest deny");
  });

  it("stays neutral when nothing was flagged", () => {
    expect(
      screenNote({ label: "SAFE", score: 0.02, suggest_deny: false }),
    ).toBe("safe 0.02 · no strong signal");
  });
});

describe("approvalFootnote", () => {
  it("keeps cwd and command wording for shell tools", () => {
    const line = approvalFootnote("run_powershell", "D:\\oss", "Get-ChildItem\nrm x");
    expect(line).toBe("in D:\\oss · Always allows these run_powershell commands · Get-ChildItem");
  });

  it("drops cwd for web tools and says every time", () => {
    const line = approvalFootnote("web_fetch", "C:\\Users\\me", "https://example.com/page");
    expect(line).toBe("Always allows web_fetch every time · https://example.com/page");
  });

  it("drops cwd for non-shell tools and says this call", () => {
    const line = approvalFootnote("delete_memory", "saved memory", "Delete memory 3f2a");
    expect(line).toBe("Always allows this delete_memory call · Delete memory 3f2a");
  });

  it("omits the trailing separator when there is no command text", () => {
    expect(approvalFootnote("web_fetch", "", "")).toBe("Always allows web_fetch every time");
  });

  it("truncates the first segment at 60 chars", () => {
    const long = "x".repeat(80);
    const line = approvalFootnote("run_powershell", "C:\\", long);
    expect(line.endsWith("· " + "x".repeat(60))).toBe(true);
  });
});
