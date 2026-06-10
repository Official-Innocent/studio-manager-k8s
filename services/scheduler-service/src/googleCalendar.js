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

const CALENDAR_ID = 'thephotographerltd@gmail.com';

async function createEvent(booking) {
  const cal = getCalendar();
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
  const r = await cal.events.insert({ calendarId: CALENDAR_ID, resource: event });
  return r.data.id;
}

async function updateEvent(eventId, booking) {
  const cal = getCalendar();
  const dateStr = String(booking.session_date).split('T')[0];
  const title = booking.session_type + ' — ' + booking.first_name + ' ' + booking.last_name;
  await cal.events.patch({
    calendarId: CALENDAR_ID,
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
  await cal.events.delete({ calendarId: CALENDAR_ID, eventId: eventId });
}

async function getExternalEvents(daysAhead) {
  const cal = getCalendar();
  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + (daysAhead || 90));
  const r = await cal.events.list({
    calendarId: CALENDAR_ID,
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });
  return r.data.items || [];
}

module.exports = { createEvent, updateEvent, deleteEvent, getExternalEvents, CALENDAR_ID };
