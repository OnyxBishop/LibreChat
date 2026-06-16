const express = require('express');
const { conferenceAssist } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const {
  getConferenceSessions,
  createConferenceSession,
  updateConferenceSession,
  deleteConferenceSession,
} = require('~/models');
const { requireJwtAuth, checkBan, configMiddleware } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);
router.use(checkBan);
router.use(configMiddleware);

/**
 * @route POST /api/conference/assist
 * @desc Streams a meeting-reply suggestion (SSE) from the configured custom endpoint.
 * @access Private
 */
router.post('/assist', (req, res) => conferenceAssist(req, res));

/** Trims session arrays to the persisted shape (text + optional timestamp). */
function sanitizeSegments(segments) {
  if (!Array.isArray(segments)) {
    return undefined;
  }
  return segments
    .filter((segment) => segment && typeof segment.text === 'string')
    .map((segment) => ({
      text: segment.text,
      timestamp: typeof segment.timestamp === 'string' ? segment.timestamp : '',
    }));
}

function sanitizeSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) {
    return undefined;
  }
  return suggestions
    .filter((suggestion) => suggestion && typeof suggestion.text === 'string')
    .map((suggestion) => ({ text: suggestion.text }));
}

/** Builds the {title, systemSegments, micSegments, suggestions} update from a request body. */
function buildSessionData(body) {
  const data = {};
  if (typeof body.title === 'string') {
    data.title = body.title.trim();
  }
  const systemSegments = sanitizeSegments(body.systemSegments);
  if (systemSegments) {
    data.systemSegments = systemSegments;
  }
  const micSegments = sanitizeSegments(body.micSegments);
  if (micSegments) {
    data.micSegments = micSegments;
  }
  const suggestions = sanitizeSuggestions(body.suggestions);
  if (suggestions) {
    data.suggestions = suggestions;
  }
  return data;
}

/**
 * @route GET /api/conference/sessions
 * @desc Lists the authenticated user's saved conference sessions (newest first).
 * @access Private
 */
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await getConferenceSessions(req.user.id);
    res.status(200).json(sessions);
  } catch (error) {
    logger.error('[/conference/sessions] error listing sessions', error);
    res.status(500).json({ message: 'Error retrieving conference sessions' });
  }
});

/**
 * @route POST /api/conference/sessions
 * @desc Creates a saved conference session.
 * @access Private
 */
router.post('/sessions', async (req, res) => {
  const body = req.body || {};
  const data = buildSessionData(body);
  if (!data.title) {
    data.title = 'Conference';
  }
  try {
    const session = await createConferenceSession(req.user.id, data);
    res.status(201).json(session);
  } catch (error) {
    logger.error('[/conference/sessions] error creating session', error);
    res.status(500).json({ message: 'Error creating conference session' });
  }
});

/**
 * @route PATCH /api/conference/sessions/:id
 * @desc Updates a saved conference session (autosave + rename).
 * @access Private
 */
router.patch('/sessions/:id', async (req, res) => {
  const { id } = req.params;
  const data = buildSessionData(req.body || {});
  try {
    const session = await updateConferenceSession({ author: req.user.id, id, data });
    if (!session) {
      return res.status(404).json({ message: 'Conference session not found' });
    }
    res.status(200).json(session);
  } catch (error) {
    logger.error('[/conference/sessions] error updating session', error);
    res.status(500).json({ message: 'Error updating conference session' });
  }
});

/**
 * @route DELETE /api/conference/sessions/:id
 * @desc Deletes a saved conference session.
 * @access Private
 */
router.delete('/sessions/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { deleted } = await deleteConferenceSession({ author: req.user.id, id });
    if (!deleted) {
      return res.status(404).json({ message: 'Conference session not found' });
    }
    res.status(200).json({ message: 'Conference session deleted' });
  } catch (error) {
    logger.error('[/conference/sessions] error deleting session', error);
    res.status(500).json({ message: 'Error deleting conference session' });
  }
});

module.exports = router;
