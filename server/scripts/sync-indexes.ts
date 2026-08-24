/**
 * Build missing indexes for every registered Mongoose model — the deliberate
 * production index path now that the server runs with `autoIndex: false` in
 * production (boot-time index building for ~35 models is skipped so deploys
 * don't hammer Atlas with createIndex round-trips).
 *
 * Uses createIndexes() (builds MISSING indexes, NEVER drops) — unlike
 * syncIndexes() it can't remove an index that exists in the DB but not the
 * schema (e.g. a hand-created or Atlas Performance-Advisor-suggested index).
 *
 * Run after deploying a schema change that adds/alters indexes:
 *   npm run db:sync-indexes
 */
import "./load-env"; // must run before src imports (env validation)
import { readdirSync } from "fs";
import { join } from "path";
import mongoose from "mongoose";
import { env } from "../src/configs/env";

async function main() {
  // Never auto-build on import/connect — only what we explicitly create below.
  mongoose.set("autoIndex", false);

  // Register every model with Mongoose (module-load side effect).
  const modelsDir = join(__dirname, "../src/models");
  const modelFiles = readdirSync(modelsDir).filter(
    (f) => f.endsWith(".model.ts") || f.endsWith(".model.js"),
  );
  for (const f of modelFiles) {
    await import(join(modelsDir, f));
  }
  console.log(`Registered ${modelFiles.length} model files.`);

  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 60000,
  });
  console.log(`Connected to ${mongoose.connection.host}.`);

  // Drop stale LEGACY indexes whose auto-generated names collide with the
  // schema's explicitly-named partial indexes. Pre-partial-filter versions of
  // {user, post} unique indexes (name `user_1_post_1`) exist on Save/Repost
  // from before external posts — they're harmful (their non-partial
  // uniqueness lets a user save/repost only ONE external post) and block
  // building the partial replacement under the same name. Now that the schema
  // names its partial indexes `user_1_post_1_partial` etc., createIndexes
  // builds them fine — but the stale legacy index must still be removed.
  const legacyIndexTargets: Record<string, string[]> = {
    saves: ["user_1_post_1", "user_1_externalPost_1"],
    reposts: ["user_1_post_1", "user_1_externalPost_1"],
  };
  for (const [collection, indexNames] of Object.entries(legacyIndexTargets)) {
    try {
      const col = mongoose.connection.db!.collection(collection);
      const existing = await col.indexes();
      for (const idx of existing) {
        if (indexNames.includes(idx.name)) {
          await col.dropIndex(idx.name);
          console.log(`dropped legacy index ${collection}.${idx.name}`);
        }
      }
    } catch (err: any) {
      console.warn(`legacy index cleanup skipped for ${collection}: ${err.message}`);
    }
  }

  const names = mongoose.modelNames();
  for (const name of names) {
    const model = mongoose.model(name);
    const before = Date.now();
    try {
      await model.createIndexes();
      console.log(`indexes ensured: ${name} (${Date.now() - before}ms)`);
    } catch (err: any) {
      // Index-name collision: the DB holds a LEGACY index that shares a name
      // with a schema index but has different options. Classic case — the
      // old plain unique {user, post} on Save/Repost (created before external
      // posts existed) vs. the schema's partial-filter version that allows
      // post: null. createIndexes never drops, so Mongo refuses to build the
      // replacement under the same auto-generated name.
      //
      // Fall back to syncIndexes() for THIS model only: it drops the stale
      // index (and any other non-schema index on this collection) and builds
      // the schema's. This is the same migration Repost got at boot — and it
      // self-heals any future partial-filter/unique changes.
      console.warn(
        `conflict on ${name}: ${err.message}` +
          ` — falling back to syncIndexes() for this model only`,
      );
      try {
        await model.syncIndexes();
        console.log(`indexes synced (legacy index dropped): ${name} (${Date.now() - before}ms)`);
      } catch (syncErr: any) {
        console.error(`FAILED ${name}: ${syncErr.message}`);
        process.exitCode = 1;
      }
    }
  }

  console.log(process.exitCode ? "Done (with errors)." : "Done.");
  await mongoose.disconnect();
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
