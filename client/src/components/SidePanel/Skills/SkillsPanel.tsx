import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { matchSorter } from 'match-sorter';
import { Button, Spinner, FilterInput, TooltipAnchor, useToastContext } from '@librechat/client';
import type { TSkill } from 'librechat-data-provider';
import { useGetSkillsQuery, useUpdateSkillMutation } from '~/data-provider';
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

  const updateSkill = useUpdateSkillMutation({
    onError: () => showToast({ message: localize('com_ui_error'), status: 'error' }),
  });

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
