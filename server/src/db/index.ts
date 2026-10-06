import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'path';
import fs from 'fs';

// Đảm bảo thư mục server/data luôn tồn tại
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Lưu database vào trong server/data/gallery.db
const dbPath = path.join(dataDir, 'gallery.db');
export const sqlite = new Database(dbPath);

// Cấu hình tối ưu SQLite
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Drizzle ORM instance
export const db = drizzle(sqlite, { schema });
