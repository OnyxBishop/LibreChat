import type { Document, Types } from 'mongoose';

export interface ISkill extends Document {
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  author: Types.ObjectId;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
