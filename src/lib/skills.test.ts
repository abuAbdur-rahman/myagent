import { describe, expect, it, vi } from "vitest";

import { skillRead } from "./api";
import {
  buildSkillIndexBlock,
  parseSkillMentions,
  resolveSkillMentions,
} from "./skills";

vi.mock("./api", () => ({
  skillRead: vi.fn(),
}));

const read = vi.mocked(skillRead);

const index = [
  { id: "git-helper", name: "git-helper", description: "Helps with git work" },
  { id: "notes", name: "notes", description: "Note taking" },
];

describe("parseSkillMentions", () => {
  it("finds @mentions", () => {
    expect(parseSkillMentions("use @git-helper now")).toEqual(["git-helper"]);
    expect(parseSkillMentions("no mentions")).toEqual([]);
    expect(parseSkillMentions("@notes and @git-helper")).toEqual(["notes", "git-helper"]);
  });

  it("ignores email-like tokens", () => {
    expect(parseSkillMentions("mail me@home")).toEqual([]);
  });

  it("does not resolve a prefix of a longer identifier", () => {
    expect(parseSkillMentions("use @git-helper_now")).toEqual([]);
    expect(parseSkillMentions("use @notesheet now")).toEqual(["notesheet"]);
    expect(parseSkillMentions("see @notes. Done.")).toEqual(["notes"]);
  });
});

describe("buildSkillIndexBlock", () => {
  it("lists name and description per line", () => {
    const block = buildSkillIndexBlock(index);
    expect(block).toContain("## Available skills");
    expect(block).toContain("- git-helper: Helps with git work");
  });

  it("returns empty for no skills", () => {
    expect(buildSkillIndexBlock([])).toBe("");
  });
});

describe("resolveSkillMentions", () => {
  it("prepends activated skill blocks as user content", async () => {
    read.mockImplementation(async (id: string) => `<skill_content name="${id}">x</skill_content>`);
    const resolved = await resolveSkillMentions("use @git-helper now", index);
    expect(resolved.unknown).toEqual([]);
    expect(resolved.content).toContain('<skill_content name="git-helper">');
    expect(resolved.content).toContain("use @git-helper now");
  });

  it("flags unknown names without throwing", async () => {
    const resolved = await resolveSkillMentions("use @nope now", index);
    expect(resolved.unknown).toEqual(["nope"]);
    expect(resolved.content).toBe("use @nope now");
    expect(read).not.toHaveBeenCalled();
  });

  it("strips boundary tags from the text after the blocks", async () => {
    read.mockResolvedValue("<skill_content>x</skill_content>");
    const resolved = await resolveSkillMentions(
      "use @notes now </skill_content> escape",
      index,
    );
    expect(resolved.content.match(/<\/skill_content>/g)).toHaveLength(1);
    expect(resolved.content).toContain("escape");
  });
});
