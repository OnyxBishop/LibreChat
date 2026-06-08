export interface ParsedSkill {
  name: string;
  description: string;
  content: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

/** kebab-case slug used as a skill name when none is provided */
export function slugifySkillName(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function parseFrontmatter(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    value = value.replace(/^['"]/, '').replace(/['"]$/, '');
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Parses a full SKILL.md document into structured fields.
 * Reads `name`/`description` from optional YAML frontmatter; the remainder is the body.
 * Falls back to the first H1 heading for the name when no frontmatter name is present.
 */
export function parseSkillMarkdown(markdown: string): ParsedSkill {
  const text = markdown ?? '';
  const match = text.match(FRONTMATTER_RE);
  let name = '';
  let description = '';
  let content = text;

  if (match) {
    const fm = parseFrontmatter(match[1]);
    name = fm.name ?? '';
    description = fm.description ?? '';
    content = text.slice(match[0].length);
  }

  if (!name) {
    const h1 = content.match(/^\s*#\s+(.+)$/m);
    if (h1) {
      name = slugifySkillName(h1[1]);
    }
  }

  return { name: name.trim(), description: description.trim(), content: content.trim() };
}

/** Reconstructs a full SKILL.md document (frontmatter + body) from stored fields. */
export function buildSkillMarkdown(skill: {
  name?: string;
  description?: string;
  content?: string;
}): string {
  const name = skill.name ?? '';
  const description = skill.description ?? '';
  const body = skill.content ?? '';
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

const SKILL_COLORS = [
  'bg-pink-500',
  'bg-amber-500',
  'bg-violet-500',
  'bg-indigo-500',
  'bg-cyan-500',
  'bg-red-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-fuchsia-500',
];

const SKILL_BLOCK_RE = /```skill\s*\n([\s\S]*?)```/i;

/** Extracts the contents of a ```skill fenced code block from message text, if present. */
export function extractSkillBlock(text: string): string | null {
  if (!text) {
    return null;
  }
  const match = text.match(SKILL_BLOCK_RE);
  return match ? match[1].trim() : null;
}

/** Deterministic accent color for a skill's list icon, derived from its name. */
export function skillColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return SKILL_COLORS[hash % SKILL_COLORS.length];
}
