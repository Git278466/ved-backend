'use strict';

const MarketingMaterial = require('../models/MarketingMaterial');

const isManager = (admin) => {
  const name = admin?.role?.name || '';
  return admin?.role?.isSystem || ['Super Admin', 'Admin'].includes(name);
};

/* GET /api/marketing-materials */
exports.getMaterials = async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.query.category && req.query.category !== 'all') filter.category = req.query.category;
    if (req.query.q) {
      const rx = new RegExp(req.query.q, 'i');
      filter.$or = [{ title: rx }, { description: rx }, { tags: rx }];
    }

    const materials = await MarketingMaterial.find(filter)
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: materials });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* POST /api/marketing-materials */
exports.createMaterial = async (req, res) => {
  try {
    if (!isManager(req.admin)) return res.status(403).json({ success: false, message: 'Not authorized.' });
    const { title, description, url, category, tags } = req.body;
    if (!title || !url) return res.status(400).json({ success: false, message: 'Title and URL are required.' });

    const mat = await MarketingMaterial.create({
      title, description, url, category,
      tags: Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : []),
      createdBy: req.admin._id,
    });
    res.status(201).json({ success: true, data: mat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* PUT /api/marketing-materials/:id */
exports.updateMaterial = async (req, res) => {
  try {
    if (!isManager(req.admin)) return res.status(403).json({ success: false, message: 'Not authorized.' });
    const { title, description, url, category, tags, isActive } = req.body;
    const mat = await MarketingMaterial.findByIdAndUpdate(
      req.params.id,
      {
        title, description, url, category,
        tags: Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : []),
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        updatedBy: req.admin._id,
      },
      { new: true, runValidators: true }
    );
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found.' });
    res.json({ success: true, data: mat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* DELETE /api/marketing-materials/:id */
exports.deleteMaterial = async (req, res) => {
  try {
    if (!isManager(req.admin)) return res.status(403).json({ success: false, message: 'Not authorized.' });
    const mat = await MarketingMaterial.findByIdAndDelete(req.params.id);
    if (!mat) return res.status(404).json({ success: false, message: 'Material not found.' });
    res.json({ success: true, message: 'Deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
