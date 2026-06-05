import { useCallback, useRef, useState } from 'react';
import { useAuthContext } from '~/hooks/AuthContext';

interface AssistParams {
  /** Custom endpoint name; omit to let the server use the first configured custom endpoint. */
  endpoint?: string;
  model: string;
  globalContext: string;
  /** Transcript of the other participants only — never the user's own mic. */
  transcript: string;
  useRag: boolean;
  fileIds: string[];
}

interface UseConferenceAssistReturn {
  isStreaming: boolean;
  error: string | null;
  /** Streams a suggestion; `onToken` receives incremental text as it arrives. */
  requestAssist: (params: AssistParams, onToken: (token: string) => void) => Promise<void>;
  abort: () => void;
}

/**
 * Calls the stateless `/api/conference/assist` SSE endpoint and relays incremental
 * tokens. Uses fetch streaming (EventSource cannot issue POST requests).
 */
export default function useConferenceAssist(): UseConferenceAssistReturn {
  const { token } = useAuthContext();
  const abortRef = useRef<AbortController | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const requestAssist = useCallback(
    async (params: AssistParams, onToken: (token: string) => void) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setIsStreaming(true);

      try {
        const response = await fetch('/api/conference/assist', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            endpoint: params.endpoint,
            model: params.model,
            globalContext: params.globalContext,
            transcript: params.transcript,
            useRag: params.useRag,
            file_ids: params.fileIds,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          setError('request_failed');
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data:')) {
              continue;
            }
            const payload = line.slice(5).trim();
            if (!payload) {
              continue;
            }
            try {
              const event = JSON.parse(payload) as {
                token?: string;
                done?: boolean;
                error?: string;
              };
              if (event.token) {
                onToken(event.token);
              }
              if (event.error) {
                setError(event.error);
              }
            } catch {
              /* ignore non-JSON keep-alives */
            }
          }
        }
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') {
          setError('request_failed');
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [token],
  );

  return { isStreaming, error, requestAssist, abort };
}
