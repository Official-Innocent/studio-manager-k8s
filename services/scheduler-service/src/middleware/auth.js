'use strict';
const jwt = require('jsonwebtoken');

// ── Require admin (studio owner) — JWT Bearer only ────────────────────────────
// scheduler-service has no session store, so unlike booking-service this only
// checks the Authorization header. The admin frontend's api() helper already
// attaches "Authorization: Bearer <token>" from localStorage on every request.
function requireAdmin(req, res, next) {
  if (req.headers.authorization) {
    try {
      const token = req.headers.authorization.replace('Bearer ', '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role === 'admin') {
        req.adminId = decoded.id;
        return next();
      }
    } catch (e) { /* fall through */ }
  }
  return res.status(401).json({ error: 'Unauthorised. Please log in.' });
}

module.exports = { requireAdmin };
