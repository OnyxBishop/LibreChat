const { nanoid } = require('nanoid');
const { logger } = require('@librechat/data-schemas');
const { Tools, StepTypes, FileContext, ErrorTypes } = require('librechat-data-provider');
const {
  EnvVar,
  Constants,
  GraphEvents,
  GraphNodeKeys,
  ToolEndHandler,
} = require('@librechat/agents');
const {
  sendEvent,
  GenerationJobManager,
  writeAttachmentEvent,
  createToolExecuteHandler,
} = require('@librechat/api');
const { processFileCitations } = require('~/server/services/Files/Citations');
const { processCodeOutput } = require('~/server/services/Files/Code/process');
const { loadAuthValues } = require('~/server/services/Tools/credentials');
const { saveBase64Image } = require('~/server/services/Files/process');

/**
 * Pulls inline image data URIs out of an LLM AIMessage. Covers three shapes seen in the wild:
 *   1) `output.content` is an array of multimodal blocks → look for `{type:'image_url', image_url:string|{url}}`.
 *   2) `output.additional_kwargs.images` (OpenRouter convention for Gemini's native image output) with the
 *      same image_url block shape inside.
 *   3) `output.additional_kwargs.__raw_response.choices[*].{delta,message}.images` — the OpenAI-compatible
 *      raw payload. `@langchain/openai` (0.5.x) maps only function_call/tool_calls/audio into the AIMessage
 *      and silently drops a provider's non-standard `images` field; the raw response is the only place it
 *      survives streaming aggregation. Requires `__includeRawResponse: true` on the LLM (set via the
 *      endpoint's `addParams` in librechat.yaml). AiTunnel image models (e.g. gemini-2.5-flash-image) only
 *      deliver the picture here.
 * Only `data:` URIs are saved downstream — remote URLs are passed through unchanged so the client can fetch
 * them. Results are de-duplicated by URL so the same picture isn't saved twice across sources.
 */
function extractInlineImagesFromOutput(output) {
  if (!output) {
    return [];
  }
  /** @type {Array<{ url: string }>} */
  const images = [];
  const seen = new Set();
  const pushPart = (part) => {
    if (!part || typeof part !== 'object' || part.type !== 'image_url') {
      return;
    }
    const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
    if (typeof url === 'string' && url.length > 0 && !seen.has(url)) {
      seen.add(url);
      images.push({ url });
    }
  };
  const pushParts = (parts) => {
    if (Array.isArray(parts)) {
      for (const part of parts) {
        pushPart(part);
      }
    }
  };
  if (Array.isArray(output.content)) {
    pushParts(output.content);
  }
  pushParts(output.additional_kwargs?.images);
  const rawChoices = output.additional_kwargs?.__raw_response?.choices;
  if (Array.isArray(rawChoices)) {
    for (const choice of rawChoices) {
      pushParts(choice?.delta?.images);
      pushParts(choice?.message?.images);
    }
  }
  return images;
}

class ModelEndHandler {
  /**
   * @param {Object} options
   * @param {Array<UsageMetadata>} options.collectedUsage
   * @param {ServerRequest} [options.req]
   * @param {ServerResponse} [options.res]
   * @param {string | null} [options.streamId]
   * @param {Promise<MongoFile | { filename: string; filepath: string; expires: number;} | null>[]} [options.artifactPromises]
   */
  constructor({ collectedUsage, req, res, streamId = null, artifactPromises } = {}) {
    if (!Array.isArray(collectedUsage)) {
      throw new Error('collectedUsage must be an array');
    }
    this.collectedUsage = collectedUsage;
    this.req = req;
    this.res = res;
    this.streamId = streamId;
    this.artifactPromises = artifactPromises;
  }

  finalize(errorMessage) {
    if (!errorMessage) {
      return;
    }
    throw new Error(errorMessage);
  }

