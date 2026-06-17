import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createFingerprintMethods } from './fingerprint';
import { createModels } from '~/models';
import type { IFingerprint } from '~/types';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let Fingerprint: mongoose.Model<IFingerprint>;
let methods: ReturnType<typeof createFingerprintMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  const models = createModels(mongoose);
  Object.assign(mongoose.models, models);
  Fingerprint = mongoose.models.Fingerprint;
  methods = createFingerprintMethods(mongoose);

  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Fingerprint.deleteMany({});
});

describe('Fingerprint methods', () => {
  const author = new mongoose.Types.ObjectId().toString();
  const otherAuthor = new mongoose.Types.ObjectId().toString();

  describe('CRUD + author isolation', () => {
    it('creates, reads, updates and deletes an entity scoped to its author', async () => {
      const created = await methods.createFingerprint(author, {
        type: 'person',
        name: 'Alice',
        aliases: ['Al'],
        summary: 'A client',
        facts: [{ kind: 'they_owe_us', text: 'Invoice #1', confirmed: true }],
        tags: ['vip'],
      });
      expect(created.name).toBe('Alice');
      const id = String(created._id);

      const fetched = await methods.getFingerprintById({ author, id });
      expect(fetched?.name).toBe('Alice');
      expect(fetched?.facts).toHaveLength(1);

      const list = await methods.getFingerprints(author);
      expect(list).toHaveLength(1);

      const updated = await methods.updateFingerprint({
        author,
        id,
        data: { summary: 'A key client' },
      });
      expect(updated?.summary).toBe('A key client');

      const { deleted } = await methods.deleteFingerprint({ author, id });
      expect(deleted).toBe(true);
      expect(await methods.getFingerprintById({ author, id })).toBeNull();
    });

    it('does not leak entities across authors', async () => {
      await methods.createFingerprint(author, { type: 'company', name: 'Acme' });
      expect(await methods.getFingerprints(otherAuthor)).toHaveLength(0);
      expect(await methods.getFingerprints(author)).toHaveLength(1);
    });
  });

  describe('semanticSearch', () => {
    it('ranks by cosine similarity and never returns the raw vector', async () => {
      const a = await methods.createFingerprint(author, { type: 'person', name: 'Vector A' });
      const b = await methods.createFingerprint(author, { type: 'person', name: 'Vector B' });

      await methods.setFingerprintEmbedding({
        author,
        id: String(a._id),
        embedding: [1, 0, 0],
        embeddingText: 'a',
        embeddingModel: 'test-model',
      });
      await methods.setFingerprintEmbedding({
        author,
        id: String(b._id),
        embedding: [0, 1, 0],
        embeddingText: 'b',
        embeddingModel: 'test-model',
      });

      const hits = await methods.semanticSearch({ author, queryVector: [0.9, 0.1, 0], limit: 5 });
      expect(hits).toHaveLength(2);
      expect(hits[0].name).toBe('Vector A');
      expect(hits[0].score).toBeGreaterThan(hits[1].score);
      expect((hits[0] as { embedding?: number[] }).embedding).toBeUndefined();
    });

    it('respects the limit and excludes entities without a vector', async () => {
      const a = await methods.createFingerprint(author, { type: 'person', name: 'Embedded' });
      await methods.createFingerprint(author, { type: 'person', name: 'NoVector' });
      await methods.setFingerprintEmbedding({
        author,
        id: String(a._id),
        embedding: [1, 0],
        embeddingText: 'x',
        embeddingModel: 'test-model',
      });

      const hits = await methods.semanticSearch({ author, queryVector: [1, 0], limit: 1 });
      expect(hits).toHaveLength(1);
      expect(hits[0].name).toBe('Embedded');
    });
  });

  describe('getFingerprintsNeedingEmbedding', () => {
    it('returns entities with missing or stale-model vectors only', async () => {
      const fresh = await methods.createFingerprint(author, { type: 'person', name: 'Fresh' });
      const stale = await methods.createFingerprint(author, { type: 'person', name: 'Stale' });
      await methods.createFingerprint(author, { type: 'person', name: 'Missing' });

      await methods.setFingerprintEmbedding({
        author,
        id: String(fresh._id),
        embedding: [1, 0],
        embeddingText: 'f',
        embeddingModel: 'current',
      });
      await methods.setFingerprintEmbedding({
        author,
        id: String(stale._id),
        embedding: [0, 1],
        embeddingText: 's',
        embeddingModel: 'old',
      });

      const needing = await methods.getFingerprintsNeedingEmbedding(author, { model: 'current' });
      const names = needing.map((entity) => entity.name).sort();
      expect(names).toEqual(['Missing', 'Stale']);
    });
  });
});
