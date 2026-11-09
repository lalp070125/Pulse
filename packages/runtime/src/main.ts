import { DEFAULT_PORT, PRODUCT_NAME } from '@pulso/core';
import { startServer } from './server';

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? DEFAULT_PORT);

startServer({ port, ui: production ? 'static' : 'dev' })
  .then((server) => {
    console.log(`${PRODUCT_NAME} is running on http://localhost:${server.port}`);
    console.log(production ? '(production: serving built UI)' : '(development: live reload on)');
  })
  .catch((err: unknown) => {
    console.error(`${PRODUCT_NAME} could not start:`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
