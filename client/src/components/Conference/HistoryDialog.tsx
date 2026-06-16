import { OGDialog, OGDialogTemplate, Spinner } from '@librechat/client';
import { Download, Trash2, Radio, Mic, Sparkles } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { TConferenceSession } from 'librechat-data-provider';
import {
  useGetConferenceSessionsQuery,
  useDeleteConferenceSessionMutation,
} from '~/data-provider';
import { downloadTranscript } from '~/utils/conferenceTranscript';
import { useLocalize } from '~/hooks';

interface HistoryDialogProps {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}

export default function HistoryDialog({ open, setOpen }: HistoryDialogProps) {
  const localize = useLocalize();
  const { data: sessions, isLoading } = useGetConferenceSessionsQuery({ enabled: open });
  const deleteMutation = useDeleteConferenceSessionMutation();

  const labels = {
    system: localize('com_conf_system_audio'),
    mic: localize('com_conf_mic'),
    suggestions: localize('com_conf_suggestions'),
  };

  const handleDownload = (session: TConferenceSession) => downloadTranscript(session, labels);

  const main = (
    <div className="max-h-[60vh] min-h-[8rem] overflow-y-auto">
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : !sessions || sessions.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-tertiary">
          {localize('com_conf_history_empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((session) => (
            <li
              key={session._id}
              className="flex items-center gap-3 rounded-lg border border-border-light p-3"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-text-primary" title={session.title}>
                  {session.title}
                </span>
                <span className="flex items-center gap-3 text-xs text-text-tertiary">
                  {session.updatedAt && <span>{new Date(session.updatedAt).toLocaleString()}</span>}
                  <span className="flex items-center gap-1">
                    <Radio className="h-3 w-3" />
                    {session.systemSegments.length}
                  </span>
                  <span className="flex items-center gap-1">
                    <Mic className="h-3 w-3" />
                    {session.micSegments.length}
                  </span>
                  <span className="flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    {session.suggestions.length}
                  </span>
                </span>
              </div>
              <button
                onClick={() => handleDownload(session)}
                title={localize('com_conf_download')}
                className="rounded-md p-2 text-text-secondary hover:bg-surface-hover"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                onClick={() => deleteMutation.mutate(session._id)}
                disabled={deleteMutation.isLoading}
                title={localize('com_conf_delete')}
                className="rounded-md p-2 text-red-500 hover:bg-surface-hover disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <OGDialog open={open} onOpenChange={setOpen}>
      <OGDialogTemplate
        title={localize('com_conf_history')}
        className="w-11/12 md:max-w-2xl"
        main={main}
      />
    </OGDialog>
  );
}
