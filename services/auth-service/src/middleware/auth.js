'use strict';
const jwt = require('jsonwebtoken');

// ── Require admin session (studio owner) ─────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
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

// ── Require client JWT (for gallery access) ───────────────────────────────────
function requireClient(req, res, next) {
  const token = req.cookies?.client_token || 
                req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Please log in to access this gallery.' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.clientId  = decoded.clientId;
    req.clientEmail = decoded.email;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

// ── Optional client auth (used on gallery pages — works logged in or via token) ──
function optionalClient(req, res, next) {
  const token = req.cookies?.client_token || 
                req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.clientId    = decoded.clientId;
      req.clientEmail = decoded.email;
    } catch (e) { /* ignore */ }
  }
  next();
}

module.exports = { requireAdmin, requireClient, optionalClient };
