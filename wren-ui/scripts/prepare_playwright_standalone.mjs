import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const distDirName = process.env.NEXT_DIST_DIR || '.next';
const distDir = path.join(rootDir, distDirName);
const standaloneDir = path.join(distDir, 'standalone');
const standaloneStaticDir = path.join(standaloneDir, distDirName, 'static');
const standalonePublicDir = path.join(standaloneDir, 'public');

const copyDirectory = (sourceDir, targetDir) => {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
};

if (!fs.existsSync(standaloneDir)) {
  throw new Error(
    `Missing ${distDirName}/standalone output. Run \`yarn build\` before preparing the Playwright server.`,
  );
}

copyDirectory(path.join(distDir, 'static'), standaloneStaticDir);
copyDirectory(path.join(rootDir, 'public'), standalonePublicDir);

console.log('Prepared standalone assets for Playwright E2E.');
