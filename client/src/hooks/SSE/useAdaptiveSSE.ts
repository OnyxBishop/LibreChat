import { isAssistantsEndpoint, classifyGenerationModality } from 'librechat-data-provider';
import type { TSubmission } from 'librechat-data-provider';
import type { EventHandlerParams } from './useEventHandlers';
import useResumableSSE from './useResumableSSE';
import useSSE from './useSSE';

type ChatHelpers = Pick<
  EventHandlerParams,
  | 'setMessages'
  | 'getMessages'
  | 'setConversation'
  | 'setIsSubmitting'
  | 'newConversation'
  | 'resetLatestMessage'
>;

/**
 * Adaptive SSE hook that switches between standard and resumable modes.
 * Uses resumable streams by default, falls back to standard SSE for assistants endpoints.
 *
 * Note: Both hooks are always called to comply with React's Rules of Hooks.
 * We pass null submission to the inactive one.
 */
export default function useAdaptiveSSE(
  submission: TSubmission | null,
  chatHelpers: ChatHelpers,
  isAddedRequest = false,
  runIndex = 0,
) {
  const endpoint = submission?.conversation?.endpoint;
  const endpointType = submission?.conversation?.endpointType;
  const actualEndpoint = endpointType ?? endpoint;
  const isAssistants = isAssistantsEndpoint(actualEndpoint);
  /**
   * Image/video/tts generation on a custom endpoint is served by CustomGenerate, which
   * streams inline over the POST response (not the resumable job protocol). Those models
   * must use the standard inline `useSSE`, or the resumable hook would read the SSE body as
   * `{ streamId }`, find none, and never subscribe — leaving the spinner stuck.
   */
  const isGeneration = classifyGenerationModality(submission?.conversation?.model ?? '') != null;
  const resumableEnabled = !isAssistants && !isGeneration;

  useSSE(resumableEnabled ? null : submission, chatHelpers, isAddedRequest, runIndex);

  const { streamId } = useResumableSSE(
    resumableEnabled ? submission : null,
    chatHelpers,
    isAddedRequest,
    runIndex,
  );

  return { streamId, resumableEnabled };
}
