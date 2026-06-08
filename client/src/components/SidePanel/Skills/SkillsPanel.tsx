import { useMemo, useRef, useState } from 'react';
import { Plus, FolderUp } from 'lucide-react';
import { matchSorter } from 'match-sorter';
import { Button, Spinner, FilterInput, TooltipAnchor, useToastContext } from '@librechat/client';
import type { TSkill } from 'librechat-data-provider';
import {
  useGetSkillsQuery,
  useUpdateSkillMutation,
  useImportSkillMutation,
} from '~/data-provider';
import SkillEditor from './SkillEditor';
import SkillsList from './SkillsList';
import { useLocalize } from '~/hooks';

export default function SkillsPanel() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: skills, isLoading } = useGetSkillsQuery();
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [selectedSkill, setSelectedSkill] = useState<TSkill | null>(null);

  const zipInputRef = useRef<HTMLInputElement>(null);

  const updateSkill = useUpdateSkillMutation({
    onError: () => showToast({ message: localize('com_ui_error'), status: 'error' }),
  });

  const importSkill = useImportSkillMutation({
    onSuccess: () => showToast({ message: localize('com_ui_skill_saved'), status: 'success' }),
    onError: (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      showToast({
        message: status === 409 ? localize('com_ui_skill_exists') : localize('com_ui_error'),
        status: 'error',
      });
    },
  });

  const handleImportClick = () => zipInputRef.current?.click();

  const handleImportZip = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    const formData = new FormData();
    formData.append('file', file, encodeURIComponent(file.name));
    importSkill.mutate(formData);
  };

  const filteredSkills = useMemo(() => {
    return matchSorter(skills ?? [], searchQuery, {
      keys: ['name', 'description'],
    });
  }, [skills, searchQuery]);

  const handleEdit = (skill: TSkill) => {
    setSelectedSkill(skill);
    setView('editor');
  };

  const handleCreate = () => {
    setSelectedSkill(null);
    setView('editor');
  };

  const handleToggle = (skill: TSkill, enabled: boolean) => {
    updateSkill.mutate({ id: skill._id, data: { enabled } });
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <Spinner />
      </div>
    );
  }

  if (view === 'editor') {
    return <SkillEditor skill={selectedSkill} onBack={() => setView('list')} />;
  }

  return (
    <div className="flex h-auto w-full flex-col px-3 pb-3">
      <div role="region" aria-label={localize('com_ui_skills')} className="space-y-2">
        {/* Header: Filter + Create */}
        <div className="flex items-center gap-2">
          <FilterInput
            inputId="skill-search"
            label={localize('com_ui_skills_filter')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            containerClassName="flex-1"
          />
          <TooltipAnchor
            description={localize('com_ui_skill_import_zip')}
            side="bottom"
            render={
              <Button
                variant="outline"
                size="icon"
                className="size-9 shrink-0 bg-transparent"
                aria-label={localize('com_ui_skill_import_zip')}
                onClick={handleImportClick}
                disabled={importSkill.isLoading}
              >
                {importSkill.isLoading ? (
                  <Spinner className="size-4" />
                ) : (
                  <FolderUp className="size-4" aria-hidden="true" />
                )}
              </Button>
            }
          />
          <TooltipAnchor
            description={localize('com_ui_create_skill')}
            side="bottom"
            render={
              <Button
                variant="outline"
                size="icon"
                className="size-9 shrink-0 bg-transparent"
                aria-label={localize('com_ui_create_skill')}
                onClick={handleCreate}
              >
                <Plus className="size-4" aria-hidden="true" />
              </Button>
            }
          />
        </div>
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={handleImportZip}
        />

        {/* List */}
        <SkillsList
          skills={filteredSkills}
          isFiltered={searchQuery.length > 0}
          onEdit={handleEdit}
          onToggle={handleToggle}
        />
      </div>
    </div>
  );
}
