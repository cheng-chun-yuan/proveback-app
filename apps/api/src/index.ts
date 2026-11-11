import { serve } from '@hono/node-server';
import { createApp } from './app';

const { app, cfg, fake } = createApp();
const mode = (isFake: boolean) => (isFake ? '假資料模式' : '已啟用');

serve({ fetch: app.fetch, port: cfg.port }, () => {
  console.log(`proveback api: http://localhost:${cfg.port}/api/v1  (web: ${cfg.webUrl})`);
  console.log(`  Google: ${mode(fake.google)}   Recall: ${mode(fake.recall)}   Self: ${mode(fake.self)}`);
  if (cfg.recall && !cfg.recall.webhookToken) console.warn('  ⚠ 未設定 RECALL_WEBHOOK_TOKEN,Recall webhook 會全部被拒絕');
  if (!process.env.SESSION_SECRET) console.warn('  ⚠ 未設定 SESSION_SECRET:重啟後 nullifier 雜湊會換一把,回訪的來賓無法被認出是同一人');
});
