// Run the actual example client against local in-memory SDK peers; no provider or child.
import { readFile, writeFile, open, mkdtemp, chmod, stat, rm, symlink, link, lstat, readdir, mkdir, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { inspect } from 'node:util';

const [clientPath, settings] = process.argv.slice(2);
const config = { command: 'fixture', args: [], skill: 'skill.md', ...JSON.parse(settings) };
const timeouts = [];
const modesAtWrite = [];
const temporary = await mkdtemp(join(tmpdir(), 'wren-planner-probe-'));
const outputPath = config._probeOutputPath ?? join(temporary, 'trace.json');
const targetPath = join(temporary, 'original.txt');
const previousUmask = process.umask(0);
if (config._probeSymlink || config._probeHardlink) {
  await writeFile(targetPath, 'original contents');
  await chmod(targetPath, 0o644);
  if (config._probeSymlink) await symlink(targetPath, outputPath);
  else await link(targetPath, outputPath);
}
if (config._probeDirectory) await mkdir(outputPath);
if (config._probeExisting) {
  await writeFile(outputPath, 'previous trace');
  await chmod(outputPath, 0o644);
}
let clients = 0;
class Client {
  constructor() { clients++; }
  async connect() {}
  async listTools() { return { tools: [{ name: 'ask_data', inputSchema: {} }] }; }
  async callTool(_request, _schema, options) {
    timeouts.push(options.timeout);
    return { content: [{ type: 'text', text: 'fixture result' }] };
  }
  async close() {}
}
class Agent {
  constructor(options) { this.options = options; this.state = { messages: [] }; }
  async prompt() {
    await this.options.initialState.tools[0].execute('one', {});
    if (config._probeFailure) throw Error(config._probeFailureMessage ?? 'scripted planner failure');
    this.state.messages.push({ role: 'assistant', stopReason: 'stop', content: [] });
  }
}
const context = vm.createContext({
  process: {
    argv: ['node', clientPath, 'client.json', 'questions.json', outputPath],
    env: config._probeEnv ?? {},
    cwd: () => '/probe/cwd',
  },
});
let transportEnv = null;
const modules = {
  'node:fs': { constants },
  'node:crypto': { randomUUID },
  'node:fs/promises': {
    readFile: async path => path === 'client.json' ? JSON.stringify(config) : path === 'questions.json' ? '["question"]' : 'skill',
    writeFile, lstat, rename, unlink,
    open: async (...args) => {
      const file = await open(...args);
      return {
        chmod: mode => file.chmod(mode),
        stat: () => file.stat(),
        writeFile: async value => {
          modesAtWrite.push((await file.stat()).mode & 0o777);
          if (config._probeWriteFailure) {
            await file.writeFile('partial');
            throw Error('scripted trace write failure');
          }
          return file.writeFile(value);
        },
        close: () => file.close(),
      };
    },
  },
  '@earendil-works/pi-agent-core': { Agent },
  '@earendil-works/pi-ai/api/openai-completions': { streamSimple: () => { throw Error('provider must not run'); } },
  '@modelcontextprotocol/sdk/client/index.js': { Client },
  '@modelcontextprotocol/sdk/client/stdio.js': { StdioClientTransport: class { constructor(options) { transportEnv = options.env; } } },
};
const module = new vm.SourceTextModule(await readFile(clientPath, 'utf8'), { context });
let error = null, unwrittenErrorNames = null, printedLeaks = null;
try {
  await module.link(specifier => {
    const exports = modules[specifier];
    if (!exports) throw Error('unexpected dependency');
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
} catch (failure) {
  error = failure.message;
  unwrittenErrorNames = failure.unwrittenErrorNames ?? null;
  // What Node prints for an uncaught failure: the stack plus its own properties.
  if (config._probeFailureMessage) printedLeaks = inspect(failure).includes(config._probeFailureMessage);
}
const result = {
  timeouts, clients, error,
  ...(unwrittenErrorNames ? { unwrittenErrorNames } : {}),
  ...(printedLeaks === null ? {} : { printedLeaks }),
  ...(config._probeEnv ? { transportEnv } : {}),
};
try {
  if (config._probeSymlink) {
    result.targetContent = await readFile(targetPath, 'utf8');
    result.targetMode = (await stat(targetPath)).mode & 0o777;
    result.traceIsSymlink = (await lstat(outputPath)).isSymbolicLink();
  }
  if (config._probeHardlink) {
    result.targetContent = await readFile(targetPath, 'utf8');
    result.targetMode = (await stat(targetPath)).mode & 0o777;
    result.separateInodes = (await stat(targetPath)).ino !== (await stat(outputPath)).ino;
  }
  if (config._probeWriteFailure) {
    result.traceRaw = await readFile(outputPath, 'utf8');
    result.traceMode = (await stat(outputPath)).mode & 0o777;
  }
  if (config._probeDirectory) result.traceIsDirectory = (await lstat(outputPath)).isDirectory();
  if (config._probeHardlink || config._probeWriteFailure || config._probeDirectory)
    result.temporaryEntries = (await readdir(temporary)).filter(name => !['trace.json', 'original.txt'].includes(name));

  if (config._probeFileChecks) {
    result.traceMode = (await stat(outputPath)).mode & 0o777;
    result.trace = JSON.parse(await readFile(outputPath, 'utf8'));
    result.modesAtWrite = modesAtWrite;
    result.exitCode = context.process.exitCode ?? 0;
  }
  console.log(JSON.stringify(result));
} finally {
  process.umask(previousUmask);
  await rm(temporary, { recursive: true, force: true });
}
