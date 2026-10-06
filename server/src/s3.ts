import dotenv from "dotenv";
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
  const { s3Key, fileName, mode = "inline", expiresInSeconds = 300 } = params;

  const contentDisposition =
    mode === "attachment"
      ? `attachment; filename="${encodeURIComponent(fileName)}"`
      : `inline; filename="${encodeURIComponent(fileName)}"`;

  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: s3Key,
    ResponseContentDisposition: contentDisposition,
  });

  // Ký số cục bộ (chạy offline bằng CPU, siêu nhanh ~0.05ms)
  return await getSignedUrl(s3Client, command, {
    expiresIn: expiresInSeconds,
  });
}
