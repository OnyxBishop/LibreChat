const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { getSkills, getSkillById, createSkill, updateSkill, deleteSkill } = require('~/models');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');

const router = express.Router();
router.use(requireJwtAuth);

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
    res.status(200).json({ message: 'Skill deleted' });
  } catch (error) {
    logger.error('[/skills] error deleting skill', error);
    res.status(500).json({ message: 'Error deleting skill' });
  }
});

module.exports = router;
