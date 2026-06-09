const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { generateCheckAccess, skipAgentCheck, getCustomEndpointConfig } = require('@librechat/api');
const {
  PermissionTypes,
  Permissions,
  PermissionBits,
  classifyGenerationModality,
} = require('librechat-data-provider');
const {
  moderateText,
  // validateModel,
  validateConvoAccess,
  buildEndpointOption,
  canAccessAgentFromBody,
} = require('~/server/middleware');
const { initializeClient } = require('~/server/services/Endpoints/agents');
const AgentController = require('~/server/controllers/agents/request');
const CustomGenerateController = require('~/server/controllers/CustomGenerate');
const addTitle = require('~/server/services/Endpoints/agents/title');
const { getRoleByName } = require('~/models');

const router = express.Router();

const checkAgentAccess = generateCheckAccess({
  permissionType: PermissionTypes.AGENTS,
  permissions: [Permissions.USE],
  skipCheck: skipAgentCheck,
  getRoleByName,
});
const checkAgentResourceAccess = canAccessAgentFromBody({
  requiredPermission: PermissionBits.VIEW,
});

router.use(moderateText);
router.use(checkAgentAccess);
router.use(checkAgentResourceAccess);
router.use(validateConvoAccess);
router.use(buildEndpointOption);

const controller = async (req, res, next) => {
  /**
   * Inline generation routing: image/video/tts models on a custom (OpenAI-compatible)
   * endpoint must go to the provider's generation API, not `/chat/completions`. Detect
   * by modality + custom-endpoint config and hand off to the dedicated controller;
   * everything else uses the normal agents pipeline untouched.
   */
  try {
    const endpointOption = req.body.endpointOption || {};
    const model = endpointOption.model_parameters?.model || endpointOption.model || req.body.model;
    if (model && classifyGenerationModality(model) != null) {
      const customConfig = getCustomEndpointConfig({
        endpoint: req.body.endpoint,
        appConfig: req.config,
      });
      if (customConfig) {
        return CustomGenerateController(req, res);
      }
    }
  } catch (error) {
    logger.error('[agents/chat] inline-generation routing check failed', error);
  }
  await AgentController(req, res, next, initializeClient, addTitle);
};

/**
 * @route POST / (regular endpoint)
 * @desc Chat with an assistant
 * @access Public
 * @param {express.Request} req - The request object, containing the request data.
 * @param {express.Response} res - The response object, used to send back a response.
 * @returns {void}
 */
router.post('/', controller);

/**
 * @route POST /:endpoint (ephemeral agents)
 * @desc Chat with an assistant
 * @access Public
 * @param {express.Request} req - The request object, containing the request data.
 * @param {express.Response} res - The response object, used to send back a response.
 * @returns {void}
 */
router.post('/:endpoint', controller);

module.exports = router;
