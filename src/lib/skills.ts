import { skillRead, type SkillInfo } from "./api";

const BOUNDARY_TAGS = /<\/?(?:skill_content|skill_files|file)>/gi;

export function parseSkillMentions(text: string): string[] {
  const found: string[] = [];
  const pattern = /(^|[\s(>"'])@([a-z0-9-]+)(?![A-Za-z0-9_-])/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = match[2] as string;
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

export function buildSkillIndexBlock(skills: SkillInfo[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((skill) => `- ${skill.name}: ${skill.description}`);
  return `## Available skills\nCall the skill tool with the ID to load its instructions.\n${lines.join("\n")}`;
}

export interface ResolvedMentions {
  content: string;
  unknown: string[];
}

export async function resolveSkillMentions(
  text: string,
  index: SkillInfo[],
): Promise<ResolvedMentions> {
  const mentions = parseSkillMentions(text);
  if (mentions.length === 0) return { content: text, unknown: [] };
  const known = new Map(index.map((skill) => [skill.name, skill]));
  const unknown = mentions.filter((name) => !known.has(name));
  const blocks: string[] = [];
  for (const name of mentions) {
    const skill = known.get(name);
    if (!skill) continue;
    try {
      blocks.push(await skillRead(skill.id));
    } catch {
      unknown.push(name);
    }
  }
  if (blocks.length === 0) return { content: text, unknown };
  return { content: `${blocks.join("\n\n")}\n\n${text.replace(BOUNDARY_TAGS, "")}`, unknown };
}
