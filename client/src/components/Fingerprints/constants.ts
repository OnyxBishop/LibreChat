import type { TranslationKeys } from '~/hooks/useLocalize';

/** Entity types (extensible). Stored as a plain string on the model. */
export const FINGERPRINT_TYPES = ['person', 'company', 'product', 'product_type', 'other'] as const;
export type FingerprintType = (typeof FINGERPRINT_TYPES)[number];

/** Fact kinds shown as separate groups in the editor. */
export const FACT_KINDS = ['attribute', 'they_owe_us', 'we_owe_them', 'note'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const TYPE_LABEL_KEYS: Record<string, TranslationKeys> = {
  person: 'com_fp_type_person',
  company: 'com_fp_type_company',
  product: 'com_fp_type_product',
  product_type: 'com_fp_type_product_type',
  other: 'com_fp_type_other',
};

export const FACT_KIND_LABEL_KEYS: Record<FactKind, TranslationKeys> = {
  attribute: 'com_fp_fact_attribute',
  they_owe_us: 'com_fp_fact_they_owe_us',
  we_owe_them: 'com_fp_fact_we_owe_them',
  note: 'com_fp_fact_note',
};
