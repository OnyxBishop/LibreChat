import { memo } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { Bot, X, ChevronDown, Mic, MicOff } from 'lucide-react';
import useTranscription from '~/hooks/Input/useTranscription';
import { cn } from '~/utils';
import store from '~/store';

const TranscriptionWindow = memo(() => {
  const [show, setShow] = useRecoilState(store.showTranscriptionWindow);
  const [mode, setMode] = useRecoilState(store.vadMode);
  const { history, isListening, startRecording, stopRecording } = useTranscription();

  if (!show) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border bg-white p-4 shadow-lg dark:bg-gray-800">
      <div className="mb-2 flex items-center justify-between border-b pb-2">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Bot className="h-5 w-5" /> Live Transcription
        </h3>
        <button onClick={() => setShow(false)}>
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mb-4 h-64 overflow-y-auto rounded border p-2">
        {history.length === 0 && (
          <p className="text-sm text-gray-500">Transcription will appear here...</p>
        )}
        {history.map((item) => (
          <div key={item.id} className="mb-2 text-sm">
            <span className="font-bold text-blue-500">[{item.speaker}]</span>
            <span className="ml-2 text-xs text-gray-400">{item.timestamp}</span>
            <p>{item.text}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => (isListening ? stopRecording() : startRecording())}
          className={cn(
            'rounded-full p-2',
            isListening ? 'bg-red-500 text-white' : 'bg-blue-500 text-white',
          )}
        >
          {isListening ? <MicOff /> : <Mic />}
        </button>
        <button
          onClick={() => setMode(mode === 'vad' ? 'push-to-talk' : 'vad')}
          className="flex w-full items-center justify-between rounded border p-2 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          {mode === 'vad' ? 'VAD Mode' : 'Push-to-Talk'}
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
});

TranscriptionWindow.displayName = 'TranscriptionWindow';
export default TranscriptionWindow;
