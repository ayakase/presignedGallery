import Redis from "ioredis";

// Kết nối tới Redis local port 6379
export const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: 1,
});

redis.on("connect", () => {
  console.log("🟢 Connected to Redis Cache!");
});

redis.on("error", (err) => {
  console.error("🔴 Redis Error:", err.message);
});
