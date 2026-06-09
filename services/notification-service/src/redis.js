'use strict';
const { createClient } = require('redis');
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
function createSubscriber() {
  let logged = false;
  const client = createClient({
    url: REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries >= 3) {
          if (!logged) {
            console.log('[notification-service] Redis max retries — REST-only mode');
            logged = true;
          }
          return new Error('Redis unavailable');
        }
        return Math.min(retries * 500, 2000);
      }
    }
  });
  client.on('error', () => {});
  return client;
}
module.exports = { createSubscriber };
