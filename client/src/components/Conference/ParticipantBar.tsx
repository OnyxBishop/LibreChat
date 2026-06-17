import { useState } from 'react';
import { useRecoilState } from 'recoil';
import { Users, UserPlus, X } from 'lucide-react';
import type { TFingerprint } from 'librechat-data-provider';
import FingerprintDialog from '~/components/Fingerprints/FingerprintDialog';
import { useGetFingerprintsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import store from '~/store';

/** People/companies the user can mark as attending — semantic matches cover the rest. */
const PARTICIPANT_TYPES = new Set(['person', 'company']);

/**
 * Lets the user declare who is in the meeting. Selected fingerprints are sent with every
 * assist request so the model is grounded on who they owe / who owes them / key facts.
 */
export default function ParticipantBar() {
  const localize = useLocalize();
  const [participantIds, setParticipantIds] = useRecoilState(store.conferenceParticipantIds);
  const { data: fingerprints } = useGetFingerprintsQuery();
  const [dialogOpen, setDialogOpen] = useState(false);

  const people = (fingerprints ?? []).filter((entity) => PARTICIPANT_TYPES.has(entity.type));
  const selected = people.filter((entity) => participantIds.includes(entity._id));
  const available = people.filter((entity) => !participantIds.includes(entity._id));

  const add = (id: string) => {
    if (id) {
      setParticipantIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    }
  };
  const remove = (id: string) =>
    setParticipantIds((prev) => prev.filter((value) => value !== id));

  const handleCreated = (entity: TFingerprint) => add(entity._id);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-light px-4 py-2">
      <span className="flex items-center gap-1 text-xs font-semibold text-text-secondary">
        <Users className="h-3.5 w-3.5" />
        {localize('com_conf_participants')}
      </span>

      {selected.map((entity) => (
        <span
          key={entity._id}
          className="flex items-center gap-1 rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-primary"
        >
          {entity.name}
          <button
            type="button"
            onClick={() => remove(entity._id)}
            title={localize('com_ui_delete')}
            className="text-text-tertiary hover:text-red-500"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {selected.length === 0 && (
        <span className="text-xs text-text-tertiary">{localize('com_conf_participants_empty')}</span>
      )}

      {available.length > 0 && (
        <select
          value=""
          onChange={(event) => add(event.target.value)}
          className="rounded-md border border-border-light bg-surface-primary px-2 py-1 text-xs text-text-secondary focus:outline-none"
        >
          <option value="">{localize('com_conf_participants_add')}</option>
          {available.map((entity) => (
            <option key={entity._id} value={entity._id}>
              {entity.name}
            </option>
          ))}
        </select>
      )}

      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-surface-hover"
      >
        <UserPlus className="h-3.5 w-3.5" />
        {localize('com_conf_participants_new')}
      </button>

      <FingerprintDialog
        open={dialogOpen}
        setOpen={setDialogOpen}
        defaultType="person"
        onCreated={handleCreated}
      />
    </div>
  );
}
