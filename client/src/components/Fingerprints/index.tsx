import { useMemo, useState } from 'react';
import { Fingerprint, Plus, Search } from 'lucide-react';
import { Spinner } from '@librechat/client';
import type { TFingerprint } from 'librechat-data-provider';
import { useGetFingerprintsQuery, useDeleteFingerprintMutation } from '~/data-provider';
import { FINGERPRINT_TYPES, TYPE_LABEL_KEYS } from './constants';
import FingerprintDialog from './FingerprintDialog';
import FingerprintCard from './FingerprintCard';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const FILTERS = ['all', ...FINGERPRINT_TYPES] as const;

export default function Fingerprints() {
  const localize = useLocalize();
  const { data: entities, isLoading } = useGetFingerprintsQuery();
  const deleteMutation = useDeleteFingerprintMutation();

  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TFingerprint | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (entities ?? []).filter((entity) => {
      if (typeFilter !== 'all' && entity.type !== typeFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [entity.name, entity.summary, ...entity.aliases, ...entity.tags]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [entities, typeFilter, search]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (entity: TFingerprint) => {
    setEditing(entity);
    setDialogOpen(true);
  };

  const handleDelete = (entity: TFingerprint) => {
    if (window.confirm(localize('com_fp_delete_confirm', { name: entity.name }))) {
      deleteMutation.mutate(entity._id);
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-surface-primary">
      {/* header */}
      <header className="flex items-center justify-between border-b border-border-light px-4 py-3">
        <div className="flex flex-col">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Fingerprint className="h-5 w-5" />
            {localize('com_fp_title')}
          </h1>
          <span className="text-xs text-text-tertiary">{localize('com_fp_subtitle')}</span>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" />
          {localize('com_fp_create')}
        </button>
      </header>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-light px-4 py-2">
        {FILTERS.map((filter) => (
          <button
            key={filter}
            onClick={() => setTypeFilter(filter)}
            className={cn(
              'rounded-full px-3 py-1 text-xs',
              typeFilter === filter
                ? 'bg-surface-tertiary text-text-primary'
                : 'text-text-secondary hover:bg-surface-hover',
            )}
          >
            {filter === 'all' ? localize('com_fp_filter_all') : localize(TYPE_LABEL_KEYS[filter])}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={localize('com_fp_search_ph')}
            className="w-56 rounded-md border border-border-light bg-surface-primary py-1.5 pl-8 pr-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-heavy focus:outline-none"
          />
        </div>
      </div>

      {/* content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-text-tertiary">{localize('com_fp_empty')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((entity) => (
              <FingerprintCard
                key={entity._id}
                entity={entity}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      <FingerprintDialog open={dialogOpen} setOpen={setDialogOpen} entity={editing} />
    </div>
  );
}
