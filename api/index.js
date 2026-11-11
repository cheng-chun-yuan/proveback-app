// Vercel function entry. The bundle is produced by `npm run build:vercel` (apps/api/dist is gitignored).
export { default, GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } from '../apps/api/dist/vercel.js';
