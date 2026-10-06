import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
// 1. BẢNG FOLDERS
export const folders = sqliteTable("folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  parentId: integer("parent_id").references((): any => folders.id, {
    onDelete: "cascade",
  }),
  userId: integer("user_id").notNull().default(1),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`),
});

// 2. BẢNG FILES (Metadata của file lưu trên S3)
export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  s3Key: text("s3_key").notNull().unique(),
  size: integer("size").notNull(),
  mimeType: text("mime_type").notNull(),
  folderId: integer("folder_id").references(() => folders.id, {
    onDelete: "cascade",
  }),

  userId: integer("user_id").notNull().default(1),
  thumbnailKey: text("thumbnail_key"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`),
});

// Export TypeScript types để tái sử dụng ở các tầng khác
export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
export type FileItem = typeof files.$inferSelect;
export type NewFileItem = typeof files.$inferInsert;
