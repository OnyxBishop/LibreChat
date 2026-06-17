const { embedText, formatFingerprintContext } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { getFingerprintById, semanticSearch } = require('~/models');

/** How many semantic matches to pull from the transcript/query tail. */
const SEMANTIC_LIMIT = 4;
/** Drop weak cosine matches so unrelated entities don't pollute the prompt. */
const MIN_SCORE = 0.3;
/** Only the tail of a long transcript is semantically relevant to "now". */
const QUERY_MAX_CHARS = 2000;

/**
 * Resolves the entities relevant to "now": explicitly named participants (by id)
 * merged with semantic matches from free text, deduped by `_id`. Shared seam used
 * both to build the prompt context and to scope AI fact extraction to the entities
 * a turn is actually about (never the whole CRM). Throws on embedding failure — the
 * caller decides whether to swallow it.
 *
 * @param {object} params
 * @param {import('express').Request} params.req - carries `req.config` for embedText.
 * @param {string} params.userId
 * @param {string[]} [params.participantIds] - explicitly selected entity ids.
 * @param {string} [params.queryText] - free text (transcript / last message) to match.
 * @param {number} [params.limit]
 * @returns {Promise<object[]>} full entity docs (vector stripped).
 */
async function resolveRelevantFingerprints({
  req,
  userId,
  participantIds = [],
  queryText = '',
  limit = SEMANTIC_LIMIT,
}) {
  if (!userId) {
    return [];
  }
  const byId = new Map();

  const ids = Array.isArray(participantIds)
    ? participantIds.filter((id) => typeof id === 'string' && id.trim())
    : [];
  if (ids.length > 0) {
    const participants = await Promise.all(
      ids.map((id) => getFingerprintById({ author: userId, id }).catch(() => null)),
    );
    for (const entity of participants) {
      if (entity) {
        byId.set(String(entity._id), entity);
      }
    }
  }

  const query = typeof queryText === 'string' ? queryText.slice(-QUERY_MAX_CHARS).trim() : '';
  if (query) {
    const { vector } = await embedText(req.config, query);
    const hits = await semanticSearch({
      author: userId,
      queryVector: vector,
      limit,
      minScore: MIN_SCORE,
    });
    for (const hit of hits) {
      const key = String(hit._id);
      if (!byId.has(key)) {
        byId.set(key, hit);
      }
    }
  }

  return Array.from(byId.values());
}

/**
 * Builds the fingerprint context block for an LLM prompt from the relevant entities.
 * Best-effort — any failure (embedding provider down, bad id) yields an empty string
 * so the caller's main flow (a meeting suggestion, a chat turn) is never blocked.
 *
 * @param {object} params - see {@link resolveRelevantFingerprints}.
 * @returns {Promise<string>}
 */
async function buildFingerprintContext(params) {
  if (!params.userId) {
    return '';
  }
  try {
    const entities = await resolveRelevantFingerprints(params);
    if (entities.length === 0) {
      return '';
    }
    return formatFingerprintContext(entities);
  } catch (error) {
    logger.error('[fingerprints] failed to build context (skipping)', error);
    return '';
  }
}

module.exports = { buildFingerprintContext, resolveRelevantFingerprints };
