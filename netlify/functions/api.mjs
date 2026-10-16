import { createHostedHandler } from '../../lib/hosted-api.mjs';

export default createHostedHandler();

export const config = {
  path: '/api/*',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
