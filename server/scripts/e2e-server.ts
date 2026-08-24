/**
 * Standalone E2E server — in-memory Mongo + the REAL socket layer, used by
 * the browser-level blue-tick test (scripts/../__tests__ is mocked, but
 * this runs the real thing). Not part of the test suite; started manually.
 *
 *   npx tsx scripts/e2e-server.ts
 */
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://placeholder:27017/orbit-e2e"; // validated at import; real URI used below
process.env.JWT_SECRET = "e2e-jwt-secret-for-blue-tick-test";
process.env.CLIENT_URL = "http://127.0.0.1:4180";
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";
process.env.UPSTASH_REDIS_URL = "";
process.env.CLOUDINARY_NAME = "test";
process.env.CLOUDINARY_API_KEY = "test";
process.env.CLOUDINARY_API_SECRET = "test";
process.env.SMTP_HOST = "test";
process.env.SMTP_USER = "test";
process.env.SMTP_PASS = "test";
process.env.TRUST_PROXY = "1";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import express from "express";
import cookieParser from "cookie-parser";
import http from "http";

const PORT = Number(process.env.E2E_PORT || 5010);

async function main(): Promise<void> {
  const mongod = await MongoMemoryServer.create({ instance: { dbName: "orbit-e2e" } });
  await mongoose.connect(mongod.getUri());

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  const { authRoutes } = await import("../src/routes/auth.routes");
  const { chatRoutes } = await import("../src/routes/chat.routes");
  const { userRoutes } = await import("../src/routes/user.routes");
  const { notificationRoutes } = await import("../src/routes/notification.routes");

  app.use("/api/auth", authRoutes);
  app.use("/api/chats", chatRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/notifications", notificationRoutes);

  app.use(
    (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    },
  );

  const { initSocket } = await import("../src/configs/socket");
  const server = http.createServer(app);
  await initSocket(server);
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`E2E server listening on http://127.0.0.1:${PORT}`);
  });

  const shutdown = async () => {
    const { shutdownSocket } = await import("../src/configs/socket");
    await shutdownSocket();
    server.close();
    await mongoose.disconnect();
    await mongod.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("E2E server failed:", e);
  process.exit(1);
});
