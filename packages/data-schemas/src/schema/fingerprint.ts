import { Schema } from 'mongoose';
import type { IFingerprint } from '~/types';

/** A single dossier fact. `_id: true` so the UI can edit/confirm/delete one fact. */
const factSchema = new Schema(
  {
    kind: { type: String, default: 'note' },
    label: { type: String, default: '' },
    text: { type: String, default: '' },
    status: { type: String, default: '' },
    dueDate: { type: Date },
    source: { type: String, default: 'manual' },
    sourceRefId: { type: String, default: '' },
    confirmed: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const relationSchema = new Schema(
  {
    entityId: { type: Schema.Types.ObjectId, ref: 'Fingerprint' },
    role: { type: String, default: '' },
  },
  { _id: false },
);

const sourceSchema = new Schema(
  {
    kind: { type: String, default: 'manual' },
    refId: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const fingerprintSchema: Schema<IFingerprint> = new Schema(
  {
    type: {
      type: String,
      default: 'other',
      index: true,
    },
    name: {
      type: String,
      required: true,
      index: true,
    },
    aliases: {
      type: [String],
      default: [],
    },
    summary: {
      type: String,
      default: '',
    },
    facts: {
      type: [factSchema],
      default: [],
    },
    relations: {
      type: [relationSchema],
      default: [],
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    sources: {
      type: [sourceSchema],
      default: [],
    },
    /** Semantic-search fields — hidden from default queries. */
    embedding: {
      type: [Number],
      default: undefined,
      select: false,
    },
    embeddingText: {
      type: String,
      default: '',
      select: false,
    },
    embeddingModel: {
      type: String,
      default: '',
    },
    embeddedAt: {
      type: Date,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

/** List an author's entities, most recently updated first. */
fingerprintSchema.index({ author: 1, updatedAt: -1 });
/** Type-filtered listing on the screen. */
fingerprintSchema.index({ author: 1, type: 1 });

export default fingerprintSchema;
