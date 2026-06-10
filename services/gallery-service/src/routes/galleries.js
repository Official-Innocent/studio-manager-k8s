'use strict';
const express  = require('express');
const { query } = require('../config/database');
const { requireAdmin, requireClient, optionalClient } = require('../middleware/auth');
const { publish } = require('../redis');
const router = express.Router();

// ── GET /api/galleries — Admin: list all galleries ────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT g.*, c.first_name, c.last_name, c.email as client_email,
        (SELECT COUNT(*) FROM photos p WHERE p.gallery_id = g.id) as photo_count
      FROM galleries g
      LEFT JOIN clients c ON c.id = g.client_id
      ORDER BY g.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load galleries.' });
  }
});

// ── POST /api/galleries — Admin: create gallery ───────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  const { client_id, booking_id, title, description, session_date,
          allow_downloads, allow_sharing, show_watermark, expires_at, password } = req.body;
  if (!title) return res.status(400).json({ error: 'Gallery title is required.' });

  const bcrypt = require('bcryptjs');
  const slug   = title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') 
                 + '-' + Date.now().toString(36);
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;

  try {
    const { rows } = await query(`
      INSERT INTO galleries (client_id, booking_id, title, slug, description, session_date,
        allow_downloads, allow_sharing, show_watermark, expires_at, password_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `, [client_id||null, booking_id||null, title, slug, description||null, session_date||null,
        allow_downloads !== false, allow_sharing === true, show_watermark === true,
        expires_at||null, passwordHash]);
    res.status(201).json({ success: true, gallery: rows[0] });
  } catch (err) {
    console.error('[POST /galleries]', err);
    res.status(500).json({ error: 'Failed to create gallery.' });
  }
});

// ── GET /api/galleries/:slug — Client/Public: get gallery ─────────────────────
router.get('/:slug', optionalClient, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT g.id, g.title, g.slug, g.description, g.session_date, g.allow_downloads,
              g.allow_sharing, g.show_watermark, g.expires_at, g.is_published, g.cover_image_id,
              g.view_count
       FROM galleries g WHERE (g.slug=$1 OR g.id::text=$1)`,
      [req.params.slug]
    );
    const isAdmin = req.session && req.session.adminLoggedIn;
    if (!rows.length || (!rows[0].is_published && !isAdmin)) {
      return res.status(404).json({ error: 'Gallery not found.' });
    }
    // Increment view count
    query('UPDATE galleries SET view_count=view_count+1 WHERE slug=$1', [req.params.slug]).catch(()=>{});
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load gallery.' });
  }
});

// ── GET /api/galleries/:slug/photos — Get photos in gallery ───────────────────
router.get('/:slug/photos', optionalClient, async (req, res) => {
  try {
    const { rows: galleryRows } = await query(
      'SELECT id FROM galleries WHERE (slug=$1 OR id::text=$1) AND (is_published=true OR $2::boolean)', [req.params.slug, !!(req.session && req.session.adminLoggedIn)]
    );
    if (!galleryRows.length) return res.status(404).json({ error: 'Gallery not found.' });
    const galleryId = galleryRows[0].id;

    const { rows } = await query(
      `SELECT id, filename, thumb_path, web_path, width, height, sort_order, is_cover, face_data, ai_tags
       FROM photos WHERE gallery_id=$1 ORDER BY sort_order, upload_at`,
      [galleryId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load photos.' });
  }
});

// ── PATCH /api/galleries/:id/publish — Admin: publish/unpublish ───────────────
router.patch('/:id/publish', requireAdmin, async (req, res) => {
  const { is_published } = req.body;
  try {
    const { rows } = await query(
      'UPDATE galleries SET is_published=$1 WHERE id=$2 RETURNING *, (SELECT id FROM clients WHERE id=galleries.client_id) as client_check',
      [!!is_published, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Gallery not found.' });

    // If publishing, notify client
    if (is_published && rows[0].client_id) {
      const { rows: clientRows } = await query('SELECT * FROM clients WHERE id=$1', [rows[0].client_id]);
      if (clientRows.length) {
        const accessUrl = `${process.env.SITE_URL}/gallery/${rows[0].slug}?token=${rows[0].access_token}`;
        publish('gallery.ready', { client: clientRows[0], gallery: rows[0], accessUrl }).catch(console.error);
        // Log delivery time for review request scheduler
        await query("UPDATE galleries SET delivered_at=NOW() WHERE id=$1", [rows[0].id]).catch(()=>{});
      }
    }
    res.json({ success: true, gallery: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update gallery.' });
  }
});

// ── POST /api/galleries/:slug/select — Client: select/deselect a photo ────────
router.post('/:slug/select', requireClient, async (req, res) => {
  const { photo_id, list_type = 'favourites', selected } = req.body;
  if (!photo_id) return res.status(400).json({ error: 'photo_id is required.' });

  try {
    const { rows: galleryRows } = await query('SELECT id FROM galleries WHERE slug=$1', [req.params.slug]);
    if (!galleryRows.length) return res.status(404).json({ error: 'Gallery not found.' });
    const galleryId = galleryRows[0].id;

    if (selected === false) {
      await query(
        'DELETE FROM photo_selections WHERE gallery_id=$1 AND photo_id=$2 AND client_id=$3 AND list_type=$4',
        [galleryId, photo_id, req.clientId, list_type]
      );
    } else {
      await query(`
        INSERT INTO photo_selections (gallery_id, photo_id, client_id, list_type)
        VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING
      `, [galleryId, photo_id, req.clientId, list_type]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update selection.' });
  }
});

// ── GET /api/galleries/:slug/selections — Client/Admin: get selections ─────────
router.get('/:slug/selections', requireClient, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT ps.photo_id, ps.list_type, p.filename, p.thumb_path
      FROM photo_selections ps
      JOIN photos p ON p.id = ps.photo_id
      JOIN galleries g ON g.id = ps.gallery_id
      WHERE g.slug=$1 AND ps.client_id=$2
      ORDER BY ps.selected_at
    `, [req.params.slug, req.clientId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load selections.' });
  }
});


// GET /api/galleries/:id/photos-admin — Admin: get all photos regardless of publish status
router.get('/:id/photos-admin', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT p.* FROM photos p WHERE p.gallery_id=$1 ORDER BY p.sort_order ASC, p.created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch(e) {
    console.error('[photos-admin]', e.message);
    res.status(500).json({ error: 'Failed to load photos.' });
  }
});
module.exports = router;
