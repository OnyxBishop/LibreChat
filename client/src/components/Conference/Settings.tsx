import { useRecoilState } from 'recoil';
import { useLocalize } from '~/hooks';
import store from '~/store';

const STT_PROMPT_MAX = 300;

interface ConferenceFile {
  file_id: string;
  filename: string;
}

interface ConferenceSettingsProps {
  /** LLM models available for the resolved (custom) endpoint. */
  models: string[];
  /** Embedded (RAG-eligible) files the user can search. */
  files: ConferenceFile[];
}

export default function ConferenceSettings({ models, files }: ConferenceSettingsProps) {
  const localize = useLocalize();
  const [globalContext, setGlobalContext] = useRecoilState(store.conferenceGlobalContext);
  const [sttPrompt, setSttPrompt] = useRecoilState(store.conferenceSttPrompt);
  const [autoSend, setAutoSend] = useRecoilState(store.conferenceAutoSend);
  const [model, setModel] = useRecoilState(store.conferenceModel);
  const [useRag, setUseRag] = useRecoilState(store.conferenceUseRag);
  const [fileIds, setFileIds] = useRecoilState(store.conferenceFileIds);

  const toggleFile = (id: string) => {
    setFileIds((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));
  };

  return (
    <div className="flex w-80 flex-shrink-0 flex-col gap-4 overflow-y-auto border-l border-border-light bg-surface-primary-alt p-4">
      <h2 className="text-sm font-semibold text-text-primary">{localize('com_conf_settings')}</h2>

      {/* LLM model */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-secondary">
          {localize('com_conf_llm_model')}
        </span>
        <select
          value={model || models[0] || ''}
          onChange={(e) => setModel(e.target.value)}
          className="rounded-md border border-border-medium bg-surface-secondary p-2 text-sm text-text-primary"
        >
          {models.length === 0 && <option value="">—</option>}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      {/* Global context */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-secondary">
          {localize('com_conf_global_context')}
        </span>
        <textarea
          value={globalContext}
          onChange={(e) => setGlobalContext(e.target.value)}
          placeholder={localize('com_conf_global_context_ph')}
          rows={4}
          className="resize-y rounded-md border border-border-medium bg-surface-secondary p-2 text-sm text-text-primary"
        />
      </label>

      {/* STT mini-prompt */}
      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between text-xs font-medium text-text-secondary">
          {localize('com_conf_stt_prompt')}
          <span className="text-text-tertiary">
            {sttPrompt.length}/{STT_PROMPT_MAX}
          </span>
        </span>
        <textarea
          value={sttPrompt}
          onChange={(e) => setSttPrompt(e.target.value.slice(0, STT_PROMPT_MAX))}
          maxLength={STT_PROMPT_MAX}
          placeholder={localize('com_conf_stt_prompt_ph')}
          rows={3}
          className="resize-y rounded-md border border-border-medium bg-surface-secondary p-2 text-sm text-text-primary"
        />
      </label>

      {/* Auto-send */}
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={autoSend}
          onChange={(e) => setAutoSend(e.target.checked)}
          className="mt-0.5"
        />
        <span className="flex flex-col">
          <span className="text-sm text-text-primary">{localize('com_conf_auto_send')}</span>
          <span className="text-xs text-text-tertiary">{localize('com_conf_auto_send_desc')}</span>
        </span>
      </label>

      {/* RAG */}
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={useRag}
          onChange={(e) => setUseRag(e.target.checked)}
          className="mt-0.5"
        />
        <span className="flex flex-col">
          <span className="text-sm text-text-primary">{localize('com_conf_rag_search')}</span>
          <span className="text-xs text-text-tertiary">{localize('com_conf_rag_desc')}</span>
        </span>
      </label>

      {useRag && (
        <div className="flex flex-col gap-1 rounded-md border border-border-light p-2">
          {files.length === 0 ? (
            <span className="text-xs text-text-tertiary">{localize('com_conf_no_files')}</span>
          ) : (
            files.map((file) => (
              <label key={file.file_id} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={fileIds.includes(file.file_id)}
                  onChange={() => toggleFile(file.file_id)}
                />
                <span className="truncate text-xs text-text-primary" title={file.filename}>
                  {file.filename}
                </span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
