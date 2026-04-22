import { useRecoilState } from 'recoil';
import { useCallback } from 'react';
import useSpeechToText from './useSpeechToText';
import store from '~/store';

const useTranscription = () => {
  const [history, setHistory] = useRecoilState(store.transcriptionHistory);

  const addTranscription = useCallback(
    (text: string) => {
      setHistory((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          speaker: 'User', // Default for now
          text,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    },
    [setHistory],
  );

  const { startRecording, stopRecording, isListening } = useSpeechToText(
    () => {}, // setText (not used for this live history view)
    (text) => addTranscription(text), // onTranscriptionComplete
  );

  return {
    isListening,
    startRecording,
    stopRecording,
    history,
  };
};

export default useTranscription;
