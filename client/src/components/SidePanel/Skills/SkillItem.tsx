import { Sparkles, ChevronRight } from 'lucide-react';
import { Switch } from '@librechat/client';
import type { TSkill } from 'librechat-data-provider';
import { skillColor } from '~/utils/skills';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface SkillItemProps {
  skill: TSkill;
  onEdit: (skill: TSkill) => void;
  onToggle: (skill: TSkill, enabled: boolean) => void;
}

export default function SkillItem({ skill, onEdit, onToggle }: SkillItemProps) {
  const localize = useLocalize();

  return (
    <button
      type="button"
      onClick={() => onEdit(skill)}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
        'border border-border-light bg-transparent',
        'hover:bg-surface-secondary',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy',
      )}
    >
      {/* Colored icon */}
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg text-white',
          skillColor(skill.name),
        )}
      >
        <Sparkles className="size-4" aria-hidden="true" />
      </div>

      {/* Name + description */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-text-primary">{skill.name}</div>
        {skill.description ? (
          <div className="truncate text-xs text-text-secondary" title={skill.description}>
            {skill.description}
          </div>
        ) : null}
      </div>

      {/* Enable toggle */}
      <div
        role="presentation"
        onClick={(e) => e.stopPropagation()}
        className="shrink-0"
      >
        <Switch
          checked={skill.enabled}
          onCheckedChange={(checked) => onToggle(skill, checked)}
          aria-label={localize('com_ui_skill_enabled')}
          className="h-5 w-9"
        />
      </div>

      <ChevronRight
        className="size-4 shrink-0 text-text-secondary opacity-60"
        aria-hidden="true"
      />
    </button>
  );
}
