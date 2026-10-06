import dotenv from "dotenv";
import crypto from "crypto";
import { redis } from "./redis.js";
dotenv.config();

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// 1. Lấy thông tin từ file .env
const region = process.env.AWS_REGION || "ap-southeast-1";

// 2. Khởi tạo đối tượng kết nối S3
export const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

export const getBucketName = () => {
  const name = process.env.AWS_BUCKET_NAME;
  if (!name) {
    throw new Error("AWS_BUCKET_NAME is not defined in .env file!");
  }
  return name;
};

/**
 * Hàm 1: Đẩy một file (buffer dữ liệu) lên S3
 */
export async function uploadFileToS3(params: {
  key: string; // Tên định danh file trên S3
  buffer: Buffer; // Dữ liệu nhị phân của file
  contentType: string; // image/png, image/jpeg...
}) {
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: params.key,
    Body: params.buffer,
    ContentType: params.contentType,
  });
  return await s3Client.send(command);
}

/**
 * Hàm 2: Xóa một file trên S3
 */
export async function deleteFileFromS3(key: string) {
  const command = new DeleteObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });
  return await s3Client.send(command);
}

/**
 * Hàm 3: Lấy dữ liệu file từ S3 về Server
 */
export async function getFileFromS3(key: string) {
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });
  return await s3Client.send(command);
}

/**
 * Hàm 4: Sinh Pre-signed GET URL để Client xem/tải trực tiếp từ S3 (Hạn 5 phút)
 */
export async function generatePresignedDownloadUrl(params: {
  s3Key: string;
  fileName: string;
  mode?: "inline" | "attachment";
  expiresInSeconds?: number;
}) {
  const { s3Key, fileName, mode = "inline", expiresInSeconds = 900 } = params;
  // 1. Khóa Cache trong Redis: ví dụ presigned:get:users/1/cat.jpg
  const cacheKey = `presigned:${mode}:${s3Key}`;
  // 2. Thử lấy từ Redis
  try {
    const cachedUrl = await redis.get(cacheKey);
    if (cachedUrl) {
      console.log("🚀 HIT CACHE! Trả về link cũ giống hệt 100%");
      return cachedUrl; // 🚀 HIT CACHE! Trả về link cũ giống hệt 100%
    }
  } catch (e) {
    console.error("🔴 Redis Error:", e.message);
  }
  // 3. MISS CACHE: Sinh link mới
  const contentDisposition =
    mode === "attachment"
      ? `attachment; filename="${encodeURIComponent(fileName)}"`
      : `inline; filename="${encodeURIComponent(fileName)}"`;
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: s3Key,
    ResponseContentDisposition: contentDisposition,
  });
  const presignedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: expiresInSeconds,
  });
  // 4. Lưu vào Redis với TTL = 840s (14 phút)
  try {
    await redis.set(cacheKey, presignedUrl, "EX", expiresInSeconds - 60);
  } catch (e) {}
  return presignedUrl;
}
export async function generatePresignedUploadUrl(params: {
  userId: number;
  fileName: string;
  mimeType: string;
  expiresInSeconds?: number;
}) {
  const { userId, fileName, mimeType, expiresInSeconds = 900 } = params;
  // 1. Chuẩn hóa tên file & tạo S3 Key cô lập theo User
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniqueId = crypto.randomUUID();
  const s3Key = `users/${userId}/${uniqueId}-${safeName}`;
  // 2. Tạo PutObjectCommand
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: s3Key,
    ContentType: mimeType, // Bắt buộc Client gửi đúng Content-Type này
  });
  // 3. Ký số URL (hạn 15 phút để người dùng mạng chậm tha hồ upload)
  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: expiresInSeconds,
  });
  return { uploadUrl, s3Key };
}
