import fingerprintSchema from '~/schema/fingerprint';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import type { IFingerprint } from '~/types/fingerprint';

export function createFingerprintModel(mongoose: typeof import('mongoose')) {
  applyTenantIsolation(fingerprintSchema);
  return (
    mongoose.models.Fingerprint || mongoose.model<IFingerprint>('Fingerprint', fingerprintSchema)
  );
}
