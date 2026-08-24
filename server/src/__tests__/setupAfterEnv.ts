/**
 * Setup file that runs before each test suite.
 * Reads the MongoDB URI from a config file written by globalSetup
 * (which runs in a different process), then connects Mongoose.
 */
import mongoose from "mongoose";
import * as fs from "fs";
import * as path from "path";

// Mock Socket.IO — prevents crashes from controllers calling emit functions
// when Socket.IO isn't initialized (as it isn't in isolated test apps).
// This must be before any controller imports.
jest.mock("../configs/socket", () => require("./helpers/mockSocket"));

const globalConfigPath = path.join(__dirname, "globalConfig.json");

let uri: string | null = null;

// Try reading the URI from the global config file
try {
  if (fs.existsSync(globalConfigPath)) {
    const config = JSON.parse(fs.readFileSync(globalConfigPath, "utf-8"));
    uri = config.mongodUri || process.env.MONGO_URI || null;
  } else {
    uri = process.env.MONGO_URI || null;
  }
} catch {
  uri = process.env.MONGO_URI || null;
}

// Connect to the in-memory MongoDB instance
if (uri && mongoose.connection.readyState === 0) {
  mongoose.connect(uri, { maxPoolSize: 10 }).catch((err) => {
    console.error("Failed to connect to MongoDB memory server:", err.message);
  });
}
