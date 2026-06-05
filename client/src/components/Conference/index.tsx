import { useRef } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { Mic, MicOff, Radio, Send, Loader2, Trash2 } from 'lucide-react';
import type { TFile } from 'librechat-data-provider';
import type { RecorderError } from '~/hooks/Conference/useConferenceRecorder';
import useConferenceRecorder from '~/hooks/Conference/useConferenceRecorder';
import useConferenceAssist from '~/hooks/Conference/useConferenceAssist';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import { useLocalize } from '~/hooks';
import { useGetFiles } from '~/data-provider';
import ConferenceSettings from './Settings';
import { cn } from '~/utils';
import store from '~/store';

/** Keep the assistant prompt bounded regardless of meeting length. */
const TRANSCRIPT_MAX_CHARS = 8000;

function recorderErrorKey(error: RecorderError): string | null {
  switch (error) {
    case 'no_system_audio':
      return 'com_conf_err_no_system_audio';
    case 'permission_denied':
      return 'com_conf_err_permission';
    case 'unsupported':
      return 'com_conf_err_unsupported';
    default:
      return null;
  }
}

export default function Conference() {
  const localize = useLocalize();

  /* settings */
  const globalContext = useRecoilValue(store.conferenceGlobalContext);
  const sttPrompt = useRecoilValue(store.conferenceSttPrompt);
  const autoSend = useRecoilValue(store.conferenceAutoSend);
  const llmModel = useRecoilValue(store.conferenceModel);
  const useRag = useRecoilValue(store.conferenceUseRag);
  const fileIds = useRecoilValue(store.conferenceFileIds);
  const engineSTTModel = useRecoilValue(store.engineSTTModel);

  /* session state */
  const [systemSegments, setSystemSegments] = useRecoilState(store.conferenceSystemSegments);
  const [micSegments, setMicSegments] = useRecoilState(store.conferenceMicSegments);
  const [suggestions, setSuggestions] = useRecoilState(store.conferenceSuggestions);

  /* endpoint + models */
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const { data: modelsConfig } = useGetModelsQuery();
  const endpoint = conversation?.endpoint ?? Object.keys(modelsConfig ?? {})[0];
  const models = (endpoint && modelsConfig?.[endpoint]) || [];
  const effectiveModel = llmModel || conversation?.model || models[0] || '';

  /* files for RAG picker */
  const { data: filesData } = useGetFiles<TFile[]>();
  const ragFiles = (filesData ?? [])
    .filter((file) => file.embedded)
    .map((file) => ({ file_id: file.file_id, filename: file.filename }));

  const { isStreaming, requestAssist } = useConferenceAssist();

  /* refs to read the latest values inside long-lived recorder callbacks */
  const idRef = useRef(0);
  const systemSegmentsRef = useRef(systemSegments);
  systemSegmentsRef.current = systemSegments;
  const autoSendRef = useRef(autoSend);
  autoSendRef.current = autoSend;
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;
  const lastSentLenRef = useRef(0);
  const currentSuggestionRef = useRef<string | null>(null);

  const makeId = () => `c${Date.now()}-${idRef.current++}`;
  const stamp = () => new Date().toLocaleTimeString();

  const getTranscript = () =>
    systemSegmentsRef.current
      .map((segment) => segment.text)
      .join('\n')
      .slice(-TRANSCRIPT_MAX_CHARS);

  const triggerAssist = (transcript: string) => {
    if (!transcript.trim() || isStreamingRef.current || !effectiveModel) {
      return;
    }
    const id = makeId();
    currentSuggestionRef.current = id;
    lastSentLenRef.current = transcript.length;
    setSuggestions((prev) => [...prev, { id, text: '', pending: true }]);
    requestAssist(
      {
        endpoint,
        model: effectiveModel,
        globalContext,
        transcript,
        useRag,
        fileIds,
      },
      (token) =>
        setSuggestions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, text: s.text + token } : s)),
        ),
    ).finally(() => {
      setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, pending: false } : s)));
    });
  };

  /* recorders — fresh closures each render so they always see current state */
  const systemRecorder = useConferenceRecorder({
    source: 'display',
    model: engineSTTModel,
    sttPrompt,
    onSegment: (text) =>
      setSystemSegments((prev) => [...prev, { id: makeId(), text, timestamp: stamp() }]),
    onSilence: () => {
      if (!autoSendRef.current || isStreamingRef.current) {
        return;
      }
      const transcript = getTranscript();
      if (transcript.length > lastSentLenRef.current) {
        triggerAssist(transcript);
      }
    },
  });

  const micRecorder = useConferenceRecorder({
    source: 'mic',
    model: engineSTTModel,
    sttPrompt,
    onSegment: (text) =>
      setMicSegments((prev) => [...prev, { id: makeId(), text, timestamp: stamp() }]),
  });

  const handleClear = () => {
    setSystemSegments([]);
    setMicSegments([]);
    setSuggestions([]);
    lastSentLenRef.current = 0;
  };

  const systemErrorKey = recorderErrorKey(systemRecorder.error);
  const micErrorKey = recorderErrorKey(micRecorder.error);

  return (
    <div className="flex h-full w-full bg-surface-primary">
      <main className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <header className="flex items-center justify-between border-b border-border-light px-4 py-3">
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold text-text-primary">
              {localize('com_nav_conference')}
            </h1>
            <span className="text-xs text-text-tertiary">{localize('com_conf_subtitle')}</span>
          </div>
          <button
            onClick={handleClear}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-text-secondary hover:bg-surface-hover"
          >
            <Trash2 className="h-4 w-4" />
            {localize('com_conf_clear')}
          </button>
        </header>

        {/* transcript + suggestions */}
        <div className="flex min-h-0 flex-1">
          {/* transcript column */}
          <section className="flex min-w-0 flex-1 flex-col border-r border-border-light">
            <div className="border-b border-border-light px-4 py-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Radio className="h-4 w-4" />
                {localize('com_conf_system_audio')}
              </h2>
              <p className="text-xs text-text-tertiary">{localize('com_conf_system_audio_hint')}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
              {systemSegments.length === 0 ? (
                <p className="text-sm text-text-tertiary">{localize('com_conf_transcript_empty')}</p>
              ) : (
                systemSegments.map((segment) => (
                  <p key={segment.id} className="mb-2 text-sm text-text-primary">
                    <span className="mr-2 text-xs text-text-tertiary">{segment.timestamp}</span>
                    {segment.text}
                  </p>
                ))
              )}
            </div>
            {/* mic transcript — explicitly excluded from the assistant context */}
            <div className="max-h-48 overflow-y-auto border-t border-border-light bg-surface-secondary px-4 py-2">
              <h3 className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
                <Mic className="h-3.5 w-3.5" />
                {localize('com_conf_mic')}
                <span className="font-normal text-amber-500">
                  {localize('com_conf_mic_excluded')}
                </span>
              </h3>
              {micSegments.map((segment) => (
                <p key={segment.id} className="text-sm text-text-secondary">
                  {segment.text}
                </p>
              ))}
            </div>
          </section>

          {/* suggestions column */}
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-border-light px-4 py-2">
              <h2 className="text-sm font-semibold text-text-primary">
                {localize('com_conf_suggestions')}
              </h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
              {suggestions.length === 0 ? (
                <p className="text-sm text-text-tertiary">
                  {localize('com_conf_suggestions_empty')}
                </p>
              ) : (
                suggestions.map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className="mb-3 rounded-lg border border-border-light bg-surface-secondary p-3"
                  >
                    <MarkdownLite content={suggestion.text} codeExecution={false} />
                    {suggestion.pending && (
                      <Loader2 className="mt-1 h-4 w-4 animate-spin text-text-tertiary" />
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border-light px-4 py-3">
          <button
            onClick={() => (systemRecorder.isRecording ? systemRecorder.stop() : systemRecorder.start())}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
              systemRecorder.isRecording
                ? 'bg-red-500 text-white'
                : 'bg-surface-tertiary text-text-primary hover:bg-surface-hover',
            )}
          >
            <Radio className="h-4 w-4" />
            {systemRecorder.isRecording
              ? localize('com_conf_stop')
              : localize('com_conf_start_system')}
          </button>

          <button
            onClick={() => (micRecorder.isRecording ? micRecorder.stop() : micRecorder.start())}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
              micRecorder.isRecording
                ? 'bg-red-500 text-white'
                : 'bg-surface-tertiary text-text-primary hover:bg-surface-hover',
            )}
          >
            {micRecorder.isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {micRecorder.isRecording ? localize('com_conf_stop') : localize('com_conf_start_mic')}
          </button>

          <button
            onClick={() => triggerAssist(getTranscript())}
            disabled={isStreaming || systemSegments.length === 0 || !effectiveModel}
            className="flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {localize('com_conf_help_reply')}
          </button>

          {autoSend && (
            <span className="text-xs text-text-tertiary">{localize('com_conf_auto_send_on')}</span>
          )}

          {(systemErrorKey || micErrorKey) && (
            <span className="text-xs text-red-500">
              {localize((systemErrorKey || micErrorKey) as Parameters<typeof localize>[0])}
            </span>
          )}
        </div>
      </main>

      <ConferenceSettings models={models} files={ragFiles} />
    </div>
  );
}
