import { atom } from 'recoil';
import { atomWithLocalStorage } from '~/store/utils';

/** A transcribed segment of speech shown in the conference transcript. */
export interface ConferenceSegment {
  id: string;
  text: string;
  timestamp: string;
}

/** A suggestion streamed from the assistant. */
export interface ConferenceSuggestion {
  id: string;
  text: string;
  pending: boolean;
}

/** Persisted settings — survive reloads. */
const conferenceGlobalContext = atomWithLocalStorage('conf:globalContext', '');
const conferenceSttPrompt = atomWithLocalStorage('conf:sttPrompt', '');
const conferenceAutoSend = atomWithLocalStorage('conf:autoSend', false);
const conferenceModel = atomWithLocalStorage('conf:model', '');
const conferenceUseRag = atomWithLocalStorage('conf:useRag', false);
const conferenceFileIds = atomWithLocalStorage<string[]>('conf:fileIds', []);

/** In-memory session state — persists across sidebar navigation, not across reloads. */
const conferenceSystemSegments = atom<ConferenceSegment[]>({
  key: 'conferenceSystemSegments',
  default: [],
});
const conferenceMicSegments = atom<ConferenceSegment[]>({
  key: 'conferenceMicSegments',
  default: [],
});
const conferenceSuggestions = atom<ConferenceSuggestion[]>({
  key: 'conferenceSuggestions',
  default: [],
});

export default {
  conferenceGlobalContext,
  conferenceSttPrompt,
  conferenceAutoSend,
  conferenceModel,
  conferenceUseRag,
  conferenceFileIds,
  conferenceSystemSegments,
  conferenceMicSegments,
  conferenceSuggestions,
};
