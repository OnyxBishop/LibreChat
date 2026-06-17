import { atom } from 'recoil';

/**
 * Digital fingerprint (CRM entity) ids the user explicitly attached to the next chat
 * message via the composer. Threaded into the submission so the backend force-includes
 * those entities in the injected context (an explicit override of the semantic guess).
 * Reset after each send.
 */
const mentionedFingerprintIds = atom<string[]>({
  key: 'mentionedFingerprintIds',
  default: [],
});

export default { mentionedFingerprintIds };
