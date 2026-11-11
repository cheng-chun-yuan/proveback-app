import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('./data/db.json', import.meta.url));
let db = { policies: [], meetings: [], sessions: [] };

if (fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, 'utf8'));

export function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(db, null, 2));
}

export { db };
