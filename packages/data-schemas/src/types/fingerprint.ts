import type { Document, Types } from 'mongoose';

/** The kind of a single dossier fact. */
export type FingerprintFactKind = 'attribute' | 'they_owe_us' | 'we_owe_them' | 'note';

/** Where a fact/entity originated. */
export type FingerprintSourceKind = 'manual' | 'chat' | 'conference';

/** A single piece of knowledge about an entity (attribute, obligation, or note). */
export interface IFingerprintFact {
  /** Groups the fact in the UI; also gates what gets embedded/injected. */
  kind: FingerprintFactKind;
  /** Optional short key, e.g. "Email", "Invoice #42". */
  label?: string;
  /** Freeform value/body of the fact. */
  text: string;
  /** Optional lifecycle for obligations, e.g. "open" | "done". */
  status?: string;
  /** Optional due date for obligations. */
  dueDate?: Date;
  /** Provenance of this fact. */
  source?: FingerprintSourceKind;
  /** Conversation / conference session id this fact came from. */
  sourceRefId?: string;
  /** false => AI-drafted, awaiting user confirmation (not embedded/injected yet). */
  confirmed?: boolean;
  createdAt?: Date;
}

/** A typed link from this entity to another fingerprint. */
export interface IFingerprintRelation {
  entityId: Types.ObjectId;
  /** e.g. "works_at", "owns", "reports_to", "related". */
  role?: string;
}

/** Provenance entry for the entity as a whole. */
export interface IFingerprintSource {
  kind: FingerprintSourceKind;
  refId?: string;
  at?: Date;
}

/**
 * A "digital fingerprint": a persistent dossier for a person, company, product,
 * product type, or any other entity worth always remembering.
 */
export interface IFingerprint extends Document {
  /** Discriminator: person | company | product | product_type | other (extensible). */
  type: string;
  name: string;
  /** Alternate names/spellings used for dedup and possible name matching. */
  aliases: string[];
  /** One-line description / role. */
  summary: string;
  /** Dossier facts (attributes, obligations both ways, notes). */
  facts: IFingerprintFact[];
  /** Links to other fingerprints. */
  relations: IFingerprintRelation[];
  tags: string[];
  /** Provenance trail (manual / chat / conference). */
  sources: IFingerprintSource[];

  /** Semantic-search vector (hidden from API responses via schema `select: false`). */
  embedding?: number[];
  /** The canonical text the embedding was derived from. */
  embeddingText?: string;
  /** Model that produced the embedding (gates re-embedding when it changes). */
  embeddingModel?: string;
  embeddedAt?: Date;

  author: Types.ObjectId;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
