const yauzl = require('yauzl');

/** Limits to guard against zip bombs / oversized imports. */
const MAX_ENTRIES = 200;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Builds an uncompressed ("stored") ZIP archive. Stored entries avoid all
 * compression edge cases, which is ideal for small text/script bundles.
 * @param {Array<{ name: string; data: Buffer }>} entries
 * @returns {Buffer}
 */
function buildStoredZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const time = 0;
  const date = 0x21; // 1980-01-01

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // flag bit 11: UTF-8 names
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/** Rejects unsafe entry names (absolute, traversal, backslashes). */
function isSafeEntryName(name) {
  if (!name || name.startsWith('/') || name.includes('\\')) {
    return false;
  }
  return !name.split('/').some((seg) => seg === '..');
}

/**
 * Extracts a ZIP file into memory as [{ name, data }], skipping directories and
 * unsafe names, with zip-bomb guards.
 * @param {string} filePath
 * @returns {Promise<Array<{ name: string; data: Buffer }>>}
 */
function extractZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        return reject(err || new Error('Could not open zip'));
      }
      const out = [];
      let total = 0;
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          return zipfile.readEntry();
        }
        if (!isSafeEntryName(entry.fileName) || out.length >= MAX_ENTRIES) {
          return zipfile.readEntry();
        }
        if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
          return zipfile.readEntry();
        }
        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            return zipfile.readEntry();
          }
          const parts = [];
          let size = 0;
          stream.on('data', (chunk) => {
            size += chunk.length;
            total += chunk.length;
            if (size <= MAX_ENTRY_BYTES && total <= MAX_TOTAL_BYTES) {
              parts.push(chunk);
            }
          });
          stream.on('end', () => {
            if (total <= MAX_TOTAL_BYTES) {
              out.push({ name: entry.fileName, data: Buffer.concat(parts) });
            }
            zipfile.readEntry();
          });
          stream.on('error', () => zipfile.readEntry());
        });
      });
      zipfile.on('end', () => resolve(out));
      zipfile.on('error', reject);
    });
  });
}

module.exports = { buildStoredZip, extractZip };
