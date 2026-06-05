import type { TranslationKeys } from '~/hooks/useLocalize';

/**
 * Classifies dynamically-fetched model IDs (e.g. from the AiTunnel custom
 * endpoint, which returns ~200 bare model-id strings) into a modality so the
 * model menu can group them. Classification is purely name-heuristic — the
 * upstream `/models` list carries no modality metadata.
 */
export type Modality = 'text' | 'image' | 'video' | 'audio' | 'embeddings' | 'rerank' | 'moderation';

/**
 * Ordered patterns, first match wins. Utility/generation modalities are checked
 * before falling back to `text`, and the more specific buckets (audio/video)
 * come before `image` so e.g. `grok-imagine-video` lands in video, not image.
 */
const MODALITY_PATTERNS: ReadonlyArray<readonly [Modality, RegExp]> = [
  ['rerank', /rerank/],
  ['embeddings', /embed/],
  ['moderation', /moderation/],
  [
    'audio',
    /(^|[-.])(tts|asr|stt)([-.]|$)|transcribe|whisper|voxtral|gpt-audio|(^|[-.])audio([-.]|$)|voice|chirp/,
  ],
  ['video', /video|imagine-video|(^|[-.])(veo|sora|kling|seedance|wan|hailuo)([-.]|$)/],
  ['image', /image|(^|[-.])(flux|seedream)([-.]|$)/],
];

export function classifyModelModality(modelId: string): Modality {
  const id = modelId.toLowerCase();
  for (const [modality, pattern] of MODALITY_PATTERNS) {
    if (pattern.test(id)) {
      return modality;
    }
  }
  return 'text';
}

/** Modalities a user can actually pick as a chat model, in display order. */
export const CHAT_MODALITIES = ['text', 'image', 'video', 'audio'] as const;
export type ChatModality = (typeof CHAT_MODALITIES)[number];

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
