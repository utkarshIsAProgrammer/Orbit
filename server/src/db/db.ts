import mongoose from "mongoose";
import { env } from "../configs/env";
import { logger } from "../utilities/logger";
import Repost from "../models/repost.model";

const MAX_RETRIES = 5;
const RETRY_DELAY = 5000;

export const connectDB = async (
  retryCount = 0,
): Promise<mongoose.Connection> => {
  try {
    // Environment-aware pool sizing. 100 connections × N instances adds up
    // fast against a shared Atlas cluster's connection cap — 50 is plenty at
    // this scale and leaves headroom for the cluster + other instances.
    const poolSize = process.env.DB_POOL_SIZE
      ? parseInt(process.env.DB_POOL_SIZE, 10)
      : env.NODE_ENV === "production"
        ? 50
        : 25;

    const conn = await mongoose.connect(env.MONGO_URI, {
      maxPoolSize: poolSize,
      minPoolSize: env.NODE_ENV === "production" ? 10 : 2,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      retryReads: true,
      heartbeatFrequencyMS: 10000,
      // Production: DON'T build/check ~35 models' worth of indexes at every
      // boot (dozens of createIndex round-trips against Atlas on every
      // deploy). Indexes are built deliberately via `npm run db:sync-indexes`
      // after a schema change. Dev keeps auto-indexing so local work is
      // friction-free.
      autoIndex: env.NODE_ENV !== "production",
    });

    logger.info(`MongoDB connected successfully!`, {
      host: conn.connection.host,
    });

    // One-time migration artifacts (Repost index reconciliation + dropping the
    // deprecated 'glimpses' collection) — already applied to production, so
    // they only run in dev/test. Production index changes are applied
    // deliberately via `npm run db:sync-indexes`.
    if (env.NODE_ENV !== "production") {
      // The old Repost schema had a plain unique {user, post} index which
      // rejects external reposts (post: null); syncIndexes drops it and
      // builds the partial-filter equivalents.
      try {
        await Repost.syncIndexes();
        logger.info("Repost collection indexes synchronized.");
      } catch (idxErr) {
        logger.warn("Failed to sync Repost indexes", {
          error: (idxErr as Error).message,
        });
      }

      // Clean up old 'glimpses' collection if it exists to ensure it is not
      // created again
      try {
        const db = conn.connection.db;
        if (db) {
          const collections = await db
            .listCollections({ name: "glimpses" })
            .toArray();
          if (collections.length > 0) {
            await db.dropCollection("glimpses");
            logger.info(
              "Successfully dropped deprecated 'glimpses' collection from MongoDB",
            );
          }
        }
      } catch (dbErr) {
        logger.warn("Failed to drop deprecated 'glimpses' collection", {
          error: (dbErr as Error).message,
        });
      }
    }

    mongoose.connection.on("error", (err) => {
      logger.error("MongoDB connection error", { error: err.message });
    });

    mongoose.connection.on("disconnected", () => {
      logger.warn("MongoDB disconnected — will auto-reconnect");
    });

    mongoose.connection.on("reconnected", () => {
      logger.info("MongoDB reconnected successfully");
    });

    // Enhanced auto-reconnect: if Mongoose fails to reconnect internally,
    // attempt an explicit reconnect with backoff. Only active when disconnected.
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    let reconnectTimer: ReturnType<typeof setInterval> | null = null;
    let isReconnecting = false;

    const attemptReconnect = async () => {
      if (isReconnecting) return;
      isReconnecting = true;

      try {
        if (mongoose.connection.readyState === 1) {
          reconnectAttempts = 0;
          return;
        }

        reconnectAttempts++;
        if (reconnectAttempts > maxReconnectAttempts) {
          if (reconnectTimer) {
            clearInterval(reconnectTimer);
            reconnectTimer = null;
          }
          logger.error("Max MongoDB reconnect attempts reached. Giving up.");
          return;
        }

        logger.info(
          `MongoDB reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts}...`,
        );
        await mongoose.connect(env.MONGO_URI, {
          maxPoolSize: poolSize,
          minPoolSize: env.NODE_ENV === "production" ? 10 : 2,
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
          autoIndex: env.NODE_ENV !== "production",
        });
        logger.info("MongoDB explicitly reconnected after disconnect");
        reconnectAttempts = 0;

        // Connected again — stop polling
        if (reconnectTimer) {
          clearInterval(reconnectTimer);
          reconnectTimer = null;
        }
      } catch (err: any) {
        logger.error("MongoDB explicit reconnect failed", {
          error: err.message,
          attempt: reconnectAttempts,
        });
      } finally {
        isReconnecting = false;
      }
    };

    // Only start the polling timer when the connection drops
    mongoose.connection.on("disconnected", () => {
      logger.warn("MongoDB disconnected — starting auto-reconnect polling");

      if (!reconnectTimer) {
        reconnectTimer = setInterval(attemptReconnect, 15000); // Check every 15 seconds
      }
    });

    mongoose.connection.on("connected", () => {
      // Connection restored — stop polling
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
      reconnectAttempts = 0;
    });

    return conn.connection;
  } catch (err: any) {
    logger.error("MongoDB connection failed", {
      error: err.message,
      attempt: retryCount + 1,
    });

    if (retryCount < MAX_RETRIES) {
      logger.info(
        `Retrying MongoDB connection in ${RETRY_DELAY / 1000} seconds...`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return connectDB(retryCount + 1);
    } else {
      logger.error("Max retries reached, could not connect to MongoDB");
      throw new Error("Failed to connect to MongoDB after max retries");
    }
  }
};
