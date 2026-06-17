import { Check, Plus, Sparkles, X } from 'lucide-react';
import type { TFingerprintFact } from 'librechat-data-provider';
import { FACT_KINDS, FACT_KIND_LABEL_KEYS, type FactKind } from './constants';
import { useLocalize } from '~/hooks';

interface FactsEditorProps {
  facts: TFingerprintFact[];
  onChange: (facts: TFingerprintFact[]) => void;
}

const inputClass =
  'w-full rounded-md border border-border-light bg-surface-primary px-2 py-1 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-heavy focus:outline-none';

export default function FactsEditor({ facts, onChange }: FactsEditorProps) {
  const localize = useLocalize();

  const updateFact = (index: number, patch: Partial<TFingerprintFact>) => {
    onChange(facts.map((fact, i) => (i === index ? { ...fact, ...patch } : fact)));
  };

  const removeFact = (index: number) => {
    onChange(facts.filter((_, i) => i !== index));
  };

  const addFact = (kind: FactKind) => {
    onChange([...facts, { kind, text: '', confirmed: true }]);
  };

  return (
    <div className="flex flex-col gap-4">
      {FACT_KINDS.map((kind) => {
        const owe = kind === 'they_owe_us' || kind === 'we_owe_them';
        const rows = facts
          .map((fact, index) => ({ fact, index }))
          .filter((row) => row.fact.kind === kind);

        return (
          <div key={kind} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {localize(FACT_KIND_LABEL_KEYS[kind])}
              </h4>
              <button
                type="button"
                onClick={() => addFact(kind)}
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-text-secondary hover:bg-surface-hover"
              >
                <Plus className="h-3.5 w-3.5" />
                {localize('com_ui_add')}
              </button>
            </div>

            {rows.length === 0 ? (
              <p className="text-xs text-text-tertiary">{localize('com_fp_facts_empty')}</p>
            ) : (
              rows.map(({ fact, index }) => {
                const pending = fact.confirmed === false;
                return (
                <div
                  key={index}
                  className={`flex flex-col gap-1 rounded-md border p-2 ${
                    pending ? 'border-amber-500/60 bg-amber-500/5' : 'border-border-light'
                  }`}
                >
                  {pending && (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
                        <Sparkles className="h-3 w-3" />
                        {localize('com_fp_fact_pending')}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateFact(index, { confirmed: true })}
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-green-600 hover:bg-surface-hover"
                      >
                        <Check className="h-3 w-3" />
                        {localize('com_fp_fact_confirm')}
                      </button>
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    {kind === 'attribute' && (
                      <input
                        value={fact.label ?? ''}
                        onChange={(e) => updateFact(index, { label: e.target.value })}
                        placeholder={localize('com_fp_fact_label_ph')}
                        className={`${inputClass} max-w-[33%]`}
                      />
                    )}
                    <input
                      value={fact.text}
                      onChange={(e) => updateFact(index, { text: e.target.value })}
                      placeholder={localize('com_fp_fact_text_ph')}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => removeFact(index)}
                      title={localize('com_ui_delete')}
                      className="rounded-md p-1 text-text-tertiary hover:bg-surface-hover hover:text-red-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {owe && (
                    <div className="flex items-center gap-2">
                      <input
                        value={fact.status ?? ''}
                        onChange={(e) => updateFact(index, { status: e.target.value })}
                        placeholder={localize('com_fp_fact_status')}
                        className={`${inputClass} max-w-[50%]`}
                      />
                      <input
                        type="date"
                        value={fact.dueDate ? fact.dueDate.slice(0, 10) : ''}
                        onChange={(e) =>
                          updateFact(index, { dueDate: e.target.value || undefined })
                        }
                        title={localize('com_fp_fact_due')}
                        className={`${inputClass} max-w-[50%]`}
                      />
                    </div>
                  )}
                </div>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}
