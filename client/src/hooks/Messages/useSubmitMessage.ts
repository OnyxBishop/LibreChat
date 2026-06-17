import { useCallback } from 'react';
import { useRecoilValue, useSetRecoilState, useResetRecoilState } from 'recoil';
import { replaceSpecialVars } from 'librechat-data-provider';
import { useToastContext } from '@librechat/client';
import { useChatContext, useChatFormContext, useAddedChatContext } from '~/Providers';
import { useExtractChatFingerprintFactsMutation } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { mainTextareaId } from '~/common';
import useLocalize from '~/hooks/useLocalize';
import store from '~/store';

/** Don't fire fingerprint auto-extraction on trivial messages ("ok", "спасибо"). */
const FP_EXTRACT_MIN_CHARS = 12;

export default function useSubmitMessage() {
  const { user } = useAuthContext();
  const localize = useLocalize();
  const methods = useChatFormContext();
  const { showToast } = useToastContext();
  const { conversation: addedConvo } = useAddedChatContext();
  const { ask, index, conversation, getMessages, setMessages } = useChatContext();
  const latestMessage = useRecoilValue(store.latestMessageFamily(index));

  const autoSendPrompts = useRecoilValue(store.autoSendPrompts);
  const setActivePrompt = useSetRecoilState(store.activePromptByIndex(index));
  const mentionedFingerprintIds = useRecoilValue(store.mentionedFingerprintIds);
  const resetMentionedFingerprints = useResetRecoilState(store.mentionedFingerprintIds);
  const extractChatFacts = useExtractChatFingerprintFactsMutation();

  const submitMessage = useCallback(
    (data?: { text: string }) => {
      if (!data) {
        return console.warn('No data provided to submitMessage');
      }
      const rootMessages = getMessages();
      const isLatestInRootMessages = rootMessages?.some(
        (message) => message.messageId === latestMessage?.messageId,
      );
      if (!isLatestInRootMessages && latestMessage) {
        setMessages([...(rootMessages || []), latestMessage]);
      }

      ask(
        {
          text: data.text,
        },
        {
          addedConvo: addedConvo ?? undefined,
        },
      );

      /**
       * Fire-and-forget: let the AI draft CRM facts about the entities this turn is about
       * (explicitly @-mentioned + semantically matched). Runs in parallel with the turn —
       * never blocks it; the server no-ops when nothing relevant or no extract model is set.
       */
      if (data.text.trim().length >= FP_EXTRACT_MIN_CHARS) {
        extractChatFacts.mutate(
          {
            text: data.text,
            model: conversation?.model ?? undefined,
            fingerprintIds: mentionedFingerprintIds.length ? mentionedFingerprintIds : undefined,
          },
          {
            onSuccess: (result) => {
              if (result.count > 0) {
                showToast({
                  status: 'success',
                  message: localize('com_fp_chat_extract_toast', { count: result.count }),
                });
              }
            },
          },
        );
      }

      methods.reset();
      resetMentionedFingerprints();
    },
    [
      ask,
      methods,
      addedConvo,
      setMessages,
      getMessages,
      latestMessage,
      conversation,
      mentionedFingerprintIds,
      extractChatFacts,
      showToast,
      localize,
      resetMentionedFingerprints,
    ],
  );

  const submitPrompt = useCallback(
    (text: string) => {
      const parsedText = replaceSpecialVars({ text, user });
      if (autoSendPrompts) {
        submitMessage({ text: parsedText });
        return;
      }

      const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
      const currentText = textarea?.value ?? methods.getValues('text');
      const newText = currentText.trim().length > 1 ? `\n${parsedText}` : parsedText;
      setActivePrompt(newText);
    },
    [autoSendPrompts, submitMessage, setActivePrompt, methods, user],
  );

  return { submitMessage, submitPrompt };
}
