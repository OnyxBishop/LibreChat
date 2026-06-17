import axios from 'axios';
import { EModelEndpoint, extractEnvVariable } from 'librechat-data-provider';
import type { Response } from 'express';
import type { Readable } from 'stream';
import { logger } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types/http';
import { getCustomEndpointConfig } from '~/app/config';
import { generateShortLivedToken } from '~/crypto/jwt';

/** Request body for the conference assistant streaming endpoint. */
interface ConferenceAssistBody {
  /** Custom endpoint name (e.g. the configured AiTunnel endpoint). */
  endpoint?: string;
  /** Chat model to use for the suggestion. */
  model?: string;
  /** User-provided global context that steers the assistant. */
  globalContext?: string;
  /** Transcript of the OTHER participants (the user's own mic is never included). */
  transcript?: string;
  /** Whether to augment the suggestion with file_search over uploaded files. */
  useRag?: boolean;
  /** File ids to search when `useRag` is enabled. */
  file_ids?: string[];
  /** Ids of the meeting participants/entities (digital fingerprints) the user selected. */
  participantIds?: string[];
  /** Pre-built fingerprint context block, injected by the route layer (has DB access). */
  fingerprintContext?: string;
}

/** A single RAG match returned by the rag_api `/query` endpoint. */
type RagQueryHit = [
  { page_content: string; metadata: { source?: string; page?: number } },
  number,
];

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const RAG_PER_FILE = 5;
const RAG_MAX_CHUNKS = 8;
/** Cap the transcript used as the RAG query — only the tail is semantically relevant. */
const RAG_QUERY_MAX_CHARS = 2000;

/**
 * Queries the RAG API for chunks relevant to the transcript across the given files.
 * Mirrors the contract used by the agents `file_search` tool
 * (api/app/clients/tools/util/fileSearch.js): POST `${RAG_API_URL}/query` with
 * `{ file_id, query, k }` and a short-lived bearer token scoped to the user.
 */
async function buildRagContext(
  userId: string,
  fileIds: string[],
  transcript: string,
): Promise<string> {
  if (!process.env.RAG_API_URL || fileIds.length === 0) {
    return '';
  }

  const jwtToken = generateShortLivedToken(userId);
  if (!jwtToken) {
    return '';
  }

  const query = transcript.slice(-RAG_QUERY_MAX_CHARS);
  const headers = {
    Authorization: `Bearer ${jwtToken}`,
    'Content-Type': 'application/json',
  };

  const responses = await Promise.all(
    fileIds.map((file_id) =>
      axios
        .post<RagQueryHit[]>(
          `${process.env.RAG_API_URL}/query`,
          { file_id, query, k: RAG_PER_FILE },
          { headers },
        )
        .then((res) => res.data)
        .catch((error) => {
          logger.error('[conference] RAG query failed for a file:', error);
          return null;
        }),
    ),
  );

  const hits = responses
    .filter((data): data is RagQueryHit[] => Array.isArray(data))
    .flatMap((data) => data)
    .filter((hit) => Array.isArray(hit) && hit[0]?.page_content)
    .sort((a, b) => a[1] - b[1])
    .slice(0, RAG_MAX_CHUNKS);

  if (hits.length === 0) {
    return '';
  }

  return hits
    .map(([docInfo, distance]) => {
      const filename = docInfo.metadata?.source?.split('/').pop() ?? 'file';
      const relevance = (1.0 - distance).toFixed(4);
      return `File: ${filename}\nRelevance: ${relevance}\nContent: ${docInfo.page_content}`;
    })
    .join('\n---\n');
}

/** Resolves header values that may reference environment variables. */
function resolveHeaders(headers?: Record<string, unknown>): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!headers) {
    return resolved;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      resolved[key] = extractEnvVariable(value);
    }
  }
  return resolved;
}

/**
 * Streams a meeting-reply suggestion from the configured custom (OpenAI-compatible)
 * endpoint. The conference screen owns its own state, so this endpoint is intentionally
 * stateless: it persists nothing and only relays a single completion as Server-Sent Events.
 *
 * SSE protocol to the client:
 *   - `data: {"token":"..."}`  incremental content
 *   - `data: {"done":true}`     stream finished
 *   - `data: {"error":"..."}`   terminal error
 */
