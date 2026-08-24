import { config } from "dotenv";
import { resolve } from "path";

const possiblePaths = [
  resolve(process.cwd(), "backend/.env"),
  resolve(process.cwd(), ".env"),
  resolve(__dirname, "../.env"),
];

for (const p of possiblePaths) {
  config({ path: p });
}
