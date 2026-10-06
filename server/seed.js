import fs from "fs";
import path from "path";
import axios from "axios";

const API_BASE = "http://localhost:3000/api";
const ROOT_PROJECT_DIR = path.resolve(process.cwd(), ".."); // Thư mục presignedGallery

// Các extension muốn quét để seed
const ALLOWED_EXTENSIONS = [".js", ".ts", ".json", ".html", ".svelte", ".css"];
// Bỏ qua các thư mục không cần thiết
const IGNORED_DIRS = ["node_modules", ".git", "data", "dist", ".svelte-kit"];

// Danh sách tên folder ngẫu nhiên cho sinh động
const FOLDER_NAMES = [
  "assets", "components", "utils", "modules", "configs", 
  "controllers", "routes", "services", "styles", "templates",
  "views", "hooks", "helpers", "libs", "types", "constants"
];

function getRandomFolderName() {
  const name = FOLDER_NAMES[Math.floor(Math.random() * FOLDER_NAMES.length)];
  const randomSuffix = Math.floor(Math.random() * 900 + 100);
  return `${name}_${randomSuffix}`;
}

// 1. Quét tìm tất cả các file mã nguồn hợp lệ trong project
function scanProjectFiles(dir, collectedFiles = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.includes(entry.name)) {
        scanProjectFiles(fullPath, collectedFiles);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.includes(ext)) {
        collectedFiles.push(fullPath);
      }
    }
  }

  return collectedFiles;
}

// Lấy mimeType cơ bản dựa theo extension
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".js": return "application/javascript";
    case ".ts": return "text/plain";
    case ".json": return "application/json";
    case ".html": return "text/html";
    case ".svelte": return "text/plain";
    case ".css": return "text/css";
    default: return "application/octet-stream";
  }
}

// 2. Upload 1 file thông qua Pre-signed URL flow
async function uploadFileDirectToS3(filePath, folderId = null) {
  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const size = fileBuffer.length;
  const mimeType = getMimeType(filePath);

  // Bước 1: Xin pre-signed upload URL từ Server
  const presignRes = await axios.post(`${API_BASE}/files/upload-url`, {
    fileName,
    mimeType,
  });
  const { uploadUrl, s3Key } = presignRes.data;

  // Bước 2: Bắn trực tiếp dữ liệu file lên S3 qua PUT
  await axios.put(uploadUrl, fileBuffer, {
    headers: { "Content-Type": mimeType },
  });

  // Bước 3: Confirm với server để lưu vào SQLite DB
  const confirmRes = await axios.post(`${API_BASE}/files/confirm`, {
    name: fileName,
    s3Key,
    size,
    mimeType,
    folderId,
  });

  return confirmRes.data;
}

// 3. Tạo Folder trên server
async function createFolder(name, parentId = null) {
  const res = await axios.post(`${API_BASE}/folders`, {
    name,
    parentId,
  });
  return res.data;
}

// Hàm lấy ngẫu nhiên 1 phần tử trong danh sách file mẫu
function pickRandomFile(filesList) {
  return filesList[Math.floor(Math.random() * filesList.length)];
}

async function main() {
  console.log("🔍 Đang quét các file mẫu trong project...");
  const sampleFiles = scanProjectFiles(ROOT_PROJECT_DIR);

  if (sampleFiles.length === 0) {
    console.error("❌ Không tìm thấy file code nào hợp lệ trong project!");
    process.exit(1);
  }

  console.log(`✅ Tìm thấy ${sampleFiles.length} file mẫu (.js, .ts, .json, .svelte, .css, .html).`);
  console.log("🚀 Bắt đầu khởi tạo cấu trúc thư mục & Upload file lên S3...\n");

  /**
   * CẤU TRÚC SEED THEO YÊU CẦU:
   * Level 0 (Root): 5 entity = 3 folder + 2 file
   * Trong mỗi folder của Level 1: 3 entity = 2 folder + 1 file
   * Trong mỗi folder của Level 2: 3 entity = 2 folder + 1 file
   * Trong mỗi folder của Level 3: 3 entity = 2 folder + 1 file
   */

  // --- LEVEL 0: ROOT ---
  console.log("📁 Đang tạo Root (2 file, 3 folder)...");
  for (let i = 0; i < 2; i++) {
    const f = pickRandomFile(sampleFiles);
    await uploadFileDirectToS3(f, null);
    console.log(`   📄 [Root] Đã upload file: ${path.basename(f)}`);
  }

  const level1Folders = [];
  for (let i = 0; i < 3; i++) {
    const folder = await createFolder(getRandomFolderName(), null);
    level1Folders.push(folder);
    console.log(`   📂 [Root] Đã tạo folder: ${folder.name} (id: ${folder.id})`);
  }

  // --- LEVEL 1: Trong 3 folders của Level 1 ---
  const level2Folders = [];
  for (const l1 of level1Folders) {
    console.log(`\n📁 Vào thư mục cấp 1: /${l1.name}`);
    // 1 file
    const f = pickRandomFile(sampleFiles);
    await uploadFileDirectToS3(f, l1.id);
    console.log(`   📄 Đã upload file: ${path.basename(f)}`);

    // 2 folders
    for (let i = 0; i < 2; i++) {
      const folder = await createFolder(getRandomFolderName(), l1.id);
      level2Folders.push(folder);
      console.log(`   📂 Đã tạo subfolder: ${folder.name} (id: ${folder.id})`);
    }
  }

  // --- LEVEL 2: Trong các folders của Level 2 ---
  const level3Folders = [];
  for (const l2 of level2Folders) {
    console.log(`\n📁 Vào thư mục cấp 2: [id:${l2.id}] ${l2.name}`);
    // 1 file
    const f = pickRandomFile(sampleFiles);
    await uploadFileDirectToS3(f, l2.id);
    console.log(`   📄 Đã upload file: ${path.basename(f)}`);

    // 2 folders
    for (let i = 0; i < 2; i++) {
      const folder = await createFolder(getRandomFolderName(), l2.id);
      level3Folders.push(folder);
      console.log(`   📂 Đã tạo subfolder: ${folder.name} (id: ${folder.id})`);
    }
  }

  // --- LEVEL 3: Lần đệ quy cuối cùng ---
  for (const l3 of level3Folders) {
    console.log(`\n📁 Vào thư mục cấp 3: [id:${l3.id}] ${l3.name}`);
    // 1 file
    const f = pickRandomFile(sampleFiles);
    await uploadFileDirectToS3(f, l3.id);
    console.log(`   📄 Đã upload file: ${path.basename(f)}`);

    // 2 folders
    for (let i = 0; i < 2; i++) {
      const folder = await createFolder(getRandomFolderName(), l3.id);
      console.log(`   📂 Đã tạo subfolder: ${folder.name} (id: ${folder.id})`);
    }
  }

  console.log("\n🎉 HOÀN THÀNH SEED DỮ LIỆU!");
  console.log("👉 Giờ ông có thể reload browser để xem cấu trúc thư mục lồng nhau nhiều tầng và test Duyệt Đệ Quy (DFS)!");
}

main().catch((err) => {
  console.error("❌ Lỗi trong quá trình seed:", err.response?.data || err.message);
});

