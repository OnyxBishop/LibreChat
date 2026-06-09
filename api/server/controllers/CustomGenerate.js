const { v4: uuidv4 } = require('uuid');
const { logger } = require('@librechat/data-schemas');
const {
  Constants,
  FileContext,
  extractEnvVariable,
  getResponseSender,
  classifyGenerationModality,
} = require('librechat-data-provider');
const {
  sendEvent,
  generateImage,
  getCustomEndpointConfig,
  sanitizeMessageForTransmit,
} = require('@librechat/api');
const { saveBase64Image } = require('~/server/services/Files/process');
const { saveMessage, saveConvo } = require('~/models');

/** Resolves header values that may reference environment variables. */
function resolveHeaders(headers) {
  const resolved = {};
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
 * Routes a non-text (image/video/tts) model selection on a custom OpenAI-compatible
 * endpoint to the provider's dedicated generation API instead of `/chat/completions`,
 * persists the result as a normal assistant message (so it renders + saves in history),
 * and relays it over the same SSE contract the chat client already understands
 * (`created` then `final` events). The main chat pipeline is intentionally untouched.
 *
 * Stage 1 implements image generation; video/tts return a clear "not yet available"
 * message until their stages land.
 */
const CustomGenerateController = async (req, res) => {
  const {
    text = '',
    endpoint,
    endpointOption = {},
    isTemporary,
  } = req.body;

  const userId = req.user?.id;
  const appConfig = req.config;
  const model = endpointOption.model_parameters?.model || endpointOption.model || req.body.model;
  const prompt = typeof text === 'string' ? text.trim() : '';

  if (!model) {
    res.status(400).json({ message: 'No model provided.' });
    return;
  }
  if (!prompt) {
    res.status(400).json({ message: 'A prompt is required to generate.' });
    return;
  }
  if (!appConfig) {
    res.status(500).json({ message: 'Server configuration unavailable.' });
    return;
  }

  const kind = classifyGenerationModality(model);
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

  const isNewConvo =
    !req.body.conversationId || req.body.conversationId === Constants.NEW_CONVO;
  const conversationId = isNewConvo ? uuidv4() : req.body.conversationId;
  const parentMessageId = req.body.parentMessageId ?? Constants.NO_PARENT;
  const userMessageId = req.body.messageId || uuidv4();
  const responseMessageId = `${userMessageId}_`;
  const sender = getResponseSender({ ...endpointOption, endpoint, model });

  const userMessage = {
    messageId: userMessageId,
    conversationId,
    parentMessageId,
    sender: 'User',
    text: prompt,
    isCreatedByUser: true,
    user: userId,
    endpoint,
    model,
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sendEvent(res, { created: true, message: userMessage });

  const abortController = new AbortController();
  res.on('close', () => abortController.abort());

  /** Persists messages + conversation, then emits the final assistant message. */
  const finalize = async (responseMessage) => {
    await saveMessage({ userId, isTemporary }, userMessage, {
      context: 'CustomGenerate - user message',
    });
    await saveMessage({ userId, isTemporary }, { ...responseMessage, user: userId }, {
      context: 'CustomGenerate - response',
    });

    const title = isNewConvo ? prompt.slice(0, 80) : undefined;
    let conversation;
    try {
      conversation = await saveConvo(
        { userId, isTemporary },
        { conversationId, endpoint, model, ...(title ? { title } : {}) },
        { context: 'CustomGenerateController' },
      );
    } catch (error) {
      logger.error('[CustomGenerate] Failed to save conversation:', error);
    }
    conversation = conversation || { conversationId, endpoint, model, title };

    sendEvent(res, {
      final: true,
      conversation,
      title: conversation.title,
      requestMessage: sanitizeMessageForTransmit(userMessage),
      responseMessage,
    });
    res.end();
  };

  const baseResponse = {
    messageId: responseMessageId,
    conversationId,
    parentMessageId: userMessageId,
    sender,
    isCreatedByUser: false,
    endpoint,
    model,
    unfinished: false,
  };

  try {
    if (kind !== 'image') {
      await finalize({
        ...baseResponse,
        text:
          kind === 'video'
            ? 'Генерация видео скоро будет доступна.'
            : 'Генерация аудио скоро будет доступна.',
        error: false,
      });
      return;
    }

    const params = endpointOption.model_parameters ?? {};
    const result = await generateImage({
      baseURL,
      apiKey,
      model,
      prompt,
      n: 1,
      size: params.imageSize,
      quality: params.imageQuality,
      headers: resolveHeaders(endpointConfig.headers),
      signal: abortController.signal,
    });

    const markdownParts = [];
    for (const image of result.images) {
      const file = await saveBase64Image(`data:${image.mimeType};base64,${image.b64}`, {
        req,
        file_id: uuidv4(),
        filename: 'image.png',
        endpoint,
        context: FileContext.image_generation,
      });
      markdownParts.push(`![generated image](${file.filepath})`);
    }

    await finalize({
      ...baseResponse,
      text: markdownParts.join('\n\n'),
      error: false,
    });
  } catch (error) {
    const providerMessage =
      error?.response?.data?.error?.message || error?.message || 'Image generation failed.';
    logger.error('[CustomGenerate] Generation failed:', providerMessage);
    if (res.headersSent && !res.writableEnded) {
      await finalize({
        ...baseResponse,
        text: `Не удалось сгенерировать: ${providerMessage}`,
        error: true,
      });
    } else if (!res.headersSent) {
      res.status(502).json({ message: providerMessage });
    }
  }
};

module.exports = CustomGenerateController;
