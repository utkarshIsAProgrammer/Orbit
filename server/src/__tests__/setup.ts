/**
 * Global Jest setup.
 * Initializes a MongoDB memory server and writes the URI to a config file
 * so setupFiles can read it (globalSetup runs in a separate process).
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import * as fs from "fs";
import * as path from "path";

const globalConfigPath = path.join(__dirname, "globalConfig.json");

export default async function globalSetup(): Promise<void> {
  const mongod = await MongoMemoryServer.create({
    instance: {
      dbName: "orbit-test",
    },
  });

  const uri = mongod.getUri();

  // Write URI to disk so setupFiles can read it (different process)
  fs.writeFileSync(globalConfigPath, JSON.stringify({ mongodUri: uri }));

  // Also set env vars for convenience in this process
  process.env.MONGO_URI = uri;
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "test-jwt-secret-key-for-testing-only";
  process.env.CLIENT_URL = "http://localhost:3000";
  process.env.UPSTASH_REDIS_REST_URL = "http://localhost:6379";
  process.env.UPSTASH_REDIS_REST_TOKEN = "";
  process.env.CLOUDINARY_NAME = "test";
  process.env.CLOUDINARY_API_KEY = "test";
  process.env.CLOUDINARY_API_SECRET = "test";
  process.env.SMTP_HOST = "test";
  process.env.SMTP_USER = "test";
  process.env.SMTP_PASS = "test";

  // Store reference for teardown
  (global as any).__MONGOD__ = mongod;
}
