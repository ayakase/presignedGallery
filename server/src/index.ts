import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, desc, count } from "drizzle-orm";
import crypto from "crypto";
import { db } from "./db/index.js";
import { files } from "./db/schema.js";
import {
  uploadFileToS3,
  getFileFromS3,
  deleteFileFromS3,
  generatePresignedDownloadUrl,
} from "./s3.js";

const app = new Hono();
app.use("/*", cors());

// ==========================================
// 1. UPLOAD FILE (Tạm thời giữ cách cũ, chuẩn bị nâng cấp)
// ==========================================
app.post("/api/files/upload", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || !(file instanceof File)) {
    return c.json({ error: "Không tìm thấy file hợp lệ" }, 400);
  }
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const s3Key = `users/1/${crypto.randomUUID()}-${safeName}`;

  await uploadFileToS3({
    key: s3Key,
    buffer,
    contentType: file.type || "application/octet-stream",
  });

  const [newFile] = await db
    .insert(files)
    .values({
      name: file.name,
      s3Key,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      userId: 1,
      folderId: null,
    })
    .returning();

  return c.json(newFile, 201);
});

// ==========================================
// 2. PHÂN TRANG (5 files/trang) & BATCH SIGNING PRE-SIGNED URLS
// ==========================================
app.get("/api/files", async (c) => {
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = parseInt(c.req.query("limit") || "5", 10);
  const offset = (page - 1) * limit;

  // 1. Đếm tổng số bản ghi trong SQLite
  const [{ total }] = await db.select({ total: count() }).from(files);

  // 2. Lấy 5 bản ghi của trang hiện tại (xếp mới nhất lên đầu)
  const fileRecords = await db
    .select()
    .from(files)
    .orderBy(desc(files.id))
    .limit(limit)
    .offset(offset);

  // 3. BATCH SIGNING: Ký số hàng loạt cho cả 5 file cùng lúc (~1ms CPU)
  const data = await Promise.all(
    fileRecords.map(async (file) => ({
      ...file,
      // Tạo Pre-signed GET URL trực tiếp từ S3 (hạn 5 phút)
      presignedUrl: await generatePresignedDownloadUrl({
        s3Key: file.s3Key,
        fileName: file.name,
        mode: "inline",
        expiresInSeconds: 300,
      }),
    }))
  );

  return c.json({
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  });
});

// ==========================================
// 3. XEM ẢNH CŨ (QUA SERVER PROXY) - Giữ để đối chiếu
// ==========================================
app.get("/api/files/:id/view", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const [fileRecord] = await db.select().from(files).where(eq(files.id, id));
  if (!fileRecord) return c.text("File not found", 404);

  const s3Response = await getFileFromS3(fileRecord.s3Key);
  c.header("Content-Type", fileRecord.mimeType);
  return c.body(s3Response.Body as any);
});

// ==========================================
// 4. XÓA FILE
// ==========================================
app.delete("/api/files/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const [fileRecord] = await db.select().from(files).where(eq(files.id, id));
  if (!fileRecord) return c.text("File not found", 404);

  await deleteFileFromS3(fileRecord.s3Key);
  await db.delete(files).where(eq(files.id, id));
  return c.json({ success: true });
});

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`🚀 Server running on http://localhost:${info.port}`);
});
