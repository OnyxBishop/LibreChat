import { useEffect, useRef } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import {
  useCreateConferenceSessionMutation,
  useUpdateConferenceSessionMutation,
} from '~/data-provider';
import type { TCreateConferenceSession } from 'librechat-data-provider';
import store from '~/store';

/** Wait this long after the last transcript change before persisting. */
const AUTOSAVE_DEBOUNCE_MS = 2500;
/** Number of leading words of the first system line used as a default title. */
const TITLE_WORDS = 6;

interface UseConferenceAutosaveParams {
  /** Localized fallback used when the transcript has no usable text yet. */
  untitledLabel: string;
}

/**
 * Autosaves the live conference transcript (system + mic + suggestions) to the server.
 * Creates a session on first non-empty content, then debounced-updates the same session.
 * The session id lives in an in-memory atom; `Clear` resets it so the next content starts fresh.
 */
export default function useConferenceAutosave({ untitledLabel }: UseConferenceAutosaveParams): void {
  const systemSegments = useRecoilValue(store.conferenceSystemSegments);
  const micSegments = useRecoilValue(store.conferenceMicSegments);
  const suggestions = useRecoilValue(store.conferenceSuggestions);
  const [sessionId, setSessionId] = useRecoilState(store.conferenceCurrentSessionId);

  const createMutation = useCreateConferenceSessionMutation();
  const updateMutation = useUpdateConferenceSessionMutation();

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const creatingRef = useRef(false);
  const lastSavedRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const payload: Required<Omit<TCreateConferenceSession, 'title'>> = {
      systemSegments: systemSegments
        .filter((segment) => segment.text.trim())
        .map((segment) => ({ text: segment.text, timestamp: segment.timestamp })),
      micSegments: micSegments
        .filter((segment) => segment.text.trim())
        .map((segment) => ({ text: segment.text, timestamp: segment.timestamp })),
      suggestions: suggestions
        .filter((suggestion) => suggestion.text.trim())
        .map((suggestion) => ({ text: suggestion.text })),
    };

    const isEmpty =
      payload.systemSegments.length === 0 &&
      payload.micSegments.length === 0 &&
      payload.suggestions.length === 0;
    if (isEmpty) {
      return;
    }

    const serialized = JSON.stringify(payload);
    if (serialized === lastSavedRef.current) {
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      if (creatingRef.current) {
        return;
      }
      lastSavedRef.current = serialized;
      const currentId = sessionIdRef.current;
      if (currentId) {
        updateMutation.mutate({ id: currentId, data: payload });
        return;
      }
      const firstLine = payload.systemSegments[0]?.text ?? '';
      const title =
        firstLine.trim().split(/\s+/).slice(0, TITLE_WORDS).join(' ') ||
        `${untitledLabel} ${new Date().toLocaleString()}`;
      creatingRef.current = true;
      createMutation.mutate(
        { title, ...payload },
        {
          onSuccess: (session) => setSessionId(session._id),
          onSettled: () => {
            creatingRef.current = false;
          },
        },
      );
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemSegments, micSegments, suggestions, untitledLabel]);

  /** When the session id is cleared (Clear button / reload), forget the last-saved snapshot. */
  useEffect(() => {
    if (sessionId == null) {
      lastSavedRef.current = '';
    }
  }, [sessionId]);
}
