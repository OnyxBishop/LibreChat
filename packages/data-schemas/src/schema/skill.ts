import { Schema } from 'mongoose';
import type { ISkill } from '~/types';

const skillSchema: Schema<ISkill> = new Schema(
  {
    name: {
      type: String,
      required: true,
      index: true,
    },
    description: {
      type: String,
      default: '',
    },
    content: {
      type: String,
      default: '',
    },
    enabled: {
      type: Boolean,
      default: true,
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

/** A skill name is unique per author */
skillSchema.index({ author: 1, name: 1 }, { unique: true });

export default skillSchema;
