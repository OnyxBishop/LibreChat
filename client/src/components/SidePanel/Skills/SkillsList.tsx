import type { TSkill } from 'librechat-data-provider';
import SkillItem from './SkillItem';
import { useLocalize } from '~/hooks';

interface SkillsListProps {
  skills: TSkill[];
  isFiltered: boolean;
  onEdit: (skill: TSkill) => void;
  onToggle: (skill: TSkill, enabled: boolean) => void;
}

export default function SkillsList({ skills, isFiltered, onEdit, onToggle }: SkillsListProps) {
  const localize = useLocalize();

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
        <p className="text-sm text-text-secondary">
          {isFiltered ? localize('com_ui_no_results_found') : localize('com_ui_skills_empty')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {skills.map((skill) => (
        <SkillItem key={skill._id} skill={skill} onEdit={onEdit} onToggle={onToggle} />
      ))}
    </div>
  );
}
