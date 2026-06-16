import { Schema } from 'mongoose';
import type { IConferenceSession } from '~/types';

const segmentSchema = new Schema(
  {
    text: { type: String, default: '' },
    timestamp: { type: String, default: '' },
  },
  { _id: false },
);

const suggestionSchema = new Schema(
  {
    text: { type: String, default: '' },
  },
  { _id: false },
);

const conferenceSessionSchema: Schema<IConferenceSession> = new Schema(
  {
    title: {
      type: String,
      default: '',
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    systemSegments: {
      type: [segmentSchema],
      default: [],
    },
    micSegments: {
      type: [segmentSchema],
      default: [],
    },
    suggestions: {
      type: [suggestionSchema],
      default: [],
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

/** List sessions for an author, most recently updated first. */
conferenceSessionSchema.index({ author: 1, updatedAt: -1 });

export default conferenceSessionSchema;
