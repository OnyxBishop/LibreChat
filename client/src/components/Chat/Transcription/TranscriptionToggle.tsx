import { memo } from 'react';
import { useRecoilState } from 'recoil';
import { Mic } from 'lucide-react';
import store from '~/store';
import { cn } from '~/utils';

const TranscriptionToggle = memo(() => {
  const [show, setShow] = useRecoilState(store.showTranscriptionWindow);

  return (
    <button
      onClick={() => setShow(!show)}
      className={cn(
        'flex items-center gap-2 rounded-md p-2 hover:bg-black/10 dark:hover:bg-white/10',
        show ? 'bg-black/10 dark:bg-white/10' : ''
      )}
      title="Toggle Transcription Window"
    >
      <Mic className="h-5 w-5" />
    </button>
  );
});

TranscriptionToggle.displayName = 'TranscriptionToggle';
export default TranscriptionToggle;