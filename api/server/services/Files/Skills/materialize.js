const fs = require('fs');
const path = require('path');
const { logger } = require('@librechat/data-schemas');
const paths = require('~/config/paths');

/** Max bytes returned when reading a bundled file as text. */
const MAX_READ_BYTES = 1024 * 1024;
const SKILL_MD = 'SKILL.md';
/** Skill directories are keyed by the Mongo ObjectId, which is always filesystem-safe. */
const ID_RE = /^[a-f0-9]{24}$/i;

/**
 * Resolves and validates the on-disk directory for a user's skill bundle.
 * Layout: <skillsBase>/<userId>/<skillId>/ — keyed by the Mongo _id so renaming
 * a skill never moves its directory and no name sanitization is required.
 * @param {string} userId
 * @param {string} skillId
 * @returns {string | null} Absolute directory path, or null if inputs are unsafe.
 */
function skillDir(userId, skillId) {
  const id = String(skillId || '');
  const uid = String(userId || '');
  if (!ID_RE.test(id) || !ID_RE.test(uid)) {
    return null;
  }
  const base = path.resolve(paths.skills, uid);
  const dir = path.resolve(base, id);
  if (path.dirname(dir) !== base) {
    return null;
  }
  return dir;
}

/**
 * Resolves a relative path inside a skill dir, rejecting traversal/absolute paths.
 * @param {string} dir
 * @param {string} relPath
 * @returns {string | null}
 */
function resolveInside(dir, relPath) {
  const rel = String(relPath || '').replace(/\\/g, '/');
  if (!rel || rel.startsWith('/')) {
    return null;
  }
  const full = path.resolve(dir, rel);
  const diff = path.relative(dir, full);
  if (diff.startsWith('..') || path.isAbsolute(diff)) {
    return null;
  }
  return full;
}

/**
 * Reconstructs a full SKILL.md (YAML frontmatter + body) from the stored skill.
 * The frontmatter `name` is the canonical key the MCP runtime matches against.
 * @param {{ name?: string; description?: string; content?: string }} skill
 * @returns {string}
 */
function buildSkillMd(skill) {
  const name = (skill?.name ?? '').toString();
  const description = (skill?.description ?? '').toString().replace(/\r?\n/g, ' ');
  const body = (skill?.content ?? '').toString();
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

/**
 * Writes/updates the SKILL.md for a skill on the shared volume. Best-effort:
 * filesystem failures are logged, never thrown (DB remains the source of truth).
 * @param {string} userId
 * @param {{ _id?: string; name?: string; description?: string; content?: string }} skill
 */
async function materializeSkill(userId, skill) {
  try {
    const dir = skillDir(userId, skill?._id);
    if (!dir) {
      return;
    }
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, SKILL_MD), buildSkillMd(skill), 'utf8');
  } catch (error) {
    logger.error('[skills.materialize] failed to materialize skill', error);
  }
}

/**
 * Removes a skill's bundle directory (on delete). Best-effort.
 * @param {string} userId
 * @param {string} skillId
 */
async function deleteSkillDir(userId, skillId) {
  try {
    const dir = skillDir(userId, skillId);
    if (!dir) {
      return;
    }
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (error) {
    logger.error('[skills.materialize] failed to delete skill dir', error);
  }
}

/**
 * Recursively lists attached bundle files (excludes the root SKILL.md).
 * @param {string} userId
 * @param {string} skillId
 * @returns {Promise<Array<{ name: string; size: number; updatedAt: string }>>}
 */
async function listSkillFiles(userId, skillId) {
  const dir = skillDir(userId, skillId);
  if (!dir) {
    return [];
  }
  const out = [];
  const walk = async (current, prefix) => {
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        if (!prefix && entry.name === SKILL_MD) {
          continue;
        }
        try {
          const stat = await fs.promises.stat(abs);
          out.push({ name: rel, size: stat.size, updatedAt: stat.mtime.toISOString() });
        } catch {
          /* ignore unreadable entry */
        }
      }
    }
  };
  await walk(dir, '');
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Reads a bundled file as UTF-8 text, capped at MAX_READ_BYTES.
 * @param {string} userId
 * @param {string} skillId
 * @param {string} relPath
 * @returns {Promise<string | null>}
 */
