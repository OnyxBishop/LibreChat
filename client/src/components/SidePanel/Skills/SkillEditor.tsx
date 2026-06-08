import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Upload, Download, Paperclip, X, Archive } from 'lucide-react';
import { Trans } from 'react-i18next';
import {
  Label,
  Button,
  Spinner,
  OGDialog,
  TrashIcon,
  TooltipAnchor,
  OGDialogTrigger,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import { dataService } from 'librechat-data-provider';
import type { TSkill } from 'librechat-data-provider';
import {
  useCreateSkillMutation,
  useUpdateSkillMutation,
  useDeleteSkillMutation,
  useGetSkillFilesQuery,
  useUploadSkillFileMutation,
  useDeleteSkillFileMutation,
} from '~/data-provider';
import { parseSkillMarkdown, buildSkillMarkdown } from '~/utils/skills';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface SkillEditorProps {
  skill: TSkill | null;
  onBack: () => void;
}

const NEW_SKILL_TEMPLATE = `---
name: my-skill
description: When to use this skill (the model reads this to decide relevance)
---

# My Skill

Step-by-step instructions the AI should follow when this skill is loaded.

## Bundled files (optional)
Attach scripts or reference files below, then tell the AI how to use them:
- Read a reference with the \`read_skill_file\` tool, e.g. read \`reference.md\`.
- Run a script with the \`run_skill_script\` tool, e.g. run \`fetch.sh\` with args.
`;

export default function SkillEditor({ skill, onBack }: SkillEditorProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [text, setText] = useState<string>(() =>
    skill ? buildSkillMarkdown(skill) : NEW_SKILL_TEMPLATE,
  );

  useEffect(() => {
    setText(skill ? buildSkillMarkdown(skill) : NEW_SKILL_TEMPLATE);
  }, [skill]);

  const handleError = (error: unknown) => {
    const axiosError = error as { response?: { status?: number } };
    if (axiosError?.response?.status === 409) {
      showToast({ message: localize('com_ui_skill_exists'), status: 'error' });
      return;
    }
    showToast({ message: localize('com_ui_error'), status: 'error' });
  };

  const onSaved = () => {
    showToast({ message: localize('com_ui_skill_saved'), status: 'success' });
    onBack();
  };

  const createSkill = useCreateSkillMutation({ onSuccess: onSaved, onError: handleError });
  const updateSkill = useUpdateSkillMutation({ onSuccess: onSaved, onError: handleError });
  const deleteSkill = useDeleteSkillMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_skill_deleted'), status: 'success' });
      setDeleteOpen(false);
      onBack();
    },
    onError: handleError,
  });

  const isSaving = createSkill.isLoading || updateSkill.isLoading;

  const bundleInputRef = useRef<HTMLInputElement>(null);
  const skillFilesQuery = useGetSkillFilesQuery(skill?._id ?? '', { enabled: !!skill });
  const uploadFile = useUploadSkillFileMutation({
    onError: () => showToast({ message: localize('com_ui_error'), status: 'error' }),
  });
  const deleteFile = useDeleteSkillFileMutation({
    onError: () => showToast({ message: localize('com_ui_error'), status: 'error' }),
  });
  const bundleFiles = skillFilesQuery.data ?? [];

  const handleBundleUploadClick = () => bundleInputRef.current?.click();

  const handleBundleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !skill) {
      return;
    }
    const formData = new FormData();
    formData.append('file', file, encodeURIComponent(file.name));
    uploadFile.mutate({ id: skill._id, formData });
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSave = () => {
    const parsed = parseSkillMarkdown(text);
    if (!parsed.name) {
      showToast({ message: localize('com_ui_skill_name_required'), status: 'error' });
      return;
    }
    if (skill) {
      updateSkill.mutate({
        id: skill._id,
        data: { name: parsed.name, description: parsed.description, content: parsed.content },
      });
    } else {
      createSkill.mutate({
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
      });
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        setText(result);
        showToast({ message: localize('com_ui_skill_imported'), status: 'success' });
      }
    };
    reader.onerror = () => showToast({ message: localize('com_ui_error'), status: 'error' });
    reader.readAsText(file);
  };

  const triggerDownload = (blob: Blob, fileName: string) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const handleExport = () => {
    const parsed = parseSkillMarkdown(text);
    triggerDownload(new Blob([text], { type: 'text/markdown' }), `${parsed.name || 'skill'}.md`);
  };

  const handleExportZip = async () => {
    if (!skill) {
      return;
    }
    try {
      const response = await dataService.exportSkill(skill._id);
      const fileName = `${parseSkillMarkdown(text).name || skill.name || 'skill'}.zip`;
      triggerDownload(new Blob([response.data], { type: 'application/zip' }), fileName);
    } catch {
      showToast({ message: localize('com_ui_error'), status: 'error' });
    }
  };

  return (
    <div className="flex h-full w-full flex-col gap-3 px-3 pb-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <TooltipAnchor
          description={localize('com_ui_back')}
          side="bottom"
          render={
            <Button
              variant="outline"
              size="icon"
              className="size-9 shrink-0 bg-transparent"
              aria-label={localize('com_ui_back')}
              onClick={onBack}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Button>
          }
        />
        <div className="flex-1 truncate text-sm font-semibold text-text-primary">
          {skill ? skill.name : localize('com_ui_new_skill')}
        </div>
        <TooltipAnchor
          description={localize('com_ui_skill_import')}
          side="bottom"
          render={
            <Button
              variant="outline"
              size="icon"
              className="size-9 shrink-0 bg-transparent"
              aria-label={localize('com_ui_skill_import')}
              onClick={handleImportClick}
            >
              <Upload className="size-4" aria-hidden="true" />
            </Button>
          }
        />
        <TooltipAnchor
          description={localize('com_ui_skill_export')}
          side="bottom"
          render={
            <Button
              variant="outline"
              size="icon"
              className="size-9 shrink-0 bg-transparent"
              aria-label={localize('com_ui_skill_export')}
              onClick={handleExport}
            >
              <Download className="size-4" aria-hidden="true" />
            </Button>
          }
        />
        {skill && (
          <TooltipAnchor
            description={localize('com_ui_skill_export_zip')}
            side="bottom"
            render={
              <Button
                variant="outline"
                size="icon"
                className="size-9 shrink-0 bg-transparent"
                aria-label={localize('com_ui_skill_export_zip')}
                onClick={handleExportZip}
              >
                <Archive className="size-4" aria-hidden="true" />
              </Button>
            }
          />
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* Editor */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <Label htmlFor="skill-content" className="text-sm font-medium text-text-primary">
          {localize('com_ui_skill_content')}
        </Label>
        <textarea
          id="skill-content"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className={cn(
            'min-h-[320px] w-full flex-1 resize-none rounded-lg border border-border-light bg-transparent',
            'px-3 py-2 font-mono text-xs text-text-primary',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy',
          )}
        />
      </div>

      {/* Bundle files (only for an existing skill) */}
      {skill && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-text-primary">
              {localize('com_ui_skill_files')}
            </Label>
            <TooltipAnchor
              description={localize('com_ui_skill_file_add')}
              side="bottom"
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8 shrink-0 bg-transparent"
                  aria-label={localize('com_ui_skill_file_add')}
                  onClick={handleBundleUploadClick}
                  disabled={uploadFile.isLoading}
                >
                  {uploadFile.isLoading ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Paperclip className="size-4" aria-hidden="true" />
                  )}
                </Button>
              }
            />
          </div>
          <input
            ref={bundleInputRef}
            type="file"
            className="hidden"
            onChange={handleBundleFile}
          />
          {bundleFiles.length === 0 ? (
            <p className="text-xs text-text-secondary">{localize('com_ui_skill_files_empty')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {bundleFiles.map((file) => (
                <li
                  key={file.name}
                  className="flex items-center gap-2 rounded-md border border-border-light px-2 py-1 text-xs"
                >
                  <span className="flex-1 truncate font-mono text-text-primary" title={file.name}>
                    {file.name}
                  </span>
                  <span className="shrink-0 text-text-secondary">{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    aria-label={localize('com_ui_delete')}
                    className="shrink-0 text-text-secondary hover:text-text-primary"
                    onClick={() => deleteFile.mutate({ id: skill._id, name: file.name })}
                    disabled={deleteFile.isLoading}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-2">
        {skill ? (
          <OGDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <OGDialogTrigger asChild>
              <Button
                variant="outline"
                className="text-text-secondary hover:text-text-primary"
                aria-label={localize('com_ui_delete_skill')}
                onClick={() => setDeleteOpen(true)}
              >
                {deleteSkill.isLoading ? (
                  <Spinner className="size-4" />
                ) : (
                  <TrashIcon className="size-4" aria-hidden="true" />
                )}
              </Button>
            </OGDialogTrigger>
            <OGDialogTemplate
              showCloseButton={false}
              title={localize('com_ui_delete_skill')}
              className="w-11/12 max-w-lg"
              main={
                <Label className="text-left text-sm font-medium">
                  <Trans
                    i18nKey="com_ui_delete_confirm_strong"
                    values={{ title: skill.name }}
                    components={{ strong: <strong /> }}
                  />
                </Label>
              }
              selection={{
                selectHandler: () => deleteSkill.mutate(skill._id),
                selectClasses:
                  'bg-red-700 dark:bg-red-600 hover:bg-red-800 dark:hover:bg-red-800 text-white',
                selectText: localize('com_ui_delete'),
              }}
            />
          </OGDialog>
        ) : (
          <div />
        )}

        <Button
          type="button"
          variant="submit"
          onClick={handleSave}
          aria-label={localize('com_ui_save')}
          disabled={isSaving}
          className="text-white"
        >
          {isSaving ? <Spinner className="size-4" /> : localize('com_ui_save')}
        </Button>
      </div>
    </div>
  );
}
