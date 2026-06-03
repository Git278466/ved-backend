'use strict';

const express      = require('express');
const router       = express.Router();
const Notification = require('../models/Notification');
const { protectAdmin } = require('../middleware/authMiddleware');

router.use(protectAdmin);

/* GET /api/notifications — paginated list */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, unread } = req.query;
    const filter = { recipient: req.admin._id };
    if (unread === 'true') filter.read = false;

    const skip = (Number(page) - 1) * Number(limit);
    const [total, data, unreadCount] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Notification.countDocuments({ recipient: req.admin._id, read: false }),
    ]);
    res.json({ success: true, total, unreadCount, page: Number(page), data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* GET /api/notifications/count — unread count only (for badge polling) */
router.get('/count', async (req, res) => {
  try {
    const count = await Notification.countDocuments({ recipient: req.admin._id, read: false });
    res.json({ success: true, count });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* PUT /api/notifications/read-all */
router.put('/read-all', async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.admin._id, read: false },
      { read: true, readAt: new Date() }
    );
    res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* PUT /api/notifications/:id/read */
router.put('/:id/read', async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.admin._id },
      { read: true, readAt: new Date() },
      { new: true }
    );
    if (!notif) return res.status(404).json({ success: false, message: 'Notification not found.' });
    res.json({ success: true, data: notif });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
