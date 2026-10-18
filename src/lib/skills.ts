import { skillRead, type SkillInfo } from "./api";

const BOUNDARY_TAG = /<\/?(?:skill_content|skill_files|file)(?=[\s\u0085/>])[^>]*>/gi;
const BOUNDARY_PREFIX = /<\/?(?:skill_content|skill_files|file)(?=[\s\u0085/]|$)/gi;
const MAX_STRIP_PASSES = 8;

function stripBoundaryPass(text: string): string {
  return text
    .replace(BOUNDARY_TAG, "")
    .replace(BOUNDARY_PREFIX, (match) => `&lt;${match.slice(1)}`);
}

function stripBoundaryTags(text: string): string {
  let current = text;
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass++) {
    const next = stripBoundaryPass(current);
    if (next === current) return current;
    current = next;
  }
  return current
    .replace(BOUNDARY_TAG, (match) => match.replace(/</g, "&lt;"))
    .replace(BOUNDARY_PREFIX, (match) => `&lt;${match.slice(1)}`);
}

export function parseSkillMentions(text: string): string[] {
  const found: string[] = [];
  const pattern = /(^|[\s(>"'])@([a-z0-9-]+)(?![$\w\p{L}\p{N}-])/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = match[2] as string;
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

export function buildSkillIndexBlock(skills: SkillInfo[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map(
    (skill) => `- ${skill.name}: ${stripBoundaryTags(skill.description.trim())}`,
  );
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
  return { content: `${blocks.join("\n\n")}\n\n${stripBoundaryTags(text)}`, unknown };
}
