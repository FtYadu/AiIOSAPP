import http from 'node:http';

import { createApp } from './app';
import { runtimeConfig } from '@config/env';

const app = createApp();

const server = http.createServer(app);

server.listen(runtimeConfig.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Gateway listening on port ${runtimeConfig.port}`);
});
