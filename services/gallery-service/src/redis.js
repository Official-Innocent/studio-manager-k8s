'use strict';
const { createClient } = require('redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
let publisher = null;

async function getPublisher() {
  if (publisher) return publisher;
  publisher = createClient({ url: REDIS_URL });
  publisher.on('error', (e) => console.error('[gallery-service] Redis error:', e.message));
  await publisher.connect();
  console.log('[gallery-service] Redis publisher connected');
  return publisher;
}

async function publish(event, data) {
  try {
    const pub = await getPublisher();
    await pub.publish(event, JSON.stringify(data));
    console.log('[gallery-service] published:', event);
  } catch(e) {
    console.error('[gallery-service] publish failed:', e.message);
  }
}

module.exports = { publish };
