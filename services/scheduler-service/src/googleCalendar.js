'use strict';
const {google} = require('googleapis');

function getCalendar() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth });
}

// ── Multi-calendar config ─────────────────────────────────────────────────────
// GOOGLE_CALENDAR_IDS takes priority (comma-separated). Falls back to the legacy
// single GOOGLE_CALENDAR_ID, then to the original hardcoded default so nothing
// breaks if neither env var has been set yet.
function getCalendarIds() {
  const raw = process.env.GOOGLE_CALENDAR_IDS || process.env.GOOGLE_CALENDAR_ID || 'thephotographerltd@gmail.com';
  const ids = raw.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  const deduped = [];
  for (var i = 0; i < ids.length; i++) {
    if (deduped.indexOf(ids[i]) === -1) deduped.push(ids[i]);
  }
  return deduped.length ? deduped : ['thephotographerltd@gmail.com'];
}

// Kept for backward compatibility with any code importing CALENDAR_ID directly —
// always resolves to the primary (first) calendar.
const CALENDAR_ID = getCalendarIds()[0];

async function createEvent(booking) {
  const cal = getCalendar();
  const primaryCalendarId = getCalendarIds()[0];
  const dateStr = String(booking.session_date).split('T')[0];
  const title = booking.session_type + ' — ' + booking.first_name + ' ' + booking.last_name;
  const desc = [
    'Client: ' + booking.first_name + ' ' + booking.last_name,
    'Email: ' + booking.email,
    'Phone: ' + (booking.phone || 'N/A'),
    'Location: ' + (booking.location || 'TBC'),
    'Ref: BSM-' + booking.id.split('-')[0].toUpperCase(),
  ].join('\n');
  const event = {
    summary: title,
    description: desc,
    start: { date: dateStr },
    end:   { date: dateStr },
    colorId: '5',
  };
  const r = await cal.events.insert({ calendarId: primaryCalendarId, resource: event });
  return r.data.id;
}

async function updateEvent(eventId, booking) {
  const cal = getCalendar();
  const primaryCalendarId = getCalendarIds()[0];
  const dateStr = String(booking.session_date).split('T')[0];
  const title = booking.session_type + ' — ' + booking.first_name + ' ' + booking.last_name;
  await cal.events.patch({
    calendarId: primaryCalendarId,
    eventId: eventId,
    resource: {
      summary: title,
      start: { date: dateStr },
      end:   { date: dateStr },
      description: 'Status: ' + booking.status + '\nLocation: ' + (booking.location || 'TBC'),
    },
  });
}

async function deleteEvent(eventId) {
  const cal = getCalendar();
  const primaryCalendarId = getCalendarIds()[0];
  await cal.events.delete({ calendarId: primaryCalendarId, eventId: eventId });
}

// Reads events from ALL configured calendars and merges them, tagging each
// event with which calendar it came from (used by runCalendarSync to populate
// blocked_dates from every calendar, e.g. a personal calendar + the business one).
async function getExternalEvents(daysAhead) {
  const cal = getCalendar();
  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + (daysAhead || 90));
  const calendarIds = getCalendarIds();

  const allEvents = [];
  for (var i = 0; i < calendarIds.length; i++) {
    var calendarId = calendarIds[i];
    try {
      var r = await cal.events.list({
        calendarId: calendarId,
        timeMin: now.toISOString(),
        timeMax: future.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });
      var items = r.data.items || [];
      for (var j = 0; j < items.length; j++) {
        items[j]._sourceCalendarId = calendarId;
        allEvents.push(items[j]);
      }
    } catch (e) {
      console.error('[googleCalendar] failed to read calendar', calendarId, '-', e.message);
    }
  }
  return allEvents;
}

module.exports = { createEvent, updateEvent, deleteEvent, getExternalEvents, getCalendarIds, CALENDAR_ID };
