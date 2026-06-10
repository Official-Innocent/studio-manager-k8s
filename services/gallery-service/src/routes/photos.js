'use strict';
const express  = require('express');
const multer   = require('multer');
const sharp    = require('sharp');
const path     = require('path');
const fs       = require('fs');
const { query } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

const GALLERY_DIR = process.env.GALLERY_DIR || '/data/galleries';
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB per file
const MAX_FILES = 500; // 500 photos per batch

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const storage = multer.memoryStorage();
const upload  = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp','image/tiff','image/heic','image/heif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  },
});

// ── POST /api/photos/upload/:galleryId ────────────────────────────────────────
router.post('/upload/:galleryId', requireAdmin, upload.array('photos', MAX_FILES), async (req, res) => {
  const { galleryId } = req.params;
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded.' });

  try {
    const { rows: galRows } = await query('SELECT * FROM galleries WHERE id=$1', [galleryId]);
    if (!galRows.length) return res.status(404).json({ error: 'Gallery not found.' });

    const galDir   = path.join(GALLERY_DIR, galleryId);
    const thumbDir = path.join(galDir, 'thumbs');
    const webDir   = path.join(galDir, 'web');
    const origDir  = path.join(galDir, 'originals');
    ensureDir(galDir); ensureDir(thumbDir); ensureDir(webDir); ensureDir(origDir);

    const { rows: existingRows } = await query(
      'SELECT COUNT(*) as cnt FROM photos WHERE gallery_id=$1', [galleryId]
    );
    let sortOrder = parseInt(existingRows[0].cnt) || 0;
    const results = [];

    for (const file of req.files) {
      try {
        const baseName  = `photo-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        const thumbFile = baseName + '_thumb.jpg';
        const webFile   = baseName + '_web.jpg';
        const origFile  = baseName + '.jpg';

        const thumbPath = path.join(thumbDir, thumbFile);
        const webPath   = path.join(webDir,   webFile);
        const origPath  = path.join(origDir,  origFile);

        // Get metadata first
        const meta = await sharp(file.buffer).metadata();

        // Save original as optimised JPEG (quality 95, max 4000px)
        await sharp(file.buffer)
          .rotate() // auto-rotate from EXIF
          .resize(4000, 4000, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 95, progressive: true })
          .toFile(origPath);

        // Generate web version (1800px max, quality 88) - for portal proofing
        await sharp(file.buffer)
          .rotate()
          .resize(1800, 1800, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85, progressive: true })
          .toFile(webPath);

        // Generate thumbnail (400x400 crop, quality 75)
        await sharp(file.buffer)
          .rotate()
          .resize(400, 400, { fit: 'cover', position: 'centre' })
          .jpeg({ quality: 75 })
          .toFile(thumbPath);

        const stat = fs.statSync(origPath);

        const { rows } = await query(`
          INSERT INTO photos
            (gallery_id, filename, original_name, file_path, thumb_path, web_path,
             file_size, width, height, mime_type, sort_order)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          RETURNING id, filename, thumb_path, web_path, sort_order
        `, [
          galleryId,
          origFile,
          file.originalname,
          `/galleries/${galleryId}/originals/${origFile}`,
          `/galleries/${galleryId}/thumbs/${thumbFile}`,
          `/galleries/${galleryId}/web/${webFile}`,
          stat.size,
          meta.width  || 0,
          meta.height || 0,
          'image/jpeg',
          sortOrder++,
        ]);

        results.push(rows[0]);
      } catch (fileErr) {
        console.error('[photo upload single file]', file.originalname, fileErr.message);
      }
    }

    res.json({ success: true, uploaded: results.length, photos: results });
  } catch (err) {
    console.error('[photo upload]', err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ── DELETE /api/photos/:photoId ───────────────────────────────────────────────
router.delete('/:photoId', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM photos WHERE id=$1', [req.params.photoId]);
    if (!rows.length) return res.status(404).json({ error: 'Photo not found.' });
    const photo = rows[0];
    const galDir = path.join(GALLERY_DIR, photo.gallery_id);
    const files = [
      path.join(galDir, 'originals', photo.filename),
      path.join(galDir, 'thumbs',    path.basename(photo.thumb_path || '')),
      path.join(galDir, 'web',       path.basename(photo.web_path   || '')),
    ];
    files.forEach(f => { try { if(fs.existsSync(f)) fs.unlinkSync(f); } catch(e){} });
    await query('DELETE FROM photo_selections WHERE photo_id=$1', [req.params.photoId]);
    await query('DELETE FROM photos WHERE id=$1', [req.params.photoId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete photo.' });
  }
});

// ── PATCH /api/photos/:photoId/cover ─────────────────────────────────────────
router.patch('/:photoId/cover', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT gallery_id FROM photos WHERE id=$1', [req.params.photoId]);
    if (!rows.length) return res.status(404).json({ error: 'Photo not found.' });
    await query('UPDATE photos SET is_cover=false WHERE gallery_id=$1', [rows[0].gallery_id]);
    await query('UPDATE photos SET is_cover=true  WHERE id=$1',         [req.params.photoId]);
    await query('UPDATE galleries SET cover_image_id=$1 WHERE id=$2',   [req.params.photoId, rows[0].gallery_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to set cover.' });
  }
});

// ── GET /api/photos/:galleryId/download/:photoId — Full res download ──────────
router.get('/:galleryId/download/:photoId', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM photos WHERE id=$1 AND gallery_id=$2',
      [req.params.photoId, req.params.galleryId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Photo not found.' });
    const photo = rows[0];
    // Check gallery allows downloads
    const { rows: galRows } = await query(
      'SELECT allow_downloads FROM galleries WHERE id=$1 AND is_published=true',
      [req.params.galleryId]
    );
    if (!galRows.length || !galRows[0].allow_downloads) {
      return res.status(403).json({ error: 'Downloads not permitted for this gallery.' });
    }
    const origPath = path.join(GALLERY_DIR, req.params.galleryId, 'originals', photo.filename);
    if (!fs.existsSync(origPath)) {
      const webPath = path.join(GALLERY_DIR, req.params.galleryId, 'web', path.basename(photo.web_path || ''));
      if (fs.existsSync(webPath)) return res.download(webPath, photo.original_name || photo.filename);
      return res.status(404).json({ error: 'File not found.' });
    }
    res.download(origPath, photo.original_name || photo.filename);
  } catch (err) {
    res.status(500).json({ error: 'Download failed.' });
  }
});


// ── GET /api/photos/thumb/:photoId — Serve thumbnail ─────────────────────────
router.get('/thumb/:photoId', async (req, res) => {
  try {
    const { rows } = await query('SELECT gallery_id, thumb_path, filename FROM photos WHERE id=$1', [req.params.photoId]);
    if (!rows.length) return res.status(404).send('Not found');
    const photo = rows[0];
    const thumbFile = path.basename(photo.thumb_path || '');
    const thumbPath = path.join(GALLERY_DIR, photo.gallery_id, 'thumbs', thumbFile);
    if (!fs.existsSync(thumbPath)) return res.status(404).send('Thumbnail not found');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(thumbPath);
  } catch (err) {
    res.status(500).send('Error');
  }
});

// ── GET /api/photos/web/:photoId — Serve web version (for portal proofing) ───
router.get('/web/:photoId', async (req, res) => {
  try {
    const { rows } = await query('SELECT gallery_id, web_path, filename FROM photos WHERE id=$1', [req.params.photoId]);
    if (!rows.length) return res.status(404).send('Not found');
    const photo = rows[0];
    const webFile = path.basename(photo.web_path || '');
    const webPath = path.join(GALLERY_DIR, photo.gallery_id, 'web', webFile);
    if (!fs.existsSync(webPath)) return res.status(404).send('Web version not found');
    if (req.query.dl === '1') {
      res.setHeader('Content-Disposition', 'attachment; filename="' + (photo.filename || webFile) + '"');
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(webPath);
  } catch (err) {
    res.status(500).send('Error');
  }
});

module.exports = router;

// ── PATCH /api/photos/reorder — Admin: save photo sort order ─────────────────
router.patch('/reorder', requireAdmin, async (req, res) => {
  const { gallery_id, order } = req.body;
  if (!gallery_id || !Array.isArray(order)) return res.status(400).json({ error: 'gallery_id and order array required.' });
  try {
    await Promise.all(order.map(function(item) {
      return query('UPDATE photos SET sort_order=$1 WHERE id=$2 AND gallery_id=$3',
        [item.sort_order, item.id, gallery_id]);
    }));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save order.' });
  }
});