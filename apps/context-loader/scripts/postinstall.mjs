import path from "node:path";
import { fileURLToPath } from "node:url";
import { installContextLoader, isRepositorySourcePackage } from "./installer.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (await isRepositorySourcePackage(packageRoot)) process.exit(0);

try {
  await installContextLoader({ packageRoot });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