async function readSkillFile(userId, skillId, relPath) {
  const dir = skillDir(userId, skillId);
  if (!dir) {
    return null;
  }
  const full = resolveInside(dir, relPath);
  if (!full) {
    return null;
  }
  try {
    const stat = await fs.promises.stat(full);
    if (!stat.isFile()) {
      return null;
    }
    const fd = await fs.promises.open(full, 'r');
    try {
      const len = Math.min(stat.size, MAX_READ_BYTES);
      const buf = Buffer.alloc(len);
      await fd.read(buf, 0, len, 0);
      const truncated = stat.size > MAX_READ_BYTES;
      return buf.toString('utf8') + (truncated ? '\n…[truncated]' : '');
    } finally {
      await fd.close();
    }
  } catch (error) {
    logger.error('[skills.materialize] failed to read skill file', error);
    return null;
  }
}

/**
 * Writes an uploaded file into the skill bundle from a temp upload path.
 * @param {string} userId
 * @param {string} skillId
 * @param {string} relName
 * @param {string} tempPath
 * @returns {Promise<boolean>}
 */
async function writeSkillFileFromTemp(userId, skillId, relName, tempPath) {
  const dir = skillDir(userId, skillId);
  if (!dir) {
    return false;
  }
  const full = resolveInside(dir, relName);
  if (!full || path.basename(full) === SKILL_MD) {
    return false;
  }
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  const data = await fs.promises.readFile(tempPath);
  await fs.promises.writeFile(full, data);
  return true;
}

/**
 * Writes a file into the skill bundle from an in-memory buffer (used by zip import).
 * @param {string} userId
 * @param {string} skillId
 * @param {string} relName
 * @param {Buffer} buffer
 * @returns {Promise<boolean>}
 */
async function writeSkillFileBuffer(userId, skillId, relName, buffer) {
  const dir = skillDir(userId, skillId);
  if (!dir) {
    return false;
  }
  const full = resolveInside(dir, relName);
  if (!full) {
    return false;
  }
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, buffer);
  return true;
}

/**
 * Reads every file in a skill bundle (including SKILL.md) into memory for export.
 * @param {string} userId
 * @param {string} skillId
 * @returns {Promise<Array<{ name: string; data: Buffer }>>}
 */
async function readAllSkillFiles(userId, skillId) {
  const dir = skillDir(userId, skillId);
  if (!dir) {
    return [];
  }
  const out = [];
  const walk = async (current, prefix) => {
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        try {
          out.push({ name: rel, data: await fs.promises.readFile(abs) });
        } catch {
          /* ignore unreadable entry */
        }
      }
    }
  };
  await walk(dir, '');
  return out;
}

/**
 * Deletes a single attached bundle file (never the root SKILL.md).
 * @param {string} userId
 * @param {string} skillId
 * @param {string} relPath
 * @returns {Promise<boolean>}
 */
async function deleteSkillFile(userId, skillId, relPath) {
  const dir = skillDir(userId, skillId);
  if (!dir) {
    return false;
  }
  const full = resolveInside(dir, relPath);
  if (!full || (path.basename(full) === SKILL_MD && path.dirname(full) === dir)) {
    return false;
  }
  try {
    await fs.promises.unlink(full);
    return true;
  } catch (error) {
    logger.error('[skills.materialize] failed to delete skill file', error);
    return false;
  }
}

module.exports = {
  skillDir,
  materializeSkill,
  deleteSkillDir,
  listSkillFiles,
  readSkillFile,
  writeSkillFileFromTemp,
  writeSkillFileBuffer,
  readAllSkillFiles,
  deleteSkillFile,
};
