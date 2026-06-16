import conferenceSessionSchema from '~/schema/conference';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import type { IConferenceSession } from '~/types/conference';

export function createConferenceSessionModel(mongoose: typeof import('mongoose')) {
  applyTenantIsolation(conferenceSessionSchema);
  return (
    mongoose.models.ConferenceSession ||
    mongoose.model<IConferenceSession>('ConferenceSession', conferenceSessionSchema)
  );
}