  /**
   * Saves any inline images returned by the LLM in this turn and emits attachment SSE events.
   * Only runs when req + artifactPromises were wired in (i.e. the user-facing chat flow).
   */
  processInlineImages(data, metadata) {
    if (!this.req || !this.artifactPromises) {
      return;
    }
    const images = extractInlineImagesFromOutput(data?.output);
    if (images.length === 0) {
      return;
    }
    logger.info(
      `[ModelEndHandler] inline images: saving ${images.length} (run ${metadata?.run_id})`,
    );
    const provider = metadata?.provider;
    for (const { url } of images) {
      if (!url.startsWith('data:')) {
        continue;
      }
      this.artifactPromises.push(
        (async () => {
          const filename = `llm_inline_${nanoid()}`;
          const file = await saveBase64Image(url, {
            req: this.req,
            filename,
            endpoint: provider,
            context: FileContext.image_generation,
          });
          const fileMetadata = Object.assign(file, {
            messageId: metadata?.run_id,
            conversationId: metadata?.thread_id,
          });
          writeAttachment(this.res, this.streamId, fileMetadata);
          return fileMetadata;
        })().catch((error) => {
          logger.error('[ModelEndHandler] Error saving inline LLM image:', error);
          return null;
        }),
      );
    }
  }

  /**
   * @param {string} event
   * @param {ModelEndData | undefined} data
   * @param {Record<string, unknown> | undefined} metadata
   * @param {StandardGraph} graph
   * @returns {Promise<void>}
   */
  async handle(event, data, metadata, graph) {
    if (!graph || !metadata) {
      console.warn(`Graph or metadata not found in ${event} event`);
      return;
    }

    /** @type {string | undefined} */
    let errorMessage;
    try {
      const agentContext = graph.getAgentContext(metadata);
      if (data?.output?.additional_kwargs?.stop_reason === 'refusal') {
        const info = { ...data.output.additional_kwargs };
        errorMessage = JSON.stringify({
          type: ErrorTypes.REFUSAL,
          info,
        });
        logger.debug(`[ModelEndHandler] Model refused to respond`, {
          ...info,
          userId: metadata.user_id,
          messageId: metadata.run_id,
          conversationId: metadata.thread_id,
        });
      }

      this.processInlineImages(data, metadata);

      const usage = data?.output?.usage_metadata;
      if (!usage) {
        return this.finalize(errorMessage);
      }
      const modelName = metadata?.ls_model_name || agentContext.clientOptions?.model;
      if (modelName) {
        usage.model = modelName;
      }

      const taggedUsage = markSummarizationUsage(usage, metadata);

      this.collectedUsage.push(taggedUsage);
    } catch (error) {
      logger.error('Error handling model end event:', error);
      return this.finalize(errorMessage);
    }
  }
}

/**
 * @deprecated Agent Chain helper
 * @param {string | undefined} [last_agent_id]
 * @param {string | undefined} [langgraph_node]
 * @returns {boolean}
 */
function checkIfLastAgent(last_agent_id, langgraph_node) {
  if (!last_agent_id || !langgraph_node) {
    return false;
  }
  return langgraph_node?.endsWith(last_agent_id);
}

/**
 * Helper to emit events either to res (standard mode) or to job emitter (resumable mode).
 * In Redis mode, awaits the emit to guarantee event ordering (critical for streaming deltas).
 * @param {ServerResponse} res - The server response object
 * @param {string | null} streamId - The stream ID for resumable mode, or null for standard mode
 * @param {Object} eventData - The event data to send
 * @returns {Promise<void>}
 */
async function emitEvent(res, streamId, eventData) {
  if (streamId) {
    await GenerationJobManager.emitChunk(streamId, eventData);
  } else {
    sendEvent(res, eventData);
  }
}

/**
 * @typedef {Object} ToolExecuteOptions
 * @property {(toolNames: string[]) => Promise<{loadedTools: StructuredTool[]}>} loadTools - Function to load tools by name
 * @property {Object} configurable - Configurable context for tool invocation
 */

