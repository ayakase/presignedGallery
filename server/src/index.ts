import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, desc, count, isNull, and, inArray, like } from "drizzle-orm";
import crypto from "crypto";
import { db } from "./db/index.js";
import { files, folders, type Folder, type FileItem } from "./db/schema.js";
import {
  deleteFileFromS3,
  generatePresignedDownloadUrl,
  generatePresignedUploadUrl,
} from "./s3.js";

const app = new Hono();
app.use("/*", cors());

// ==========================================
// THUẬT TOÁN ĐỆ QUY DUYỆT CÂY THƯ MỤC (DFS)
// ==========================================
interface RecursiveFolderNode {
  folder: Folder;
  path: string;
  files: (FileItem & { folderPath: string })[];
  subfolders: RecursiveFolderNode[];
}

async function traverseFolderDfs(
  folderId: number | null,
  currentPath: string = ""
): Promise<{
  node: RecursiveFolderNode;
  allFiles: (FileItem & { folderPath: string })[];
  allFolderIds: number[];
}> {
  // 1. Trường hợp duyệt từ Root (folderId = null)
  if (folderId === null) {
    const folderPath = "/Root";

    // File nằm ngay dưới Root (folderId is null)
    const directFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.userId, 1), isNull(files.folderId)));

    const directFilesWithPath = directFiles.map((f) => ({
      ...f,
      folderPath,
    }));

    // Các folder cấp 1 nằm dưới Root (parentId is null)
    const childFolders = await db
      .select()
      .from(folders)
      .where(and(eq(folders.userId, 1), isNull(folders.parentId)));

    const subnodes: RecursiveFolderNode[] = [];
    const accumulatedFiles: (FileItem & { folderPath: string })[] = [
      ...directFilesWithPath,
    ];
    const accumulatedFolderIds: number[] = [];

    for (const child of childFolders) {
      const childTraversal = await traverseFolderDfs(child.id, folderPath);
      subnodes.push(childTraversal.node);
      accumulatedFiles.push(...childTraversal.allFiles);
      accumulatedFolderIds.push(...childTraversal.allFolderIds);
    }

    const node: RecursiveFolderNode = {
      folder: { id: 0, name: "Root", parentId: null, userId: 1, createdAt: "" },
      path: folderPath,
      files: directFilesWithPath,
      subfolders: subnodes,
    };

    return {
      node,
      allFiles: accumulatedFiles,
      allFolderIds: accumulatedFolderIds,
    };
  }

  // 2. Trường hợp duyệt từ 1 folder cụ thể
  const [currentFolder] = await db
    .select()
    .from(folders)
    .where(eq(folders.id, folderId));

  if (!currentFolder) {
    throw new Error(`Không tìm thấy thư mục với id ${folderId}`);
  }

  const folderPath = currentPath
    ? `${currentPath}/${currentFolder.name}`
    : `/${currentFolder.name}`;

  // Lấy toàn bộ file nằm trực tiếp trong folder này
  const directFiles = await db
    .select()
    .from(files)
    .where(eq(files.folderId, folderId));

  const directFilesWithPath = directFiles.map((f) => ({
    ...f,
    folderPath,
  }));

  // Tìm tất cả các folder con trực tiếp (parentId = folderId)
  const childFolders = await db
    .select()
    .from(folders)
    .where(eq(folders.parentId, folderId));

  const subnodes: RecursiveFolderNode[] = [];
  const accumulatedFiles: (FileItem & { folderPath: string })[] = [
    ...directFilesWithPath,
  ];
  const accumulatedFolderIds: number[] = [folderId];

  // BƯỚC ĐỆ QUY (RECURSIVE STEP): Duyệt sâu vào từng nhánh folder con
  for (const child of childFolders) {
    const childTraversal = await traverseFolderDfs(child.id, folderPath);
    subnodes.push(childTraversal.node);
    accumulatedFiles.push(...childTraversal.allFiles);
    accumulatedFolderIds.push(...childTraversal.allFolderIds);
  }

  const node: RecursiveFolderNode = {
    folder: currentFolder,
    path: folderPath,
    files: directFilesWithPath,
    subfolders: subnodes,
  };

  return {
    node,
    allFiles: accumulatedFiles,
    allFolderIds: accumulatedFolderIds,
  };
}

// ==========================================
// 1. FOLDERS CRUD APIS & RECURSIVE TRAVERSAL
// ==========================================

// 1.1 Lấy danh sách thư mục con (lọc theo parentId)
app.get("/api/folders", async (c) => {
  const parentIdQuery = c.req.query("parentId");
  const parentId = parentIdQuery ? parseInt(parentIdQuery, 10) : null;

  const result = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.userId, 1),
        parentId === null
          ? isNull(folders.parentId)
          : eq(folders.parentId, parentId)
      )
    );

  return c.json(result);
});

