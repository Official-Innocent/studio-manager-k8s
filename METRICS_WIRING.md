# Stage 8 — metrics wiring patches for each service's src/index.js
# These are the EXACT lines to add. Each service already has an Express app.
# Find the indicated anchor line and insert accordingly.

# ─────────────────────────────────────────────────────────────────────────────
# ALL SERVICES — add these two lines near the top, after existing requires
# ─────────────────────────────────────────────────────────────────────────────

const { metricsMiddleware, metricsHandler } = require('./metrics');

# Then after `const app = express();` (or wherever middleware is applied):

app.use(metricsMiddleware);

# Then add the /metrics route (before any catch-all 404 handler):

app.get('/metrics', metricsHandler);

# ─────────────────────────────────────────────────────────────────────────────
# NOTIFICATION SERVICE — also record each email send
# In your existing sendEmail() or wherever nodemailer.sendMail() is called:
# ─────────────────────────────────────────────────────────────────────────────

# At top of email.js (or wherever send logic lives):
const { emailsSentTotal } = require('./metrics');

# After a successful send:
emailsSentTotal.inc({ template: templateName, status: 'success' });

# In the catch block:
emailsSentTotal.inc({ template: templateName, status: 'error' });

# ─────────────────────────────────────────────────────────────────────────────
# SCHEDULER SERVICE — record each job run
# In your job registration loop (wherever you do cron.schedule(...)):
# ─────────────────────────────────────────────────────────────────────────────

const { jobsRunTotal, jobLastRunTimestamp, jobsRegistered } = require('./metrics');

# After all jobs are registered:
jobsRegistered.set(JOBS.length); // or however many you register

# Inside each job's callback, wrap the execution:
try {
  await runJob();
  jobsRunTotal.inc({ job_name: name, status: 'success' });
  jobLastRunTimestamp.set({ job_name: name }, Date.now() / 1000);
} catch (err) {
  jobsRunTotal.inc({ job_name: name, status: 'error' });
}

# ─────────────────────────────────────────────────────────────────────────────
# BOOKING SERVICE — record bookings and contracts
# In the POST /bookings handler:
# ─────────────────────────────────────────────────────────────────────────────

const { bookingsCreatedTotal, contractsSentTotal } = require('./metrics');

# After a booking is committed to DB:
bookingsCreatedTotal.inc({ session_type: booking.session_type || 'unknown' });

# After contract email is sent:
contractsSentTotal.inc();

# ─────────────────────────────────────────────────────────────────────────────
# PORTAL SERVICE — record logins
# In the POST /portal/login handler (after successful auth):
# ─────────────────────────────────────────────────────────────────────────────

const { portalLoginsTotal, addonOrdersTotal } = require('./metrics');

# After successful login:
portalLoginsTotal.inc();

# After an add-on order:
addonOrdersTotal.inc({ addon_type: order.type });

# ─────────────────────────────────────────────────────────────────────────────
# GALLERY SERVICE — record publishes and downloads
# ─────────────────────────────────────────────────────────────────────────────

const { galleriesPublishedTotal, galleryDownloadsTotal } = require('./metrics');

# After gallery publish:
galleriesPublishedTotal.inc();

# After download triggered:
galleryDownloadsTotal.inc();
