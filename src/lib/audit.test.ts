import { describe, expect, it } from "vitest";

import {
  auditCounts,
  auditCsv,
  auditDuration,
  auditJson,
  auditSummary,
  auditTools,
  decisionClass,
  filterAudit,
  groupAuditByDay,
} from "./audit";
import type { AuditLog } from "./types";

function row(id: string, ts: number, tool: string, decision: string, detail = ""): AuditLog {
  return { id, ts, conversation_id: "c1", tool, decision, detail };
}

const NOW = new Date("2026-10-21T12:00:00");
const TODAY = NOW.getTime();
const YESTERDAY = new Date("2026-10-20T09:00:00").getTime();
const OLDER = new Date("2026-10-18T09:00:00").getTime();

describe("decisionClass", () => {
  it("maps the three real decisions and leaves the rest alone", () => {
    expect(decisionClass("allow")).toBe("allow");
    expect(decisionClass("ask")).toBe("ask");
    expect(decisionClass("deny")).toBe("deny");
    expect(decisionClass("check(error)")).toBe("other");
    expect(decisionClass("deleted")).toBe("other");
  });

  it("ignores case and surrounding space", () => {
    expect(decisionClass(" Allow ")).toBe("allow");
  });
});

describe("auditCounts", () => {
  it("counts each class and the total", () => {
    const rows = [
      row("1", TODAY, "web_fetch", "allow"),
      row("2", TODAY, "run_powershell", "ask"),
      row("3", TODAY, "run_powershell", "deny"),
      row("4", TODAY, "sandbox_run", "check(error)"),
    ];
    expect(auditCounts(rows)).toEqual({ total: 4, allow: 1, ask: 1, deny: 1, other: 1 });
  });

  it("reads well in a summary line", () => {
    expect(auditSummary({ total: 3, allow: 2, ask: 0, deny: 1, other: 0 })).toBe(
      "3 decisions · 2 allowed · 1 denied",
    );
    expect(auditSummary({ total: 0, allow: 0, ask: 0, deny: 0, other: 0 })).toBe("No decisions");
  });
});

describe("auditTools", () => {
  it("counts and sorts by use, then name", () => {
    const rows = [
      row("1", TODAY, "web_fetch", "allow"),
      row("2", TODAY, "run_powershell", "ask"),
      row("3", TODAY, "run_powershell", "deny"),
      row("4", TODAY, "browser", "allow"),
    ];
    expect(auditTools(rows)).toEqual([
      { name: "run_powershell", count: 2 },
      { name: "browser", count: 1 },
      { name: "web_fetch", count: 1 },
    ]);
  });
});

describe("filterAudit", () => {
  const rows = [
    row("1", TODAY, "web_fetch", "allow"),
    row("2", TODAY, "run_powershell", "ask"),
    row("3", TODAY, "run_powershell", "deny"),
  ];

  it("keeps everything when the filters are open", () => {
    expect(filterAudit(rows, "all", null)).toHaveLength(3);
  });

  it("narrows by decision", () => {
    expect(filterAudit(rows, "deny", null).map((item) => item.id)).toEqual(["3"]);
  });

  it("narrows by tool and combines with the decision", () => {
    expect(filterAudit(rows, "all", "run_powershell").map((item) => item.id)).toEqual(["2", "3"]);
    expect(filterAudit(rows, "ask", "run_powershell").map((item) => item.id)).toEqual(["2"]);
  });
});

describe("groupAuditByDay", () => {
  it("labels today and yesterday, and groups in the given order", () => {
    const groups = groupAuditByDay(
      [
        row("1", TODAY, "web_fetch", "allow"),
        row("2", TODAY - 60_000, "browser", "allow"),
        row("3", YESTERDAY, "run_powershell", "deny"),
        row("4", OLDER, "web_fetch", "ask"),
      ],
      NOW,
    );
    expect(groups.map((group) => group.label)).toEqual([
      "Today",
      "Yesterday",
      expect.not.stringMatching(/Today|Yesterday/),
    ]);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[1].rows).toHaveLength(1);
    expect(groups[2].rows).toHaveLength(1);
  });

  it("splits two rows on the same day into one group", () => {
    const groups = groupAuditByDay([row("1", TODAY, "a", "allow"), row("2", TODAY, "b", "ask")], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("has no groups without rows", () => {
    expect(groupAuditByDay([], NOW)).toEqual([]);
  });
});

describe("auditCsv", () => {
  it("writes a header even with no rows", () => {
    expect(auditCsv([])).toBe(
      "time,tool,decision,source,conversation,duration_ms,exit_code,detail",
    );
  });

  it("quotes commas, quotes and newlines", () => {
    const csv = auditCsv([
      row("1", TODAY, "web_fetch", "allow", 'a, b "c"\nd'),
      row("2", TODAY, "browser", "deny"),
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("time,tool,decision,source,conversation,duration_ms,exit_code,detail");
    expect(csv).toContain('"a, b ""c""\nd"');
    expect(lines[lines.length - 1]).toBe(`${new Date(TODAY).toISOString()},browser,deny,,c1,,,`);
  });

  it("carries the audit detail columns", () => {
    const csv = auditCsv([
      { ...row("1", TODAY, "sandbox_run", "allow", "run"), source: "sandbox", duration_ms: 1250, exit_code: 2 },
    ]);
    expect(csv.split("\n")[1]).toBe(
      `${new Date(TODAY).toISOString()},sandbox_run,allow,sandbox,c1,1250,2,run`,
    );
  });
});

describe("auditJson", () => {
  it("uses readable keys and ISO time", () => {
    const parsed: unknown = JSON.parse(auditJson([row("1", TODAY, "web_fetch", "allow", "why")]));
    expect(parsed).toEqual([
      {
        time: new Date(TODAY).toISOString(),
        tool: "web_fetch",
        decision: "allow",
        source: null,
        conversation: "c1",
        duration_ms: null,
        exit_code: null,
        detail: "why",
      },
    ]);
  });

  it("writes an empty list for no rows", () => {
    expect(auditJson([])).toBe("[]");
  });
});

describe("auditDuration", () => {
  it("formats milliseconds and seconds and leaves missing values blank", () => {
    expect(auditDuration(250)).toBe("250 ms");
    expect(auditDuration(1250)).toBe("1.3 s");
    expect(auditDuration(null)).toBeNull();
    expect(auditDuration(undefined)).toBeNull();
  });
});
