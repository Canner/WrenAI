import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// The grant is operator configuration, never supplied by a model or conversation.
export async function verifyFiles(entries) {
  if(!Array.isArray(entries)||!entries.length) return false;
  for(const entry of entries) {
    try { if(createHash('sha256').update(await readFile(entry.path)).digest('hex')!==entry.sha256) return false; }
    catch {return false;}
  }
  return true;
}

export async function sourceHashes(root) {
  const result={};
  async function visit(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
    if(['node_modules','__pycache__'].includes(entry.name))continue;
    const path=join(dir,entry.name);if(entry.isDirectory())await visit(path);
    else if(entry.isFile())result[path.slice(root.length+1)]=createHash('sha256').update(await readFile(path)).digest('hex');
  }}
  await visit(root);return result;
}
