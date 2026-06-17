import axios from 'axios';
import { EModelEndpoint, extractEnvVariable } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { getCustomEndpointConfig } from '~/app/config';

/**
 * Embedding model used for semantic search over fingerprints.
 * MUST be a model the configured custom (OpenAI-compatible) endpoint actually serves —
 * verify on deploy. Overridable without a code change via `FINGERPRINT_EMBED_MODEL`.
 */
const DEFAULT_EMBED_MODEL = process.env.FINGERPRINT_EMBED_MODEL || 'text-embedding-3-small';

/** The embedding model currently in use (drives re-embed staleness checks). */
export function getEmbeddingModel(): string {
  return DEFAULT_EMBED_MODEL;
}

interface ResolvedEmbeddingEndpoint {
  apiKey: string;
  baseURL: string;
  model: string;
}

/** Minimal shape needed to compose the canonical embedding text. */
export interface EmbeddingTextInput {
  type?: string;
  name: string;
  aliases?: string[];
  summary?: string;
  facts?: Array<{ label?: string; text?: string; confirmed?: boolean }>;
}

/** Resolves apiKey/baseURL the same way the conference assist endpoint does. */
function resolveEmbeddingEndpoint(
  appConfig: AppConfig,
  endpointName?: string,
): ResolvedEmbeddingEndpoint {
  const endpoint = endpointName || appConfig.endpoints?.[EModelEndpoint.custom]?.[0]?.name;
  if (!endpoint) {
    throw new Error('No custom endpoint configured for embeddings.');
  }
  const endpointConfig = getCustomEndpointConfig({ endpoint, appConfig });
  if (!endpointConfig) {
    throw new Error(`Config not found for the ${endpoint} endpoint.`);
  }
  const apiKey = extractEnvVariable(endpointConfig.apiKey ?? '');
  const baseURL = extractEnvVariable(endpointConfig.baseURL ?? '');
  if (!apiKey || !baseURL) {
    throw new Error(`Missing API key or base URL for ${endpoint}.`);
  }
  return { apiKey, baseURL: baseURL.replace(/\/$/, ''), model: DEFAULT_EMBED_MODEL };
}

/** Computes an embedding vector for the given text via the custom endpoint's `/embeddings`. */
export async function embedText(
  appConfig: AppConfig,
  text: string,
  endpointName?: string,
): Promise<{ vector: number[]; model: string }> {
  const { apiKey, baseURL, model } = resolveEmbeddingEndpoint(appConfig, endpointName);
  const response = await axios.post(
    `${baseURL}/embeddings`,
    { model, input: text },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    },
  );
  const vector = (response.data as { data?: Array<{ embedding?: number[] }> })?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error('Embedding response had no vector.');
  }
  return { vector, model };
}

/**
 * The canonical text an entity is embedded from: identity + confirmed facts.
 * Unconfirmed AI-drafted facts are excluded so drafts don't pollute the vector
 * until the user confirms them.
 */
export function buildEmbeddingText(fp: EmbeddingTextInput): string {
  const parts: string[] = [
    `Type: ${fp.type ?? 'other'}`,
    `Name: ${fp.name}`,
    fp.aliases?.length ? `Aliases: ${fp.aliases.join(', ')}` : '',
    fp.summary ? `Summary: ${fp.summary}` : '',
    ...(fp.facts ?? [])
      .filter((fact) => fact.confirmed !== false)
      .map((fact) => (fact.label ? `${fact.label}: ${fact.text ?? ''}` : fact.text ?? '')),
  ];
  return parts.filter(Boolean).join('\n');
}
