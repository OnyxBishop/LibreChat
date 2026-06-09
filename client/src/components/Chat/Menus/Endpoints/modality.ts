import { classifyModelModality, CHAT_MODALITIES } from 'librechat-data-provider';
import type { Modality, ChatModality } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';

/**
 * Re-exports the shared modality classifier (single source in `librechat-data-provider`,
 * so the model menu's grouping can't drift from the backend's generation routing) and
 * adds the frontend-only label-key mapping + grouping helper for the model menu.
 */
export { classifyModelModality, CHAT_MODALITIES };
export type { Modality, ChatModality };

const MODALITY_LABEL_KEYS: Record<ChatModality, TranslationKeys> = {
  text: 'com_ui_modality_text',
  image: 'com_ui_modality_image',
  video: 'com_ui_modality_video',
  audio: 'com_ui_modality_audio',
};

export function modalityLabelKey(modality: ChatModality): TranslationKeys {
  return MODALITY_LABEL_KEYS[modality];
}

export interface ModalityGroup {
  modality: ChatModality;
  models: Array<{ name: string; isGlobal?: boolean }>;
}

/**
 * Groups models into the chat-usable modalities (text/image/video/audio) in
 * display order, dropping utility models (embeddings/rerank/moderation) that
 * can't be used as a chat model — those are selected in their own places (e.g.
 * a reranker in the web-search settings). Returns only non-empty groups.
 */
export function groupModelsByModality(
  models: Array<{ name: string; isGlobal?: boolean }>,
): ModalityGroup[] {
  const buckets = new Map<ChatModality, Array<{ name: string; isGlobal?: boolean }>>();
  const chatModalities = CHAT_MODALITIES as ReadonlyArray<Modality>;

  for (const model of models) {
    const modality = classifyModelModality(model.name);
    if (!chatModalities.includes(modality)) {
      continue;
    }
    const bucket = buckets.get(modality as ChatModality);
    if (bucket) {
      bucket.push(model);
    } else {
      buckets.set(modality as ChatModality, [model]);
    }
  }

  return CHAT_MODALITIES.filter((modality) => buckets.has(modality)).map((modality) => ({
    modality,
    models: buckets.get(modality) as Array<{ name: string; isGlobal?: boolean }>,
  }));
}
