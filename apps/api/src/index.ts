import { serve } from '@hono/node-server';
import { createApp } from './app';

const { app, cfg, fake } = createApp();
const mode = (isFake: boolean) => (isFake ? 'fake mode' : 'enabled');

serve({ fetch: app.fetch, port: cfg.port }, () => {
  console.log(`proveback api: http://localhost:${cfg.port}/api/v1  (web: ${cfg.webUrl})`);
  console.log(`  Google: ${mode(fake.google)}   Recall: ${mode(fake.recall)}   Self: ${mode(fake.self)}`);
  if (cfg.recall && !cfg.recall.webhookToken) console.warn('  WARNING: RECALL_WEBHOOK_TOKEN is not set, so all Recall webhooks will be rejected');
  if (!process.env.SESSION_SECRET) console.warn('  WARNING: SESSION_SECRET is not set, so the nullifier hash key changes on restart and returning guests will not be recognized');
});
