const fs = require('fs');
const path = require('path');
const multer = require('multer');
const express = require('express');
const { sanitizeFilename } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { getSkills, getSkillById, createSkill, updateSkill, deleteSkill } = require('~/models');
const {
  materializeSkill,
  deleteSkillDir,
  listSkillFiles,
  writeSkillFileFromTemp,
  writeSkillFileBuffer,
  readAllSkillFiles,
  deleteSkillFile,
} = require('~/server/services/Files/Skills/materialize');
const { buildStoredZip, extractZip } = require('~/server/services/Files/Skills/zip');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const paths = require('~/config/paths');

const router = express.Router();
router.use(requireJwtAuth);

/** Permissive disk upload for skill bundle files (the user's own scripts/resources). */
const tempStorage = multer.diskStorage({
  destination(req, file, cb) {
    const outputPath = path.join(paths.uploads, 'temp', req.user.id);
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }
    cb(null, outputPath);
  },
  filename(req, file, cb) {
    file.originalname = decodeURIComponent(file.originalname);
    cb(null, sanitizeFilename(file.originalname));
  },
});
const uploadSkillFile = multer({ storage: tempStorage, limits: { fileSize: 25 * 1024 * 1024 } });

/** Parses a SKILL.md (frontmatter name/description + body) into stored fields. */
function parseSkillMd(text) {
  const md = String(text || '');
  const match = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  let name = '';
  let description = '';
  let content = md;
  if (match) {
    for (const line of match[1].split('\n')) {
      const i = line.indexOf(':');
      if (i === -1) {
        continue;
      }
      const key = line.slice(0, i).trim();
      const value = line
        .slice(i + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (key === 'name') {
        name = value;
      } else if (key === 'description') {
        description = value;
      }
    }
    content = md.slice(match[0].length);
  }
  if (!name) {
    const h1 = content.match(/^\s*#\s+(.+)$/m);
    if (h1) {
      name = h1[1].trim();
    }
  }
  return { name: name.trim(), description: description.trim(), content: content.trim() };
}

/** Filesystem-safe download filename derived from a skill name. */
function slugifyFileName(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'skill';
}

/** List all skills for the authenticated user */
router.get('/', async (req, res) => {
  try {
    const skills = await getSkills(req.user.id);
    res.status(200).json(skills);
  } catch (error) {
    logger.error('[/skills] error listing skills', error);
    res.status(500).json({ message: 'Error retrieving skills' });
  }
});

/** Import a skill bundle from a .zip archive (must contain a SKILL.md) */
router.post('/import', uploadSkillFile.single('file'), async (req, res) => {
  let cleanup = true;
  try {
    if (!req.file) {
      cleanup = false;
      return res.status(400).json({ message: 'No file provided' });
    }
    const entries = await extractZip(req.file.path);
    const skillEntry = entries.find((e) => e.name.split('/').pop() === 'SKILL.md');
    if (!skillEntry) {
      return res.status(400).json({ message: 'Archive must contain a SKILL.md' });
    }
    const prefix = skillEntry.name.slice(0, skillEntry.name.length - 'SKILL.md'.length);
    const parsed = parseSkillMd(skillEntry.data.toString('utf8'));
    if (!parsed.name) {
      return res.status(400).json({ message: 'SKILL.md must define a name' });
    }
    const skill = await createSkill(req.user.id, {
      name: parsed.name,
      description: parsed.description,
      content: parsed.content,
    });
    await materializeSkill(req.user.id, skill);
    for (const entry of entries) {
      if (!entry.name.startsWith(prefix)) {
        continue;
      }
      const rel = entry.name.slice(prefix.length);
      if (!rel || rel === 'SKILL.md') {
        continue;
      }
      await writeSkillFileBuffer(req.user.id, String(skill._id), rel, entry.data);
    }
    res.status(201).json(skill);
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'A skill with this name already exists' });
    }
    logger.error('[/skills] error importing skill', error);
    res.status(500).json({ message: 'Error importing skill' });
  } finally {
    if (cleanup && req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }
});

/** Create a new skill */
router.post('/', async (req, res) => {
  const { name, description, content, enabled } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'Skill name is required' });
  }
  try {
    const skill = await createSkill(req.user.id, {
      name: name.trim(),
      description,
      content,
      enabled,
    });
    await materializeSkill(req.user.id, skill);
    res.status(201).json(skill);
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'A skill with this name already exists' });
    }
    logger.error('[/skills] error creating skill', error);
    res.status(500).json({ message: 'Error creating skill' });
  }
});

