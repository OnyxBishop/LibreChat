import { Types } from 'mongoose';
import logger from '~/config/winston';
import type { Model } from 'mongoose';
import type { IConferenceSession, IConferenceSegment, IConferenceSuggestion } from '~/types';

export interface ConferenceSessionData {
  title?: string;
  systemSegments?: IConferenceSegment[];
  micSegments?: IConferenceSegment[];
  suggestions?: IConferenceSuggestion[];
}

type Author = string | Types.ObjectId;

// Factory function that takes mongoose instance and returns the methods
export function createConferenceSessionMethods(mongoose: typeof import('mongoose')) {
  const getModel = () => mongoose.models.ConferenceSession as Model<IConferenceSession>;

  /**
   * Returns all conference sessions owned by the author, most recently updated first.
   */
  async function getConferenceSessions(author: Author): Promise<IConferenceSession[]> {
    try {
      const ConferenceSession = getModel();
      return (await ConferenceSession.find({ author })
        .sort({ updatedAt: -1 })
        .lean()) as unknown as IConferenceSession[];
    } catch (error) {
      logger.error('[getConferenceSessions] Error getting conference sessions', error);
      return [];
    }
  }

  /**
   * Creates a new conference session for the author.
   */
  async function createConferenceSession(
    author: Author,
    data: ConferenceSessionData,
  ): Promise<IConferenceSession> {
    const ConferenceSession = getModel();
    const created = await ConferenceSession.create({
      author,
      title: data.title ?? '',
      systemSegments: data.systemSegments ?? [],
      micSegments: data.micSegments ?? [],
      suggestions: data.suggestions ?? [],
    });
    return created.toObject() as unknown as IConferenceSession;
  }

  /**
   * Updates an existing conference session by id for the author.
   */
  async function updateConferenceSession({
    author,
    id,
    data,
  }: {
    author: Author;
    id: string;
    data: ConferenceSessionData;
  }): Promise<IConferenceSession | null> {
    const ConferenceSession = getModel();
    return (await ConferenceSession.findOneAndUpdate({ _id: id, author }, { $set: data }, {
      new: true,
    }).lean()) as unknown as IConferenceSession | null;
  }

  /**
   * Deletes a conference session by id for the author.
   */
  async function deleteConferenceSession({
    author,
    id,
  }: {
    author: Author;
    id: string;
  }): Promise<{ deleted: boolean }> {
    const ConferenceSession = getModel();
    const result = await ConferenceSession.findOneAndDelete({ _id: id, author });
    return { deleted: !!result };
  }

  return {
    getConferenceSessions,
    createConferenceSession,
    updateConferenceSession,
    deleteConferenceSession,
  };
}

export type ConferenceSessionMethods = ReturnType<typeof createConferenceSessionMethods>;
