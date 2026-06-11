import axios from 'axios';
import { logger } from '@librechat/data-schemas';

/**
 * Image generation against an OpenAI-compatible custom endpoint (e.g. AiTunnel).
 *
 * Image/video/tts models are NOT served on `/chat/completions` — they have their
 * own provider APIs. This module issues the dedicated `/images/generations` call
 * and normalizes the response to base64 so the caller can persist it via the
 * existing file pipeline (`saveBase64Image`).
 */

export interface GenerateImageParams {
  /** Custom endpoint base URL, e.g. `https://api.aitunnel.ru/v1/`. */
  baseURL: string;
  /** Resolved API key for the endpoint. */
  apiKey: string;
  /** Image model id, e.g. `gpt-image-1`. */
  model: string;
  /** Text prompt. */
  prompt: string;
  /** Number of images (clamped 1-4). */
  n?: number;
  /** Image size, e.g. `1024x1024` or `auto`. */
  size?: string;
  /** Quality hint, e.g. `low` | `medium` | `high` | `auto`. */
  quality?: string;
  /** Extra headers (env-resolved) from the endpoint config. */
  headers?: Record<string, string>;
  /** Abort signal tied to the client connection. */
  signal?: AbortSignal;
}

export interface GeneratedImage {
  /** Base64 image payload (no data-URL prefix). */
  b64: string;
  /** Output mime type, defaults to image/png. */
  mimeType: string;
}

export interface GenerateImageResult {
  images: GeneratedImage[];
  /** Provider-reported cost in rubles, when present in `usage`. */
  costRub?: number;
}

interface OpenAIImageDatum {
  b64_json?: string;
  url?: string;
}

interface OpenAIImageResponse {
  data?: OpenAIImageDatum[];
  usage?: { cost_rub?: number };
}

const DEFAULT_SIZE = '1024x1024';
const DEFAULT_QUALITY = 'low';
/** Hard ceiling on provider calls so a stalled request can never hang the chat forever. */
export const GENERATION_TIMEOUT_MS = 180_000;

function joinUrl(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

/**
 * Fetches a remote image URL and returns its base64 payload. Some image models
 * return a hosted URL instead of inline base64; the URL may require the same
 * bearer auth as the generation call.
 */
async function urlToBase64(
  url: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<GeneratedImage | null> {
  try {
    const resp = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: GENERATION_TIMEOUT_MS,
      signal,
    });
    const mimeType =
      (resp.headers['content-type'] as string | undefined)?.split(';')[0] || 'image/png';
    return { b64: Buffer.from(resp.data).toString('base64'), mimeType };
  } catch (error) {
    logger.error('[customGenerate] Failed to fetch image url:', error);
    return null;
  }
}

export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const { baseURL, apiKey, model, prompt, headers, signal } = params;
  const n = Math.min(Math.max(1, params.n ?? 1), 4);
  const size = params.size && params.size.trim() !== '' ? params.size : DEFAULT_SIZE;
  const quality = params.quality && params.quality.trim() !== '' ? params.quality : DEFAULT_QUALITY;

  const url = joinUrl(baseURL, 'images/generations');
  const resp = await axios.post<OpenAIImageResponse>(
    url,
    { model, prompt, n, size, quality },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(headers ?? {}),
      },
      timeout: GENERATION_TIMEOUT_MS,
      signal,
    },
  );

  const data = resp.data?.data ?? [];
  const images: GeneratedImage[] = [];
  for (const datum of data) {
    if (datum.b64_json) {
      images.push({ b64: datum.b64_json, mimeType: 'image/png' });
    } else if (datum.url) {
      const fetched = await urlToBase64(datum.url, apiKey, signal);
      if (fetched) {
        images.push(fetched);
      }
    }
  }

  if (images.length === 0) {
    throw new Error('No image data returned by the provider.');
  }

  return { images, costRub: resp.data?.usage?.cost_rub };
}
