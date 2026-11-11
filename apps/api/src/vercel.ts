// Vercel serverless entry (Node.js runtime). Bundled to dist/vercel.js by `npm run build:vercel`; api/index.js re-exports it.
import { handle } from 'hono/vercel';
import { createApp } from './app';

const { app } = createApp();
const handler = handle(app);

// Vercel's Node.js runtime treats a default export that has `fetch` (or named method exports) as a Web handler
// (Request -> Response, streaming included); a bare default function would be called as (req, res) instead.
export default Object.assign(handler, { fetch: handler });
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
