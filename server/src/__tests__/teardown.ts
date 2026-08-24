/**
 * Global Jest teardown.
 * Stops the MongoDB memory server and cleans up the config file.
 */
import mongoose from "mongoose";
import * as fs from "fs";
import * as path from "path";

const globalConfigPath = path.join(__dirname, "globalConfig.json");

export default async function globalTeardown(): Promise<void> {
  // Disconnect Mongoose
  await mongoose.disconnect();

  // Stop MongoDB memory server
  const mongod: any = (global as any).__MONGOD__;
  if (mongod) {
    await mongod.stop();
  }

  // Clean up config file
  try {
    if (fs.existsSync(globalConfigPath)) {
      fs.unlinkSync(globalConfigPath);
    }
  } catch {
    // Ignore cleanup errors
  }
}
