import skillSchema from '~/schema/skill';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import type { ISkill } from '~/types/skill';

export function createSkillModel(mongoose: typeof import('mongoose')) {
  applyTenantIsolation(skillSchema);
  return mongoose.models.Skill || mongoose.model<ISkill>('Skill', skillSchema);
}
