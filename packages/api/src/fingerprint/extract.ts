import axios from 'axios';
import { EModelEndpoint, extractEnvVariable } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { logger } from '@librechat/data-schemas';
import { getCustomEndpointConfig } from '~/app/config';

/** An entity the extractor is allowed to attach facts to (it never invents new entities). */
export interface KnownEntity {
  id: string;
  name: string;
  type?: string;
  aliases?: string[];
}

/** A fact the model proposes — not persisted until the route writes it as unconfirmed. */
export interface ProposedFact {
  entityId: string;
  kind: string;
  text: string;
  status?: string;
  dueDate?: string;
}

interface ResolvedChatEndpoint {
  apiKey: string;
  baseURL: string;
  headers?: Record<string, unknown>;
}

const VALID_KINDS = new Set(['attribute', 'they_owe_us', 'we_owe_them', 'note']);
/** Bound the text we hand the model so a long meeting can't blow up the request. */
const EXTRACT_MAX_CHARS = 6000;

/** Resolves apiKey/baseURL the same way the conference assist + embedding services do. */
function resolveChatEndpoint(appConfig: AppConfig, endpointName?: string): ResolvedChatEndpoint {
  const endpoint = endpointName || appConfig.endpoints?.[EModelEndpoint.custom]?.[0]?.name;
  if (!endpoint) {
    throw new Error('No custom endpoint configured for fact extraction.');
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
  return {
    apiKey,
    baseURL: baseURL.replace(/\/$/, ''),
    headers: endpointConfig.headers as Record<string, unknown> | undefined,
  };
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

/** Extracts a JSON object from a model reply that may be fenced or padded with prose. */
function parseProposals(content: string): ProposedFact[] {
  if (!content) {
    return [];
  }
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    text = fence[1].trim();
  } else {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      text = text.slice(start, end + 1);
    }
  }
  try {
    const parsed = JSON.parse(text) as { facts?: unknown };
    return Array.isArray(parsed.facts) ? (parsed.facts as ProposedFact[]) : [];
  } catch {
    return [];
  }
}

/**
 * Asks the configured chat model to extract durable CRM facts (obligations, attributes,
 * notes) about KNOWN entities from a transcript or message. Returns validated proposals;
 * the caller decides whether/how to persist them (here: as unconfirmed drafts). Never
 * throws for "nothing found" — returns an empty array.
 */
export async function extractFacts({
  appConfig,
  endpoint,
  model,
  text,
  entities,
}: {
  appConfig: AppConfig;
  endpoint?: string;
  model: string;
  text: string;
  entities: KnownEntity[];
}): Promise<ProposedFact[]> {
  const source = (text ?? '').slice(-EXTRACT_MAX_CHARS).trim();
  if (!source || entities.length === 0 || !model) {
    return [];
  }

  const { apiKey, baseURL, headers } = resolveChatEndpoint(appConfig, endpoint);

  const index = entities
    .map((entity) => {
      const aliases = entity.aliases?.length ? ` aka ${entity.aliases.join(', ')}` : '';
      const type = entity.type ? ` (${entity.type})` : '';
      return `- id:${entity.id} | ${entity.name}${type}${aliases}`;
    })
    .join('\n');

  const system =
    'You extract durable CRM facts from a meeting transcript or chat message about a fixed ' +
    'set of KNOWN entities. Return ONLY a JSON object of the form ' +
    '{"facts":[{"entityId":"...","kind":"...","text":"...","status":"...","dueDate":"..."}]}. ' +
    'kind must be one of: attribute, they_owe_us, we_owe_them, note. ' +
    '"they_owe_us" = the entity owes the user; "we_owe_them" = the user owes the entity. ' +
    'Reference entities ONLY by an id from the provided list — never invent entities or ids. ' +
    'Include only NEW, concrete facts explicitly supported by the text. status/dueDate are ' +
    'optional (dueDate as an ISO date when a deadline is stated). Write each fact in the ' +
    'language of the text. If nothing qualifies, return {"facts":[]}.';
  const user = `Known entities:\n${index}\n\nText:\n${source}`;

  let content = '';
  try {
    const response = await axios.post(
      `${baseURL}/chat/completions`,
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        stream: false,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...resolveHeaders(headers),
        },
      },
    );
    content =
      (response.data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]
        ?.message?.content ?? '';
  } catch (error) {
    logger.error('[fingerprints] fact extraction request failed', error);
    return [];
  }

  const validIds = new Set(entities.map((entity) => entity.id));
  return parseProposals(content)
    .filter(
      (fact): fact is ProposedFact =>
        !!fact &&
        typeof fact.entityId === 'string' &&
        validIds.has(fact.entityId) &&
        typeof fact.kind === 'string' &&
        VALID_KINDS.has(fact.kind) &&
        typeof fact.text === 'string' &&
        fact.text.trim().length > 0,
    )
    .map((fact) => ({
      entityId: fact.entityId,
      kind: fact.kind,
      text: fact.text.trim(),
      ...(typeof fact.status === 'string' && fact.status.trim()
        ? { status: fact.status.trim() }
        : {}),
      ...(typeof fact.dueDate === 'string' && fact.dueDate.trim()
        ? { dueDate: fact.dueDate.trim() }
        : {}),
    }));
}
