/**
 * Pure formatters that turn fingerprint entities into a compact context block for
 * injection into an LLM system prompt. Shared by the conference assistant (Phase 2)
 * and chat injection (Phase 3). No DB or network access — the caller loads the
 * entities (by id and/or via semantic search) and passes plain objects here.
 */

/** A single fact in the shape the formatter needs (structural, not the Mongoose doc). */
export interface FingerprintContextFact {
  kind: string;
  label?: string;
  text: string;
  status?: string;
  dueDate?: string;
  /** AI drafts that are not yet confirmed are excluded from the context. */
  confirmed?: boolean;
}

/** An entity in the shape the formatter needs. */
export interface FingerprintContextEntity {
  type?: string;
  name: string;
  aliases?: string[];
  summary?: string;
  facts?: FingerprintContextFact[];
  tags?: string[];
}

/** Stable English labels for fact kinds so the model reads the relationship direction
 * regardless of the UI language. */
const KIND_LABELS: Record<string, string> = {
  attribute: 'attribute',
  they_owe_us: 'they owe us',
  we_owe_them: 'we owe them',
  note: 'note',
};

/** Formats one entity into a labelled, indented block. */
function formatEntity(entity: FingerprintContextEntity): string {
  const header: string[] = [entity.name];
  if (entity.type) {
    header.push(`[${entity.type}]`);
  }
  const aliases = (entity.aliases ?? []).filter((alias) => alias && alias.trim());
  if (aliases.length > 0) {
    header.push(`(aka ${aliases.join(', ')})`);
  }

  const lines: string[] = [header.join(' ')];

  if (entity.summary && entity.summary.trim()) {
    lines.push(`  ${entity.summary.trim()}`);
  }

  const facts = (entity.facts ?? []).filter(
    (fact) => fact && fact.text && fact.text.trim() && fact.confirmed !== false,
  );
  for (const fact of facts) {
    const kind = KIND_LABELS[fact.kind] ?? fact.kind;
    const label = fact.label && fact.label.trim() ? `${fact.label.trim()}: ` : '';
    const meta: string[] = [];
    if (fact.status && fact.status.trim()) {
      meta.push(`status: ${fact.status.trim()}`);
    }
    if (fact.dueDate && String(fact.dueDate).trim()) {
      meta.push(`due ${String(fact.dueDate).trim()}`);
    }
    const suffix = meta.length > 0 ? ` [${meta.join(', ')}]` : '';
    lines.push(`  - ${kind}: ${label}${fact.text.trim()}${suffix}`);
  }

  const tags = (entity.tags ?? []).filter((tag) => tag && tag.trim());
  if (tags.length > 0) {
    lines.push(`  tags: ${tags.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Builds the multi-entity context block. Returns an empty string when there is
 * nothing usable to inject (so callers can skip the system part entirely).
 */
export function formatFingerprintContext(entities: FingerprintContextEntity[]): string {
  if (!Array.isArray(entities) || entities.length === 0) {
    return '';
  }
  const blocks = entities
    .filter((entity) => entity && entity.name && entity.name.trim())
    .map(formatEntity);
  return blocks.join('\n\n');
}