/**
 * Get default handlers for stream events.
 * @param {Object} options - The options object.
 * @param {ServerResponse} options.res - The server response object.
 * @param {ContentAggregator} options.aggregateContent - Content aggregator function.
 * @param {ToolEndCallback} options.toolEndCallback - Callback to use when tool ends.
 * @param {Array<UsageMetadata>} options.collectedUsage - The list of collected usage metadata.
 * @param {ServerRequest} [options.req] - The server request object (used to save inline LLM images).
 * @param {Promise<MongoFile | { filename: string; filepath: string; expires: number;} | null>[]} [options.artifactPromises] - Shared artifact promises array.
 * @param {string | null} [options.streamId] - The stream ID for resumable mode, or null for standard mode.
 * @param {ToolExecuteOptions} [options.toolExecuteOptions] - Options for event-driven tool execution.
 * @returns {Record<string, t.EventHandler>} The default handlers.
 * @throws {Error} If the request is not found.
 */
function getDefaultHandlers({
  req,
  res,
  aggregateContent,
  toolEndCallback,
  collectedUsage,
  artifactPromises,
  streamId = null,
  toolExecuteOptions = null,
  summarizationOptions = null,
}) {
  if (!res || !aggregateContent) {
    throw new Error(
      `[getDefaultHandlers] Missing required options: res: ${!res}, aggregateContent: ${!aggregateContent}`,
    );
  }
  const handlers = {
    [GraphEvents.CHAT_MODEL_END]: new ModelEndHandler({
      collectedUsage,
      req,
      res,
      streamId,
      artifactPromises,
    }),
    [GraphEvents.TOOL_END]: new ToolEndHandler(toolEndCallback, logger),
    [GraphEvents.ON_RUN_STEP]: {
      /**
       * Handle ON_RUN_STEP event.
       * @param {string} event - The event name.
       * @param {StreamEventData} data - The event data.
       * @param {GraphRunnableConfig['configurable']} [metadata] The runnable metadata.
       */
      handle: async (event, data, metadata) => {
        aggregateContent({ event, data });
        if (data?.stepDetails.type === StepTypes.TOOL_CALLS) {
          await emitEvent(res, streamId, { event, data });
        } else if (checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)) {
          await emitEvent(res, streamId, { event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          await emitEvent(res, streamId, { event, data });
        } else {
          const agentName = metadata?.name ?? 'Agent';
          const isToolCall = data?.stepDetails.type === StepTypes.TOOL_CALLS;
          const action = isToolCall ? 'performing a task...' : 'thinking...';
          await emitEvent(res, streamId, {
            event: 'on_agent_update',
            data: {
              runId: metadata?.run_id,
              message: `${agentName} is ${action}`,
            },
          });
        }
      },
    },
    [GraphEvents.ON_RUN_STEP_DELTA]: {
      /**
       * Handle ON_RUN_STEP_DELTA event.
       * @param {string} event - The event name.
       * @param {StreamEventData} data - The event data.
       * @param {GraphRunnableConfig['configurable']} [metadata] The runnable metadata.
       */
      handle: async (event, data, metadata) => {
        aggregateContent({ event, data });
        if (data?.delta.type === StepTypes.TOOL_CALLS) {
          await emitEvent(res, streamId, { event, data });
        } else if (checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)) {
          await emitEvent(res, streamId, { event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          await emitEvent(res, streamId, { event, data });
        }
      },
    },
    [GraphEvents.ON_RUN_STEP_COMPLETED]: {
      /**
       * Handle ON_RUN_STEP_COMPLETED event.
       * @param {string} event - The event name.
       * @param {StreamEventData & { result: ToolEndData }} data - The event data.
       * @param {GraphRunnableConfig['configurable']} [metadata] The runnable metadata.
       */
      handle: async (event, data, metadata) => {
        aggregateContent({ event, data });
        if (data?.result != null) {
          await emitEvent(res, streamId, { event, data });
        } else if (checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)) {
          await emitEvent(res, streamId, { event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          await emitEvent(res, streamId, { event, data });
        }
      },
    },
    [GraphEvents.ON_MESSAGE_DELTA]: {
      /**
       * Handle ON_MESSAGE_DELTA event.
       * @param {string} event - The event name.
       * @param {StreamEventData} data - The event data.
       * @param {GraphRunnableConfig['configurable']} [metadata] The runnable metadata.
       */
      handle: async (event, data, metadata) => {
        aggregateContent({ event, data });
        if (checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)) {
          await emitEvent(res, streamId, { event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          await emitEvent(res, streamId, { event, data });
        }
      },
    },
    [GraphEvents.ON_REASONING_DELTA]: {
      /**
       * Handle ON_REASONING_DELTA event.
       * @param {string} event - The event name.
       * @param {StreamEventData} data - The event data.
       * @param {GraphRunnableConfig['configurable']} [metadata] The runnable metadata.
       */
      handle: async (event, data, metadata) => {
        aggregateContent({ event, data });
        if (checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)) {
          await emitEvent(res, streamId, { event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          await emitEvent(res, streamId, { event, data });
        }
      },
    },
  };

  if (toolExecuteOptions) {
    handlers[GraphEvents.ON_TOOL_EXECUTE] = createToolExecuteHandler(toolExecuteOptions);
  }

  if (summarizationOptions?.enabled !== false) {
    handlers[GraphEvents.ON_SUMMARIZE_START] = {
      handle: async (_event, data) => {
        await emitEvent(res, streamId, {
          event: GraphEvents.ON_SUMMARIZE_START,
          data,
        });
      },
    };
    handlers[GraphEvents.ON_SUMMARIZE_DELTA] = {
      handle: async (_event, data) => {
        aggregateContent({ event: GraphEvents.ON_SUMMARIZE_DELTA, data });
        await emitEvent(res, streamId, {
          event: GraphEvents.ON_SUMMARIZE_DELTA,
          data,
        });
      },
    };
    handlers[GraphEvents.ON_SUMMARIZE_COMPLETE] = {
      handle: async (_event, data) => {
        aggregateContent({ event: GraphEvents.ON_SUMMARIZE_COMPLETE, data });
        await emitEvent(res, streamId, {
          event: GraphEvents.ON_SUMMARIZE_COMPLETE,
          data,
        });
      },
    };
  }

  handlers[GraphEvents.ON_AGENT_LOG] = { handle: agentLogHandler };

  return handlers;
}

/**
 * Helper to write attachment events either to res or to job emitter.
 * Note: Attachments are not order-sensitive like deltas, so fire-and-forget is acceptable.
 * @param {ServerResponse} res - The server response object
 * @param {string | null} streamId - The stream ID for resumable mode, or null for standard mode
 * @param {Object} attachment - The attachment data
 */
function writeAttachment(res, streamId, attachment) {
  if (streamId) {
    GenerationJobManager.emitChunk(streamId, { event: 'attachment', data: attachment });
  } else {
    res.write(`event: attachment\ndata: ${JSON.stringify(attachment)}\n\n`);
  }
}

/**
 *
 * @param {Object} params
 * @param {ServerRequest} params.req
 * @param {ServerResponse} params.res
 * @param {Promise<MongoFile | { filename: string; filepath: string; expires: number;} | null>[]} params.artifactPromises
 * @param {string | null} [params.streamId] - The stream ID for resumable mode, or null for standard mode.
 * @returns {ToolEndCallback} The tool end callback.
 */
function createToolEndCallback({ req, res, artifactPromises, streamId = null }) {
  /**
   * @type {ToolEndCallback}
   */
  return async (data, metadata) => {
    const output = data?.output;
    if (!output) {
      return;
    }

    if (!output.artifact) {
      return;
    }

    if (output.artifact[Tools.file_search]) {
      artifactPromises.push(
        (async () => {
          const user = req.user;
          const attachment = await processFileCitations({
            user,
            metadata,
            appConfig: req.config,
            toolArtifact: output.artifact,
            toolCallId: output.tool_call_id,
          });
          if (!attachment) {
            return null;
          }
          if (!streamId && !res.headersSent) {
            return attachment;
          }
          writeAttachment(res, streamId, attachment);
          return attachment;
        })().catch((error) => {
          logger.error('Error processing file citations:', error);
          return null;
        }),
      );
    }

    if (output.artifact[Tools.ui_resources]) {
      artifactPromises.push(
        (async () => {
          const attachment = {
            type: Tools.ui_resources,
            messageId: metadata.run_id,
            toolCallId: output.tool_call_id,
            conversationId: metadata.thread_id,
            [Tools.ui_resources]: output.artifact[Tools.ui_resources].data,
          };
          if (!streamId && !res.headersSent) {
            return attachment;
          }
          writeAttachment(res, streamId, attachment);
          return attachment;
        })().catch((error) => {
          logger.error('Error processing artifact content:', error);
          return null;
        }),
      );
    }

    if (output.artifact[Tools.web_search]) {
      artifactPromises.push(
        (async () => {
          const attachment = {
            type: Tools.web_search,
            messageId: metadata.run_id,
            toolCallId: output.tool_call_id,
            conversationId: metadata.thread_id,
            [Tools.web_search]: { ...output.artifact[Tools.web_search] },
          };
          if (!streamId && !res.headersSent) {
            return attachment;
          }
          writeAttachment(res, streamId, attachment);
          return attachment;
        })().catch((error) => {
          logger.error('Error processing artifact content:', error);
          return null;
        }),
      );
    }

    if (output.artifact.content) {
      /** @type {FormattedContent[]} */
      const content = output.artifact.content;
      for (let i = 0; i < content.length; i++) {
        const part = content[i];
        if (!part) {
          continue;
        }
        if (part.type !== 'image_url') {
          continue;
        }
        const { url } = part.image_url;
        artifactPromises.push(
          (async () => {
            const filename = `${output.name}_img_${nanoid()}`;
            const file_id = output.artifact.file_ids?.[i];
            const file = await saveBase64Image(url, {
              req,
              file_id,
              filename,
              endpoint: metadata.provider,
              context: FileContext.image_generation,
            });
            const fileMetadata = Object.assign(file, {
              messageId: metadata.run_id,
              toolCallId: output.tool_call_id,
              conversationId: metadata.thread_id,
            });
            if (!streamId && !res.headersSent) {
              return fileMetadata;
            }

            if (!fileMetadata) {
              return null;
            }

            writeAttachment(res, streamId, fileMetadata);
            return fileMetadata;
          })().catch((error) => {
            logger.error('Error processing artifact content:', error);
            return null;
          }),
        );
      }
      return;
    }

    const isCodeTool =
      output.name === Tools.execute_code || output.name === Constants.PROGRAMMATIC_TOOL_CALLING;
    if (!isCodeTool) {
      return;
    }

    if (!output.artifact.files) {
      return;
    }

    for (const file of output.artifact.files) {
      const { id, name } = file;
      artifactPromises.push(
        (async () => {
          const result = await loadAuthValues({
            userId: req.user.id,
            authFields: [EnvVar.CODE_API_KEY],
          });
          const fileMetadata = await processCodeOutput({
            req,
            id,
            name,
            apiKey: result[EnvVar.CODE_API_KEY],
            messageId: metadata.run_id,
            toolCallId: output.tool_call_id,
            conversationId: metadata.thread_id,
            session_id: output.artifact.session_id,
          });
          if (!streamId && !res.headersSent) {
            return fileMetadata;
          }

          if (!fileMetadata) {
            return null;
          }

          writeAttachment(res, streamId, fileMetadata);
          return fileMetadata;
        })().catch((error) => {
          logger.error('Error processing code output:', error);
          return null;
        }),
      );
    }
  };
}

/**
 * Helper to write attachment events in Open Responses format (librechat:attachment)
 * @param {ServerResponse} res - The server response object
 * @param {Object} tracker - The response tracker with sequence number
 * @param {Object} attachment - The attachment data
 * @param {Object} metadata - Additional metadata (messageId, conversationId)
 */
function writeResponsesAttachment(res, tracker, attachment, metadata) {
  const sequenceNumber = tracker.nextSequence();
  writeAttachmentEvent(res, sequenceNumber, attachment, {
    messageId: metadata.run_id,
    conversationId: metadata.thread_id,
  });
}

/**
 * Creates a tool end callback specifically for the Responses API.
 * Emits attachments as `librechat:attachment` events per the Open Responses extension spec.
 *
 * @param {Object} params
 * @param {ServerRequest} params.req
 * @param {ServerResponse} params.res
 * @param {Object} params.tracker - Response tracker with sequence number
 * @param {Promise<MongoFile | { filename: string; filepath: string; expires: number;} | null>[]} params.artifactPromises
 * @returns {ToolEndCallback} The tool end callback.
 */
function createResponsesToolEndCallback({ req, res, tracker, artifactPromises }) {
  /**
   * @type {ToolEndCallback}
   */
  return async (data, metadata) => {
    const output = data?.output;
    if (!output) {
      return;
    }

    if (!output.artifact) {
      return;
    }

    if (output.artifact[Tools.file_search]) {
      artifactPromises.push(
        (async () => {
          const user = req.user;
          const attachment = await processFileCitations({
            user,
            metadata,
            appConfig: req.config,
            toolArtifact: output.artifact,
            toolCallId: output.tool_call_id,
          });
          if (!attachment) {
            return null;
          }
          // For Responses API, emit attachment during streaming
          if (res.headersSent && !res.writableEnded) {
            writeResponsesAttachment(res, tracker, attachment, metadata);
          }
          return attachment;
        })().catch((error) => {
          logger.error('Error processing file citations:', error);
          return null;
        }),
      );
    }

    if (output.artifact[Tools.ui_resources]) {
      artifactPromises.push(
        (async () => {
          const attachment = {
            type: Tools.ui_resources,
            toolCallId: output.tool_call_id,
            [Tools.ui_resources]: output.artifact[Tools.ui_resources].data,
          };
          // For Responses API, always emit attachment during streaming
          if (res.headersSent && !res.writableEnded) {
            writeResponsesAttachment(res, tracker, attachment, metadata);
          }
          return attachment;
        })().catch((error) => {
          logger.error('Error processing artifact content:', error);
          return null;
        }),
      );
    }

    if (output.artifact[Tools.web_search]) {
      artifactPromises.push(
        (async () => {
          const attachment = {
            type: Tools.web_search,
            toolCallId: output.tool_call_id,
            [Tools.web_search]: { ...output.artifact[Tools.web_search] },
          };
          // For Responses API, always emit attachment during streaming
          if (res.headersSent && !res.writableEnded) {
            writeResponsesAttachment(res, tracker, attachment, metadata);
          }
          return attachment;
        })().catch((error) => {
          logger.error('Error processing artifact content:', error);
          return null;
        }),
      );
    }

    if (output.artifact.content) {
      /** @type {FormattedContent[]} */
      const content = output.artifact.content;
      for (let i = 0; i < content.length; i++) {
        const part = content[i];
        if (!part) {
          continue;
        }
        if (part.type !== 'image_url') {
          continue;
        }
        const { url } = part.image_url;
        artifactPromises.push(
          (async () => {
            const filename = `${output.name}_img_${nanoid()}`;
            const file_id = output.artifact.file_ids?.[i];
            const file = await saveBase64Image(url, {
              req,
              file_id,
              filename,
              endpoint: metadata.provider,
              context: FileContext.image_generation,
            });
            const fileMetadata = Object.assign(file, {
              toolCallId: output.tool_call_id,
            });

            if (!fileMetadata) {
              return null;
            }

            // For Responses API, emit attachment during streaming
            if (res.headersSent && !res.writableEnded) {
              const attachment = {
                file_id: fileMetadata.file_id,
                filename: fileMetadata.filename,
                type: fileMetadata.type,
                url: fileMetadata.filepath,
                width: fileMetadata.width,
                height: fileMetadata.height,
                tool_call_id: output.tool_call_id,
              };
              writeResponsesAttachment(res, tracker, attachment, metadata);
            }

            return fileMetadata;
          })().catch((error) => {
            logger.error('Error processing artifact content:', error);
            return null;
          }),
        );
      }
      return;
    }

    const isCodeTool =
      output.name === Tools.execute_code || output.name === Constants.PROGRAMMATIC_TOOL_CALLING;
    if (!isCodeTool) {
      return;
    }

    if (!output.artifact.files) {
      return;
    }

    for (const file of output.artifact.files) {
      const { id, name } = file;
      artifactPromises.push(
        (async () => {
          const result = await loadAuthValues({
            userId: req.user.id,
            authFields: [EnvVar.CODE_API_KEY],
          });
          const fileMetadata = await processCodeOutput({
            req,
            id,
            name,
            apiKey: result[EnvVar.CODE_API_KEY],
            messageId: metadata.run_id,
            toolCallId: output.tool_call_id,
            conversationId: metadata.thread_id,
            session_id: output.artifact.session_id,
          });

          if (!fileMetadata) {
            return null;
          }

          // For Responses API, emit attachment during streaming
          if (res.headersSent && !res.writableEnded) {
            const attachment = {
              file_id: fileMetadata.file_id,
              filename: fileMetadata.filename,
              type: fileMetadata.type,
              url: fileMetadata.filepath,
              width: fileMetadata.width,
              height: fileMetadata.height,
              tool_call_id: output.tool_call_id,
            };
            writeResponsesAttachment(res, tracker, attachment, metadata);
          }

          return fileMetadata;
        })().catch((error) => {
          logger.error('Error processing code output:', error);
          return null;
        }),
      );
    }
  };
}

const ALLOWED_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

function agentLogHandler(_event, data) {
  if (!data) {
    return;
  }
  const logFn = ALLOWED_LOG_LEVELS.has(data.level) ? logger[data.level] : logger.debug;
  const meta = typeof data.data === 'object' && data.data != null ? data.data : {};
  logFn(`[agents:${data.scope ?? 'unknown'}] ${data.message ?? ''}`, {
    ...meta,
    runId: data.runId,
    agentId: data.agentId,
  });
}

function markSummarizationUsage(usage, metadata) {
  const node = metadata?.langgraph_node;
  if (typeof node === 'string' && node.startsWith(GraphNodeKeys.SUMMARIZE)) {
    return { ...usage, usage_type: 'summarization' };
  }
  return usage;
}

const agentLogHandlerObj = { handle: agentLogHandler };

/**
 * Builds the three summarization SSE event handlers.
 * In streaming mode, each event is forwarded to the client via `res.write`.
 * In non-streaming mode, the handlers are no-ops.
 * @param {{ isStreaming: boolean, res: import('express').Response }} opts
 */
function buildSummarizationHandlers({ isStreaming, res }) {
  if (!isStreaming) {
    const noop = { handle: () => {} };
    return { on_summarize_start: noop, on_summarize_delta: noop, on_summarize_complete: noop };
  }
  const writeEvent = (name) => ({
    handle: async (_event, data) => {
      if (!res.writableEnded) {
        res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    },
  });
  return {
    on_summarize_start: writeEvent('on_summarize_start'),
    on_summarize_delta: writeEvent('on_summarize_delta'),
    on_summarize_complete: writeEvent('on_summarize_complete'),
  };
}

module.exports = {
  agentLogHandler,
  agentLogHandlerObj,
  getDefaultHandlers,
  createToolEndCallback,
  markSummarizationUsage,
  buildSummarizationHandlers,
  createResponsesToolEndCallback,
};
