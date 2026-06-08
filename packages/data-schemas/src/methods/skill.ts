import { Types } from 'mongoose';
import logger from '~/config/winston';
import type { Model } from 'mongoose';
import type { ISkill } from '~/types';

export interface SkillData {
  name: string;
  description?: string;
  content?: string;
  enabled?: boolean;
}

export interface SkillIndexEntry {
  name: string;
  description: string;
}

type Author = string | Types.ObjectId;

// Factory function that takes mongoose instance and returns the methods
export function createSkillMethods(mongoose: typeof import('mongoose')) {
  const getModel = () => mongoose.models.Skill as Model<ISkill>;

  /**
   * Returns all skills owned by the author, most recently updated first.
   */
  async function getSkills(author: Author): Promise<ISkill[]> {
    try {
      const Skill = getModel();
      return (await Skill.find({ author }).sort({ updatedAt: -1 }).lean()) as unknown as ISkill[];
    } catch (error) {
      logger.error('[getSkills] Error getting skills', error);
      return [];
    }
  }

  /**
   * Returns a single skill by id for the author, or null.
   */
  async function getSkillById({
    author,
    id,
  }: {
    author: Author;
    id: string;
  }): Promise<ISkill | null> {
    const Skill = getModel();
    return (await Skill.findOne({ _id: id, author }).lean()) as unknown as ISkill | null;
  }

  /**
   * Returns a single skill by name for the author, or null.
   */
  async function getSkillByName({
    author,
    name,
  }: {
    author: Author;
    name: string;
  }): Promise<ISkill | null> {
    const Skill = getModel();
    return (await Skill.findOne({ author, name }).lean()) as unknown as ISkill | null;
  }

  /**
   * Returns a compact index (name + description) of enabled skills for the author.
   * Used to make the model aware of available skills.
   */
  async function getEnabledSkillsIndex(author: Author): Promise<SkillIndexEntry[]> {
    try {
      const Skill = getModel();
      const skills = (await Skill.find({ author, enabled: true })
        .select('name description')
        .sort({ name: 1 })
        .lean()) as unknown as Array<Pick<ISkill, 'name' | 'description'>>;
      return skills.map((skill) => ({
        name: skill.name,
        description: skill.description ?? '',
      }));
    } catch (error) {
      logger.error('[getEnabledSkillsIndex] Error building skills index', error);
      return [];
    }
  }

  /**
   * Creates a new skill. Throws on a duplicate (author, name).
   */
  async function createSkill(author: Author, data: SkillData): Promise<ISkill> {
    const Skill = getModel();
    const created = await Skill.create({
      author,
      name: data.name,
      description: data.description ?? '',
      content: data.content ?? '',
      enabled: data.enabled ?? true,
    });
    return created.toObject() as unknown as ISkill;
  }

  /**
   * Updates an existing skill by id for the author.
   */
  async function updateSkill({
    author,
    id,
    data,
  }: {
    author: Author;
    id: string;
    data: Partial<SkillData>;
  }): Promise<ISkill | null> {
    const Skill = getModel();
    return (await Skill.findOneAndUpdate({ _id: id, author }, { $set: data }, {
      new: true,
    }).lean()) as unknown as ISkill | null;
  }

  /**
   * Creates or updates a skill by (author, name). Used when the AI saves a skill.
   */
  async function upsertSkillByName(author: Author, data: SkillData): Promise<ISkill> {
    const Skill = getModel();
    const update: Partial<SkillData> = {
      name: data.name,
      description: data.description ?? '',
      content: data.content ?? '',
    };
    if (data.enabled != null) {
      update.enabled = data.enabled;
    }
    return (await Skill.findOneAndUpdate({ author, name: data.name }, { $set: update }, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }).lean()) as unknown as ISkill;
  }

  /**
   * Deletes a skill by id for the author.
   */
  async function deleteSkill({
    author,
    id,
  }: {
    author: Author;
    id: string;
  }): Promise<{ deleted: boolean }> {
    const Skill = getModel();
    const result = await Skill.findOneAndDelete({ _id: id, author });
    return { deleted: !!result };
  }

  return {
    getSkills,
    getSkillById,
    getSkillByName,
    getEnabledSkillsIndex,
    createSkill,
    updateSkill,
    upsertSkillByName,
    deleteSkill,
  };
}

export type SkillMethods = ReturnType<typeof createSkillMethods>;
