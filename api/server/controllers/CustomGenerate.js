const axios = require('axios');
const FormData = require('form-data');
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
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { saveBase64Image } = require('~/server/services/Files/process');
const { saveMessage, saveConvo, getFiles } = require('~/models');

/** Hard ceiling on provider calls so a stalled request can never hang the chat forever. */
const GENERATION_TIMEOUT_MS = 180_000;

/** Collects a readable stream fully into a Buffer (with a clear error on stall/missing file). */
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

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
 * Edits attached image(s) via the endpoint's `/images/edits` (multipart) — used by the
 * "edit last image" toggle, which appends the conversation's most recent image to
 * `req.body.files`. Reads the stored image bytes via the file strategy into a Buffer.
 * Returns normalized base64 images.
 */
async function editImage({ baseURL, apiKey, model, prompt, files, params, req, headers, signal }) {
  const ids = files.map((f) => f.file_id).filter(Boolean);
  const records = ids.length
    ? await getFiles({ user: req.user?.id, file_id: { $in: ids } }, {}, {})
    : [];
  if (records.length === 0) {
    throw new Error('Could not resolve the image to edit.');
  }

  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', prompt);
  formData.append('n', '1');
  if (params.imageSize) {
    formData.append('size', params.imageSize);
  }
  if (params.imageQuality) {
    formData.append('quality', params.imageQuality);
  }

  const fieldName = records.length > 1 ? 'image[]' : 'image';
  for (const file of records) {
    const source = file.source || req.config?.fileStrategy;
    const { getDownloadStream } = getStrategyFunctions(source);
    if (typeof getDownloadStream !== 'function') {
      throw new Error(`No download stream available for file source "${source}".`);
    }
    const stream = await getDownloadStream(req, file.filepath);
    /**
     * Buffer the bytes instead of appending the lazy fs stream: with a Buffer the
     * multipart Content-Length is exact, so `axios + form-data` can't stall waiting
     * on a stream that never finishes (the cause of the infinite-spinner hang).
     */
    const buffer = await streamToBuffer(stream);
    formData.append(fieldName, buffer, {
      filename: file.filename || 'image.png',
      contentType: file.type || 'image/png',
    });
  }
  /**
   * Set Content-Length explicitly. Without it, axios sends the multipart body with
   * `Transfer-Encoding: chunked`, which the AiTunnel proxy doesn't terminate — it waits
   * for a length-delimited body forever (the real cause of the hang; JSON generation works
   * because axios sets Content-Length for it automatically). Buffers give an exact length.
   */
  const contentLength = formData.getLengthSync();
  logger.info(
    `[CustomGenerate] editImage: ${records.length} image(s) [${records
      .map((r) => `${r.source}:${r.type}`)
      .join(', ')}] -> ${model}, body=${contentLength}b`,
  );

  /** Own timeout via AbortController — axios `timeout` did not fire on the stalled upload. */
  const timeoutController = new AbortController();
  const onParentAbort = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    } else {
      signal.addEventListener('abort', onParentAbort, { once: true });
    }
  }
  const timer = setTimeout(() => timeoutController.abort(), GENERATION_TIMEOUT_MS);

  const url = `${baseURL.replace(/\/$/, '')}/images/edits`;
  let resp;
  try {
    resp = await axios.post(url, formData, {
      headers: {
        ...formData.getHeaders(),
        'Content-Length': contentLength,
        Authorization: `Bearer ${apiKey}`,
        ...(headers ?? {}),
      },
      timeout: GENERATION_TIMEOUT_MS,
      signal: timeoutController.signal,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener('abort', onParentAbort);
    }
  }

  const data = resp.data?.data ?? [];
  const images = data
    .filter((d) => d.b64_json)
    .map((d) => ({ b64: d.b64_json, mimeType: 'image/png' }));
  if (images.length === 0) {
    throw new Error('No image data returned by the provider.');
  }
  return images;
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
    const resolvedHeaders = resolveHeaders(endpointConfig.headers);
    const incomingFiles = Array.isArray(req.body.files) ? req.body.files : [];
    const attachedImages = incomingFiles.filter(
      (f) =>
        f &&
        (f.file_id || f.filepath) &&
        ((typeof f.type === 'string' && f.type.startsWith('image/')) || f.height != null),
    );
    logger.info(
      `[CustomGenerate] image request: ${incomingFiles.length} file(s) in body, ${attachedImages.length} image(s) -> ${attachedImages.length > 0 ? 'edit' : 'generate'}`,
    );

    let images;
    if (attachedImages.length > 0) {
      images = await editImage({
        baseURL,
        apiKey,
        model,
        prompt,
        files: attachedImages,
        params,
        req,
        headers: resolvedHeaders,
        signal: abortController.signal,
      });
    } else {
      const result = await generateImage({
        baseURL,
        apiKey,
        model,
        prompt,
        n: 1,
        size: params.imageSize,
        quality: params.imageQuality,
        headers: resolvedHeaders,
        signal: abortController.signal,
      });
      images = result.images;
    }

    const markdownParts = [];
    const savedFiles = [];
    for (const image of images) {
      const file = await saveBase64Image(`data:${image.mimeType};base64,${image.b64}`, {
        req,
        file_id: uuidv4(),
        filename: 'image.png',
        endpoint,
        context: FileContext.image_generation,
      });
      /**
       * Markdown renders the image inline (assistant `files` aren't shown in the UI),
       * while `files` makes it discoverable by the "edit last image" toggle next turn.
       */
      markdownParts.push(`![generated image](${file.filepath})`);
      savedFiles.push({
        file_id: file.file_id,
        filepath: file.filepath,
        filename: file.filename,
        type: file.type,
        height: file.height,
        width: file.width,
        source: file.source,
      });
    }

    await finalize({
      ...baseResponse,
      text: markdownParts.join('\n\n'),
      files: savedFiles,
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
