const express = require('express');
const { conferenceAssist } = require('@librechat/api');
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

module.exports = router;
