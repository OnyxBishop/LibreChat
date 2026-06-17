import { Pencil, Sparkles, Trash2 } from 'lucide-react';
import type { TFingerprint } from 'librechat-data-provider';
import { FACT_KINDS, FACT_KIND_LABEL_KEYS, TYPE_LABEL_KEYS } from './constants';
import { useLocalize } from '~/hooks';

interface FingerprintCardProps {
  entity: TFingerprint;
  onEdit: (entity: TFingerprint) => void;
  onDelete: (entity: TFingerprint) => void;
}

export default function FingerprintCard({ entity, onEdit, onDelete }: FingerprintCardProps) {
  const localize = useLocalize();
  const typeKey = TYPE_LABEL_KEYS[entity.type] ?? TYPE_LABEL_KEYS.other;

  const factCounts = FACT_KINDS.map((kind) => ({
    kind,
    count: entity.facts.filter((fact) => fact.kind === kind).length,
  })).filter((entry) => entry.count > 0);

  const pendingCount = entity.facts.filter((fact) => fact.confirmed === false).length;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border-light bg-surface-secondary p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-text-primary" title={entity.name}>
            {entity.name}
          </span>
          {entity.aliases.length > 0 && (
            <span className="truncate text-xs text-text-tertiary">
              {entity.aliases.join(', ')}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {pendingCount > 0 && (
            <span
              className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600"
              title={localize('com_fp_fact_pending')}
            >
              <Sparkles className="h-3 w-3" />
              {pendingCount}
            </span>
          )}
          <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
            {localize(typeKey)}
          </span>
        </div>
      </div>

      {entity.summary && (
        <p className="line-clamp-2 text-xs text-text-secondary">{entity.summary}</p>
      )}

      {factCounts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {factCounts.map(({ kind, count }) => (
            <span
              key={kind}
              className="rounded-md bg-surface-tertiary px-1.5 py-0.5 text-[11px] text-text-tertiary"
            >
              {localize(FACT_KIND_LABEL_KEYS[kind])}: {count}
            </span>
          ))}
        </div>
      )}

      {entity.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entity.tags.map((tag) => (
            <span key={tag} className="rounded-md border border-border-light px-1.5 py-0.5 text-[11px] text-text-tertiary">
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-1 flex items-center justify-end gap-1">
        <button
          onClick={() => onEdit(entity)}
          title={localize('com_ui_edit')}
          className="rounded-md p-1.5 text-text-secondary hover:bg-surface-hover"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={() => onDelete(entity)}
          title={localize('com_ui_delete')}
          className="rounded-md p-1.5 text-red-500 hover:bg-surface-hover"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