/** Update an existing skill */
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, content, enabled } = req.body || {};
  const data = {};
  if (name !== undefined) {
    data.name = typeof name === 'string' ? name.trim() : name;
  }
  if (description !== undefined) {
    data.description = description;
  }
  if (content !== undefined) {
    data.content = content;
  }
  if (enabled !== undefined) {
    data.enabled = enabled;
  }
  try {
    const skill = await updateSkill({ author: req.user.id, id, data });
    if (!skill) {
      return res.status(404).json({ message: 'Skill not found' });
    }
    await materializeSkill(req.user.id, skill);
    res.status(200).json(skill);
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'A skill with this name already exists' });
    }
    logger.error('[/skills] error updating skill', error);
    res.status(500).json({ message: 'Error updating skill' });
  }
});

/** Delete a skill */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const skill = await getSkillById({ author: req.user.id, id });
    if (!skill) {
      return res.status(404).json({ message: 'Skill not found' });
    }
    await deleteSkill({ author: req.user.id, id });
    await deleteSkillDir(req.user.id, id);
    res.status(200).json({ message: 'Skill deleted' });
  } catch (error) {
    logger.error('[/skills] error deleting skill', error);
    res.status(500).json({ message: 'Error deleting skill' });
  }
});

/** Export a skill bundle (SKILL.md + attached files) as a .zip */
router.get('/:id/export', async (req, res) => {
  const { id } = req.params;
  try {
    const skill = await getSkillById({ author: req.user.id, id });
    if (!skill) {
      return res.status(404).json({ message: 'Skill not found' });
    }
    // Ensure SKILL.md exists on disk (covers skills created before materialization).
    await materializeSkill(req.user.id, skill);
    const entries = await readAllSkillFiles(req.user.id, id);
    if (!entries.length) {
      entries.push({ name: 'SKILL.md', data: Buffer.from('') });
    }
    const zip = buildStoredZip(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${slugifyFileName(skill.name)}.zip"`,
    );
    res.status(200).send(zip);
  } catch (error) {
    logger.error('[/skills] error exporting skill', error);
    res.status(500).json({ message: 'Error exporting skill' });
  }
});

/** List attached files of a skill bundle */
router.get('/:id/files', async (req, res) => {
  const { id } = req.params;
  try {
    const skill = await getSkillById({ author: req.user.id, id });
    if (!skill) {
      return res.status(404).json({ message: 'Skill not found' });
    }
    const files = await listSkillFiles(req.user.id, id);
    res.status(200).json(files);
  } catch (error) {
    logger.error('[/skills] error listing skill files', error);
    res.status(500).json({ message: 'Error listing skill files' });
  }
});

/** Upload a file into a skill bundle */
router.post('/:id/files', uploadSkillFile.single('file'), async (req, res) => {
  const { id } = req.params;
  let cleanup = true;
  try {
    if (!req.file) {
      cleanup = false;
      return res.status(400).json({ message: 'No file provided' });
    }
    const skill = await getSkillById({ author: req.user.id, id });
    if (!skill) {
      return res.status(404).json({ message: 'Skill not found' });
    }
    const ok = await writeSkillFileFromTemp(req.user.id, id, req.file.originalname, req.file.path);
    if (!ok) {
      return res.status(400).json({ message: 'Invalid file name' });
    }
    const files = await listSkillFiles(req.user.id, id);
    res.status(201).json(files);
  } catch (error) {
    logger.error('[/skills] error uploading skill file', error);
    res.status(500).json({ message: 'Error uploading skill file' });
  } finally {
    if (cleanup && req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }
});

/** Delete a single attached file from a skill bundle (name via ?name=) */
router.delete('/:id/files', async (req, res) => {
  const { id } = req.params;
  const name = req.query.name;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ message: 'File name is required' });
  }
  try {
    const skill = await getSkillById({ author: req.user.id, id });
    if (!skill) {
      return res.status(404).json({ message: 'Skill not found' });
    }
    const ok = await deleteSkillFile(req.user.id, id, name);
    if (!ok) {
      return res.status(404).json({ message: 'File not found' });
    }
    const files = await listSkillFiles(req.user.id, id);
    res.status(200).json(files);
  } catch (error) {
    logger.error('[/skills] error deleting skill file', error);
    res.status(500).json({ message: 'Error deleting skill file' });
  }
});

module.exports = router;
