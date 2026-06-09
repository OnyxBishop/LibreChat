/**
 * Shared model-modality classification.
 *
 * Custom OpenAI-compatible endpoints (e.g. AiTunnel) return a flat list of ~200
 * bare model-id strings with no modality metadata, so classification is purely
 * name-heuristic. Used by the frontend (to group the model menu by modality) and
 * by the backend (to route image/video/tts models to their generation API
 * instead of `/chat/completions`).
 */
export type Modality =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'embeddings'
  | 'rerank'
  | 'moderation';

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

/** Modalities a user can pick as a chat model in the model menu, in display order. */
export const CHAT_MODALITIES = ['text', 'image', 'video', 'audio'] as const;
export type ChatModality = (typeof CHAT_MODALITIES)[number];

/**
 * Generation kinds that must be routed to a dedicated provider API rather than
 * `/chat/completions`. `null` means "send as a normal chat completion".
 */
export type GenerationKind = 'image' | 'video' | 'tts';

/**
 * Narrow classifier for generation routing. Unlike {@link classifyModelModality}
 * (which lumps both TTS and STT into `audio` for display), this returns `tts`
 * ONLY for text-to-speech models and excludes speech-to-text (whisper/transcribe),
 * which can't be driven from a text prompt.
 */
export function classifyGenerationModality(modelId: string): GenerationKind | null {
  const modality = classifyModelModality(modelId);
  if (modality === 'image') {
    return 'image';
  }
  if (modality === 'video') {
    return 'video';
  }
  if (modality === 'audio') {
    /** TTS ids all contain `tts` (tts-1, gpt-4o-mini-tts, *-tts-*); STT ids do not. */
    const id = modelId.toLowerCase();
    if (/tts/.test(id) && !/transcribe|whisper|asr|stt/.test(id)) {
      return 'tts';
    }
  }
  return null;
}