// 1.2 Tạo thư mục mới
app.post("/api/folders", async (c) => {
  const { name, parentId } = await c.req.json();
  if (!name || typeof name !== "string") {
    return c.json({ error: "Tên thư mục không được để trống" }, 400);
  }

  const [newFolder] = await db
    .insert(folders)
    .values({
      name: name.trim(),
      parentId: parentId ? parseInt(parentId, 10) : null,
      userId: 1,
    })
    .returning();

  return c.json(newFolder, 201);
});

// 1.3 ENDPOINT ĐỆ QUY: Gom toàn bộ file lồng nhau ở mọi nhánh con (Hỗ trợ cả 'root' hoặc id)
app.get("/api/folders/:id/recursive", async (c) => {
  const paramId = c.req.param("id");
  const folderId = paramId === "root" ? null : parseInt(paramId, 10);

  if (folderId !== null && isNaN(folderId)) {
    return c.json({ error: "ID thư mục không hợp lệ" }, 400);
  }

  const startTime = performance.now();

  try {
    const { node, allFiles, allFolderIds } = await traverseFolderDfs(folderId);
    const durationMs = (performance.now() - startTime).toFixed(2);

    const totalSize = allFiles.reduce((acc, f) => acc + f.size, 0);

    return c.json({
      rootFolderId: folderId,
      totalFiles: allFiles.length,
      totalSize,
      totalFoldersTraversed: allFolderIds.length,
      executionTimeMs: Number(durationMs),
      files: allFiles,
      tree: node,
    });
  } catch (err: any) {
    return c.json({ error: err.message || "Lỗi duyệt thư mục đệ quy" }, 404);
  }
});

// 1.4 Xóa thư mục: Dùng recursive để gom sạch s3_key rồi dọn sạch trên S3!
app.delete("/api/folders/:id", async (c) => {
  const folderId = parseInt(c.req.param("id"), 10);
  if (isNaN(folderId)) {
    return c.json({ error: "ID thư mục không hợp lệ" }, 400);
  }

  try {
    // 1. Duyệt đệ quy gom sạch các file con cháu để xóa trên S3
    const { allFiles, allFolderIds } = await traverseFolderDfs(folderId);

    for (const file of allFiles) {
      await deleteFileFromS3(file.s3Key).catch((e) =>
        console.error(`Không thể xóa S3 key ${file.s3Key}:`, e)
      );
    }

    // 2. Xóa trong SQLite
    await db.delete(folders).where(inArray(folders.id, allFolderIds));

    return c.json({
      success: true,
      deletedFoldersCount: allFolderIds.length,
      deletedFilesCount: allFiles.length,
    });
  } catch (err: any) {
    return c.json({ error: err.message || "Xóa thư mục thất bại" }, 500);
  }
});

// ==========================================
// 2. FILES APIS (HỖ TRỢ FOLDER & PRE-SIGNED)
// ==========================================

// 2.1 Lấy danh sách files (lọc theo folderId hiện tại, 5 files/trang, Batch Signing)
app.get("/api/files", async (c) => {
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = parseInt(c.req.query("limit") || "5", 10);
  const offset = (page - 1) * limit;

  const folderIdQuery = c.req.query("folderId");
  const folderId = folderIdQuery ? parseInt(folderIdQuery, 10) : null;

  const q = c.req.query("q")?.trim() || "";

  // Nếu có từ khóa search: tìm kiếm trong TOÀN BỘ file của user; ngược lại lọc theo folder
  const filterCondition = q
    ? and(eq(files.userId, 1), like(files.name, `%${q}%`))
    : and(
        eq(files.userId, 1),
        folderId === null ? isNull(files.folderId) : eq(files.folderId, folderId)
      );

  const [{ total }] = await db
    .select({ total: count() })
    .from(files)
    .where(filterCondition);

  const fileRecords = await db
    .select()
    .from(files)
    .where(filterCondition)
    .orderBy(desc(files.id))
    .limit(limit)
    .offset(offset);

  const data = await Promise.all(
    fileRecords.map(async (file) => ({
      ...file,
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

// 2.2 Xin Pre-signed PUT URL để Direct Upload lên S3
app.post("/api/files/upload-url", async (c) => {
  const { fileName, mimeType } = await c.req.json();
  if (!fileName || !mimeType) {
    return c.json({ error: "fileName and mimeType are required" }, 400);
  }

  const { uploadUrl, s3Key } = await generatePresignedUploadUrl({
    userId: 1,
    fileName,
    mimeType,
    expiresInSeconds: 900,
  });

  return c.json({ uploadUrl, s3Key });
});

// 2.3 Confirm file metadata và lưu vào SQLite (kèm folderId)
app.post("/api/files/confirm", async (c) => {
  const { name, s3Key, size, mimeType, folderId } = await c.req.json();

  const [newFile] = await db
    .insert(files)
    .values({
      name,
      s3Key,
      size: Number(size),
      mimeType,
      userId: 1,
      folderId: folderId ? parseInt(folderId, 10) : null,
    })
    .returning();

  return c.json(newFile, 201);
});

// 2.4 Xóa file
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