export async function conferenceAssist(req: ServerRequest, res: Response): Promise<void> {
  const body = req.body as unknown as ConferenceAssistBody;
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';

  if (!transcript) {
    res.status(400).json({ message: 'No transcript provided.' });
    return;
  }
  if (!model) {
    res.status(400).json({ message: 'No model provided.' });
    return;
  }

  const appConfig = req.config;
  if (!appConfig) {
    res.status(500).json({ message: 'Server configuration unavailable.' });
    return;
  }

  const endpoint =
    (typeof body.endpoint === 'string' && body.endpoint.trim()) ||
    appConfig.endpoints?.[EModelEndpoint.custom]?.[0]?.name;

  if (!endpoint) {
    res.status(400).json({ message: 'No custom endpoint configured.' });
    return;
  }

  const endpointConfig = getCustomEndpointConfig({ endpoint, appConfig });
  if (!endpointConfig) {
    res.status(400).json({ message: `Config not found for the ${endpoint} endpoint.` });
    return;
  }

  const apiKey = extractEnvVariable(endpointConfig.apiKey ?? '');
  const baseURL = extractEnvVariable(endpointConfig.baseURL ?? '');
  if (!apiKey || !baseURL) {
    res.status(400).json({ message: `Missing API key or base URL for ${endpoint}.` });
    return;
  }

  let ragContext = '';
  if (body.useRag && Array.isArray(body.file_ids) && body.file_ids.length > 0) {
    try {
      ragContext = await buildRagContext(req.user?.id ?? '', body.file_ids, transcript);
    } catch (error) {
      logger.error('[conference] Failed to build RAG context:', error);
    }
  }

  const systemParts: string[] = [
    'You are a real-time meeting assistant. The user is in a live conversation/conference. ' +
      "The text below is the transcript of what the OTHER participants are saying (the user's own " +
      'microphone is NOT included). Help the user respond: suggest a concise, useful reply or the ' +
      'key points they should make next. Answer in the same language as the transcript. Be brief and practical.',
  ];
  const globalContext = typeof body.globalContext === 'string' ? body.globalContext.trim() : '';
  if (globalContext) {
    systemParts.push(`Additional context provided by the user:\n${globalContext}`);
  }
  const fingerprintContext =
    typeof body.fingerprintContext === 'string' ? body.fingerprintContext.trim() : '';
  if (fingerprintContext) {
    systemParts.push(
      'Known people/entities relevant to this meeting (use to personalize your reply and ' +
        'remember obligations; do NOT read this list aloud):\n' +
        fingerprintContext,
    );
  }
  if (ragContext) {
    systemParts.push(
      `Relevant excerpts from the user's knowledge base (use if helpful, mention the filename):\n${ragContext}`,
    );
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemParts.join('\n\n') },
    { role: 'user', content: transcript },
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const url = `${baseURL.replace(/\/$/, '')}/chat/completions`;

  let upstream: Readable | undefined;
  try {
    const upstreamResponse = await axios.post(
      url,
      { model, messages, stream: true },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...resolveHeaders(endpointConfig.headers as Record<string, unknown> | undefined),
        },
        responseType: 'stream',
      },
    );

    upstream = upstreamResponse.data as Readable;

    req.on('close', () => {
      upstream?.destroy();
    });

    let buffer = '';
    upstream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          continue;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        } catch {
          /* skip keep-alive / non-JSON lines */
        }
      }
    });

    upstream.on('end', () => {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    });

    upstream.on('error', (error: Error) => {
      logger.error('[conference] Upstream stream error:', error);
      res.write(`data: ${JSON.stringify({ error: 'stream_error' })}\n\n`);
      res.end();
    });
  } catch (error) {
    logger.error('[conference] Failed to start completion stream:', error);
    if (!res.headersSent) {
      res.status(502).json({ message: 'Failed to reach the model provider.' });
      return;
    }
    res.write(`data: ${JSON.stringify({ error: 'request_failed' })}\n\n`);
    res.end();
  }
}
