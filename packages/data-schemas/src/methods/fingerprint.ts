import { Types } from 'mongoose';
import logger from '~/config/winston';
import type { Model } from 'mongoose';
import type {
  IFingerprint,
  IFingerprintFact,
  IFingerprintRelation,
  IFingerprintSource,
} from '~/types';

export interface FingerprintData {
  type?: string;
  name?: string;
  aliases?: string[];
  summary?: string;
  facts?: IFingerprintFact[];
  relations?: IFingerprintRelation[];
  tags?: string[];
  sources?: IFingerprintSource[];
}

/** A semantic-search result: the entity (without its raw vector) plus a cosine score. */
export type FingerprintSearchHit = IFingerprint & { score: number };

type Author = string | Types.ObjectId;

/** Cosine similarity between two equal-length vectors. Returns 0 on any degenerate input. */
function cosine(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Drops the heavy/secret embedding fields from a lean fingerprint doc. */
function stripVector(doc: IFingerprint): IFingerprint {
  const clone = { ...doc } as IFingerprint & { embedding?: number[]; embeddingText?: string };
  delete clone.embedding;
  delete clone.embeddingText;
  return clone;
}

// Factory function that takes mongoose instance and returns the methods
export function createFingerprintMethods(mongoose: typeof import('mongoose')) {
  const getModel = () => mongoose.models.Fingerprint as Model<IFingerprint>;

  /** Lists the author's entities (optionally filtered by type), newest-updated first. */
  async function getFingerprints(
    author: Author,
    options: { type?: string } = {},
  ): Promise<IFingerprint[]> {
    try {
      const Fingerprint = getModel();
      const filter: Record<string, unknown> = { author };
      if (options.type) {
        filter.type = options.type;
      }
      return (await Fingerprint.find(filter)
        .sort({ updatedAt: -1 })
        .lean()) as unknown as IFingerprint[];
    } catch (error) {
      logger.error('[getFingerprints] Error getting fingerprints', error);
      return [];
    }
  }

  /** Returns one entity owned by the author. */
  async function getFingerprintById({
    author,
    id,
  }: {
    author: Author;
    id: string;
  }): Promise<IFingerprint | null> {
    const Fingerprint = getModel();
    return (await Fingerprint.findOne({
      _id: id,
      author,
    }).lean()) as unknown as IFingerprint | null;
  }

  /** Creates a new entity for the author. */
  async function createFingerprint(
    author: Author,
    data: FingerprintData,
  ): Promise<IFingerprint> {
    const Fingerprint = getModel();
    const created = await Fingerprint.create({
      author,
      type: data.type ?? 'other',
      name: data.name ?? '',
      aliases: data.aliases ?? [],
      summary: data.summary ?? '',
      facts: data.facts ?? [],
      relations: data.relations ?? [],
      tags: data.tags ?? [],
      sources: data.sources ?? [],
    });
    return created.toObject() as unknown as IFingerprint;
  }

  /** Updates an entity by id for the author. */
  async function updateFingerprint({
    author,
    id,
    data,
  }: {
    author: Author;
    id: string;
    data: FingerprintData;
  }): Promise<IFingerprint | null> {
    const Fingerprint = getModel();
    return (await Fingerprint.findOneAndUpdate({ _id: id, author }, { $set: data }, {
      new: true,
    }).lean()) as unknown as IFingerprint | null;
  }

  /** Deletes an entity by id for the author. */
  async function deleteFingerprint({
    author,
    id,
  }: {
    author: Author;
    id: string;
  }): Promise<{ deleted: boolean }> {
    const Fingerprint = getModel();
    const result = await Fingerprint.findOneAndDelete({ _id: id, author });
    return { deleted: !!result };
  }

  /** Appends facts to an entity (used for AI-drafted, unconfirmed facts). */
  async function appendFingerprintFacts({
    author,
    id,
    facts,
  }: {
    author: Author;
    id: string;
    facts: IFingerprintFact[];
  }): Promise<IFingerprint | null> {
    const Fingerprint = getModel();
    return (await Fingerprint.findOneAndUpdate(
      { _id: id, author },
      { $push: { facts: { $each: facts } } },
      { new: true },
    ).lean()) as unknown as IFingerprint | null;
  }

  /** Stores the semantic-search vector for an entity (separate from the public update path). */
  async function setFingerprintEmbedding({
    author,
    id,
    embedding,
    embeddingText,
    embeddingModel,
  }: {
    author: Author;
    id: string;
    embedding: number[];
    embeddingText: string;
    embeddingModel: string;
  }): Promise<IFingerprint | null> {
    const Fingerprint = getModel();
    return (await Fingerprint.findOneAndUpdate(
      { _id: id, author },
      { $set: { embedding, embeddingText, embeddingModel, embeddedAt: new Date() } },
      { new: true },
    ).lean()) as unknown as IFingerprint | null;
  }

  /** Entities lacking a current vector (missing, empty, or produced by a different model). */
  async function getFingerprintsNeedingEmbedding(
    author: Author,
    { model }: { model: string },
  ): Promise<IFingerprint[]> {
    const Fingerprint = getModel();
    return (await Fingerprint.find({
      author,
      $or: [
        { embedding: { $exists: false } },
        { embedding: { $size: 0 } },
        { embeddingModel: { $ne: model } },
      ],
    })
      .select('+embedding +embeddingText')
      .lean()) as unknown as IFingerprint[];
  }

  /**
   * Brute-force cosine semantic search over the author's stored embeddings.
   * Takes a ready query vector (the caller embeds the query text), so this stays
   * a pure data operation — the seam a pgvector backend would slot into later.
   */
  async function semanticSearch({
    author,
    queryVector,
    limit = 5,
    minScore = 0,
  }: {
    author: Author;
    queryVector: number[];
    limit?: number;
    minScore?: number;
  }): Promise<FingerprintSearchHit[]> {
    try {
      const Fingerprint = getModel();
      const docs = (await Fingerprint.find({
        author,
        embedding: { $exists: true, $ne: [] },
      })
        .select('+embedding')
        .lean()) as unknown as IFingerprint[];

      return docs
        .map((doc) => ({
          ...stripVector(doc),
          score: cosine(queryVector, doc.embedding ?? []),
        }))
        .filter((hit) => hit.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (error) {
      logger.error('[semanticSearch] Error searching fingerprints', error);
      return [];
    }
  }

  return {
    getFingerprints,
    getFingerprintById,
    createFingerprint,
    updateFingerprint,
    deleteFingerprint,
    appendFingerprintFacts,
    setFingerprintEmbedding,
    getFingerprintsNeedingEmbedding,
    semanticSearch,
  };
}

export type FingerprintMethods = ReturnType<typeof createFingerprintMethods>;
