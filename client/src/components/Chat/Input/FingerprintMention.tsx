import { useMemo, useRef, useState } from 'react';
import { useRecoilState } from 'recoil';
import { Fingerprint, X } from 'lucide-react';
import { useOnClickOutside } from '@librechat/client';
import { TYPE_LABEL_KEYS } from '~/components/Fingerprints/constants';
import { useGetFingerprintsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

/**
 * Composer affordance to explicitly attach digital fingerprints (CRM entities) to the next
 * message — an explicit override of the backend's semantic guess. Selected ids live in
 * `store.mentionedFingerprintIds`, are threaded into the submission, and reset after send.
 */
export default function FingerprintMention() {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [ids, setIds] = useRecoilState(store.mentionedFingerprintIds);
  const { data: fingerprints } = useGetFingerprintsQuery();
  const containerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(containerRef, () => setOpen(false), []);

  const entities = fingerprints ?? [];
  const selected = useMemo(() => entities.filter((e) => ids.includes(e._id)), [entities, ids]);
  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      entities.filter(
        (e) =>
          !ids.includes(e._id) &&
          (!query ||
            e.name.toLowerCase().includes(query) ||
            e.aliases.some((alias) => alias.toLowerCase().includes(query))),
      ),
    [entities, ids, query],
  );

  const toggle = (id: string) =>
    setIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));

  if (entities.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={localize('com_fp_mention_hint')}
        aria-label={localize('com_fp_mention_hint')}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-hover',
          (open || selected.length > 0) && 'text-text-primary',
        )}
      >
        <Fingerprint className="h-5 w-5" />
        {selected.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-green-600 px-1 text-[10px] font-semibold text-white">
            {selected.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-11 left-0 z-50 w-72 rounded-xl border border-border-light bg-surface-primary p-2 shadow-lg">
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={localize('com_fp_mention_search')}
            className="mb-2 w-full rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />

          {selected.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1 border-b border-border-light pb-2">
              {selected.map((entity) => (
                <span
                  key={entity._id}
                  className="flex items-center gap-1 rounded-full bg-green-600/15 px-2 py-0.5 text-xs text-text-primary"
                >
                  {entity.name}
                  <button
                    type="button"
                    onClick={() => toggle(entity._id)}
                    className="text-text-tertiary hover:text-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-1 py-2 text-xs text-text-tertiary">
                {localize('com_fp_mention_empty')}
              </p>
            ) : (
              filtered.map((entity) => (
                <button
                  key={entity._id}
                  type="button"
                  onClick={() => {
                    toggle(entity._id);
                    setSearch('');
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-hover"
                >
                  <span className="truncate">{entity.name}</span>
                  <span className="shrink-0 text-[11px] text-text-tertiary">
                    {localize(TYPE_LABEL_KEYS[entity.type] ?? TYPE_LABEL_KEYS.other)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
