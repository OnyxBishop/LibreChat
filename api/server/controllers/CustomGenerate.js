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
    /** Buffer the bytes (not the lazy fs stream) so the whole form can be serialized below. */
    const buffer = await streamToBuffer(stream);
    formData.append(fieldName, buffer, {
      filename: file.filename || 'image.png',
      contentType: file.type || 'image/png',
    });
  }
  /** Serialize the whole form to one Buffer so undici can send it with an exact length. */
  const bodyBuffer = formData.getBuffer();
  logger.info(
    `[CustomGenerate] editImage: ${records.length} image(s) [${records
      .map((r) => `${r.source}:${r.type}`)
      .join(', ')}] -> ${model}, body=${bodyBuffer.length}b`,
  );

  /**
   * Use native fetch (undici) with an AbortController timeout. The axios + form-data path
   * left the request in a state where neither axios's own timeout nor a JS timer rescued it;
   * undici reliably aborts at any phase. Granular logs pinpoint exactly where the call dies.
   * undici sets Content-Length from the Buffer body itself, so we only pass the multipart
   * Content-Type (from `getHeaders()`).
   */
  const url = `${baseURL.replace(/\/$/, '')}/images/edits`;
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', onParentAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

  let json;
  try {
    logger.info(`[CustomGenerate] editImage: POST ${url} (fetch, ${bodyBuffer.length}b) ...`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${apiKey}`,
        ...(headers ?? {}),
      },
      body: bodyBuffer,
      signal: controller.signal,
    });
    logger.info(
      `[CustomGenerate] editImage: provider responded ${response.status} ct=${response.headers.get('content-type')} cl=${response.headers.get('content-length')} te=${response.headers.get('transfer-encoding')}`,
    );
    /**
     * Read the body INSIDE the timeout-protected block. Headers (200) can arrive while the
     * body still stalls; if the timer is cleared first, the read would hang with no abort.
     * Read manually chunk-by-chunk so the logs show exactly how far the body got.
     */
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      logger.error(
        `[CustomGenerate] editImage provider error ${response.status}: ${errText.slice(0, 400)}`,
      );
      throw new Error(`Provider /images/edits returned ${response.status}`);
    }
    /**
     * Read the chunked body manually. AiTunnel returns the edit result as
     * `Transfer-Encoding: chunked` (no Content-Length), on which undici's `response.json()`
     * stalls indefinitely; reading the stream to completion ourselves works reliably.
     */
    const reader = response.body.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(Buffer.from(value));
    }
    json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    logger.info(`[CustomGenerate] editImage: parsed body, ${json?.data?.length ?? 0} datum(s)`);
  } catch (err) {
    logger.error(
      `[CustomGenerate] editImage fetch failed: name=${err?.name} msg=${err?.message} cause=${err?.cause?.code ?? err?.cause?.message ?? ''}`,
    );
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener('abort', onParentAbort);
    }
  }

  const data = json?.data ?? [];
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
  /**
   * Generation can take 30s+ with no data flowing between `created` and `final`. Without
   * traffic, proxies (nginx) drop the idle SSE connection before `final` arrives — the
   * spinner then hangs and the image only appears on reload. A periodic comment keeps it warm.
   */
  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch (error) {
      logger.debug('[CustomGenerate] heartbeat write failed', error);
    }
  }, 15000);
  res.on('close', () => {
    clearInterval(heartbeat);
    abortController.abort();
  });

  /** Persists messages + conversation, then emits the final assistant message. */
  const finalize = async (responseMessage) => {
    clearInterval(heartbeat);
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

    logger.info(`[CustomGenerate] saving ${images.length} image(s) + finalizing`);
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
