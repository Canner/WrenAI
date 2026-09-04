import path from "node:path";
import { fileURLToPath } from "node:url";
import { installContextLoader } from "./installer.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  await installContextLoader({ packageRoot });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
