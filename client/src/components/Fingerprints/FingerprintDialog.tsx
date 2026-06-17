import { useEffect, useState } from 'react';
import { OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TFingerprint, TFingerprintFact, TCreateFingerprint } from 'librechat-data-provider';
import {
  useCreateFingerprintMutation,
  useUpdateFingerprintMutation,
} from '~/data-provider';
import { FINGERPRINT_TYPES, TYPE_LABEL_KEYS } from './constants';
import FactsEditor from './FactsEditor';
import { useLocalize } from '~/hooks';

interface FingerprintDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** When present, the dialog edits this entity; otherwise it creates a new one. */
  entity?: TFingerprint | null;
  /** Default type for a new entity (e.g. 'person' when adding a meeting participant). */
  defaultType?: string;
  /** Fires with the newly created entity (create flow only) — e.g. to auto-select it. */
  onCreated?: (entity: TFingerprint) => void;
}

const inputClass =
  'w-full rounded-md border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-heavy focus:outline-none';

const labelClass = 'mb-1 block text-xs font-semibold text-text-secondary';

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function FingerprintDialog({
  open,
  setOpen,
  entity,
  defaultType = 'person',
  onCreated,
}: FingerprintDialogProps) {
  const localize = useLocalize();
  const createMutation = useCreateFingerprintMutation();
  const updateMutation = useUpdateFingerprintMutation();

  const [type, setType] = useState<string>('person');
  const [name, setName] = useState('');
  const [aliasesText, setAliasesText] = useState('');
  const [summary, setSummary] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [facts, setFacts] = useState<TFingerprintFact[]>([]);

  /* Sync form state whenever the dialog opens (create => blank, edit => entity). */
  useEffect(() => {
    if (!open) {
      return;
    }
    setType(entity?.type ?? defaultType);
    setName(entity?.name ?? '');
    setAliasesText((entity?.aliases ?? []).join(', '));
    setSummary(entity?.summary ?? '');
    setTagsText((entity?.tags ?? []).join(', '));
    setFacts(entity?.facts ?? []);
  }, [open, entity, defaultType]);

  const isSaving = createMutation.isLoading || updateMutation.isLoading;
  const canSave = name.trim().length > 0 && !isSaving;

  const handleSave = () => {
    if (!canSave) {
      return;
    }
    const payload: TCreateFingerprint = {
      type,
      name: name.trim(),
      aliases: splitList(aliasesText),
      summary: summary.trim(),
      tags: splitList(tagsText),
      facts: facts.filter((fact) => fact.text.trim().length > 0),
    };
    if (entity?._id) {
      updateMutation.mutate({ id: entity._id, data: payload }, { onSuccess: () => setOpen(false) });
    } else {
      createMutation.mutate(payload, {
        onSuccess: (created) => {
          onCreated?.(created);
          setOpen(false);
        },
      });
    }
  };

  const main = (
    <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto px-1">
      <div className="flex gap-3">
        <div className="w-1/3">
          <label className={labelClass}>{localize('com_fp_type')}</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
            {FINGERPRINT_TYPES.map((t) => (
              <option key={t} value={t}>
                {localize(TYPE_LABEL_KEYS[t])}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className={labelClass}>{localize('com_fp_name')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={localize('com_fp_name')}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>{localize('com_fp_aliases')}</label>
        <input
          value={aliasesText}
          onChange={(e) => setAliasesText(e.target.value)}
          placeholder={localize('com_fp_aliases_ph')}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>{localize('com_fp_summary')}</label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={2}
          placeholder={localize('com_fp_summary_ph')}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>{localize('com_fp_facts')}</label>
        <FactsEditor facts={facts} onChange={setFacts} />
      </div>

      <div>
        <label className={labelClass}>{localize('com_fp_tags')}</label>
        <input
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder={localize('com_fp_tags_ph')}
          className={inputClass}
        />
      </div>
    </div>
  );

  const buttons = (
    <button
      type="button"
      onClick={handleSave}
      disabled={!canSave}
      className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
    >
      {localize('com_ui_save')}
    </button>
  );

  return (
    <OGDialog open={open} onOpenChange={setOpen}>
      <OGDialogTemplate
        title={entity ? localize('com_fp_edit') : localize('com_fp_create')}
        className="w-11/12 md:max-w-2xl"
        main={main}
        buttons={buttons}
        showCancelButton
      />
    </OGDialog>
  );
}
