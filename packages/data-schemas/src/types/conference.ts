import type { Document, Types } from 'mongoose';

/** A transcribed line of speech (system audio or the user's microphone). */
export interface IConferenceSegment {
  text: string;
  /** Wall-clock label captured on the client, e.g. "14:30:05". */
  timestamp?: string;
}

/** A suggestion the assistant streamed during the meeting. */
export interface IConferenceSuggestion {
  text: string;
}

/** A saved conference session: the full transcript plus assistant suggestions. */
export interface IConferenceSession extends Document {
  title: string;
  author: Types.ObjectId;
  /** Transcript of the other participants (system/tab audio). */
  systemSegments: IConferenceSegment[];
  /** Transcript of the user's own microphone (never sent to the assistant). */
  micSegments: IConferenceSegment[];
  /** Assistant reply suggestions produced during the session. */
  suggestions: IConferenceSuggestion[];
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
