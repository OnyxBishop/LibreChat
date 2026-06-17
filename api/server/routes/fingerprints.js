const express = require('express');
const { embedText, buildEmbeddingText, getEmbeddingModel } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const {
  getFingerprints,
  getFingerprintById,
  createFingerprint,
  updateFingerprint,
  deleteFingerprint,
  setFingerprintEmbedding,
  getFingerprintsNeedingEmbedding,
  semanticSearch,
} = require('~/models');
const { requireJwtAuth, checkBan, configMiddleware } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);
router.use(checkBan);
router.use(configMiddleware);

const FACT_KINDS = ['attribute', 'they_owe_us', 'we_owe_them', 'note'];

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function sanitizeFacts(facts) {
  if (!Array.isArray(facts)) {
    return undefined;
  }
  return facts
    .filter((fact) => fact && typeof fact.text === 'string')
    .map((fact) => ({
      ...(fact._id ? { _id: fact._id } : {}),
      kind: FACT_KINDS.includes(fact.kind) ? fact.kind : 'note',
      label: typeof fact.label === 'string' ? fact.label : '',
      text: fact.text,
      status: typeof fact.status === 'string' ? fact.status : '',
      ...(fact.dueDate ? { dueDate: fact.dueDate } : {}),
      source: typeof fact.source === 'string' ? fact.source : 'manual',
      sourceRefId: typeof fact.sourceRefId === 'string' ? fact.sourceRefId : '',
      confirmed: fact.confirmed !== false,
    }));
}

function sanitizeRelations(relations) {
  if (!Array.isArray(relations)) {
    return undefined;
  }
  return relations
    .filter((relation) => relation && typeof relation.entityId === 'string' && relation.entityId)
    .map((relation) => ({
      entityId: relation.entityId,
      role: typeof relation.role === 'string' ? relation.role : '',
    }));
}

/** Builds a sanitized {type, name, aliases, summary, facts, relations, tags} update. */
function buildFingerprintData(body) {
  const data = {};
  if (typeof body.type === 'string' && body.type.trim()) {
    data.type = body.type.trim();
  }
  if (typeof body.name === 'string') {
    data.name = body.name.trim();
  }
  if (typeof body.summary === 'string') {
    data.summary = body.summary;
  }
  const aliases = sanitizeStringArray(body.aliases);
  if (aliases) {
    data.aliases = aliases;
  }
  const tags = sanitizeStringArray(body.tags);
  if (tags) {
    data.tags = tags;
  }
  const facts = sanitizeFacts(body.facts);
  if (facts) {
    data.facts = facts;
  }
  const relations = sanitizeRelations(body.relations);
  if (relations) {
    data.relations = relations;
  }
  return data;
}

/** Fields whose change requires recomputing the embedding. */
const EMBED_RELEVANT_KEYS = ['type', 'name', 'aliases', 'summary', 'facts'];

/** Best-effort: (re)compute and store the embedding for a saved fingerprint. */
async function embedAndStore(req, fp) {
  try {
    const text = buildEmbeddingText(fp);
    const { vector, model } = await embedText(req.config, text);
    const updated = await setFingerprintEmbedding({
      author: req.user.id,
      id: String(fp._id),
      embedding: vector,
      embeddingText: text,
      embeddingModel: model,
    });
    return updated || fp;
  } catch (error) {
    logger.error('[/fingerprints] embedding failed (entity still saved)', error);
    return fp;
  }
}

/**
 * @route GET /api/fingerprints
 * @desc Lists the user's entities, optionally filtered by `?type=`.
 * @access Private
 */
router.get('/', async (req, res) => {
  try {
    const { type } = req.query;
    const items = await getFingerprints(req.user.id, { type });
    res.status(200).json(items);
  } catch (error) {
    logger.error('[/fingerprints] error listing', error);
    res.status(500).json({ message: 'Error retrieving fingerprints' });
  }
});

/**
 * @route POST /api/fingerprints
 * @desc Creates an entity and computes its embedding (best-effort).
 * @access Private
 */
router.post('/', async (req, res) => {
  const data = buildFingerprintData(req.body || {});
  if (!data.name) {
    return res.status(400).json({ message: 'name is required' });
  }
  try {
    const created = await createFingerprint(req.user.id, data);
    const stored = await embedAndStore(req, created);
    res.status(201).json(stored);
  } catch (error) {
    logger.error('[/fingerprints] error creating', error);
    res.status(500).json({ message: 'Error creating fingerprint' });
  }
});

/**
 * @route GET /api/fingerprints/:id
 * @desc Returns one entity.
 * @access Private
 */
router.get('/:id', async (req, res) => {
  try {
    const item = await getFingerprintById({ author: req.user.id, id: req.params.id });
    if (!item) {
      return res.status(404).json({ message: 'Fingerprint not found' });
    }
    res.status(200).json(item);
  } catch (error) {
    logger.error('[/fingerprints] error getting', error);
    res.status(500).json({ message: 'Error retrieving fingerprint' });
  }
});

/**
 * @route PATCH /api/fingerprints/:id
 * @desc Updates an entity; re-embeds when identity/fact fields change.
 * @access Private
 */
router.patch('/:id', async (req, res) => {
  const body = req.body || {};
  const data = buildFingerprintData(body);
  try {
    const updated = await updateFingerprint({ author: req.user.id, id: req.params.id, data });
    if (!updated) {
      return res.status(404).json({ message: 'Fingerprint not found' });
    }
    const embedChanged = EMBED_RELEVANT_KEYS.some((key) => key in data);
    const stored = embedChanged ? await embedAndStore(req, updated) : updated;
    res.status(200).json(stored);
  } catch (error) {
    logger.error('[/fingerprints] error updating', error);
    res.status(500).json({ message: 'Error updating fingerprint' });
  }
});

/**
 * @route DELETE /api/fingerprints/:id
 * @desc Deletes an entity.
 * @access Private
 */
router.delete('/:id', async (req, res) => {
  try {
    const { deleted } = await deleteFingerprint({ author: req.user.id, id: req.params.id });
    if (!deleted) {
      return res.status(404).json({ message: 'Fingerprint not found' });
    }
    res.status(200).json({ message: 'Fingerprint deleted' });
  } catch (error) {
    logger.error('[/fingerprints] error deleting', error);
    res.status(500).json({ message: 'Error deleting fingerprint' });
  }
});

/**
 * @route POST /api/fingerprints/search
 * @desc Semantic search: embeds the query, returns ranked entities (with scores).
 * @access Private
 */
router.post('/search', async (req, res) => {
  const { query, limit } = req.body || {};
  if (typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ message: 'query is required' });
  }
  try {
    const { vector } = await embedText(req.config, query.trim());
    const results = await semanticSearch({
      author: req.user.id,
      queryVector: vector,
      limit: typeof limit === 'number' ? limit : 5,
    });
    res.status(200).json(results);
  } catch (error) {
    logger.error('[/fingerprints/search] error', error);
    res.status(500).json({ message: 'Error searching fingerprints' });
  }
});

/**
 * @route POST /api/fingerprints/reembed
 * @desc Backfills embeddings for entities lacking a current vector.
 * @access Private
 */
router.post('/reembed', async (req, res) => {
  try {
    const stale = await getFingerprintsNeedingEmbedding(req.user.id, { model: getEmbeddingModel() });
    let count = 0;
    for (const fp of stale) {
      await embedAndStore(req, fp);
      count += 1;
    }
    res.status(200).json({ count });
  } catch (error) {
    logger.error('[/fingerprints/reembed] error', error);
    res.status(500).json({ message: 'Error re-embedding fingerprints' });
  }
});

module.exports = router;
