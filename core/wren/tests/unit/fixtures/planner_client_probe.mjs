// Run the actual example client against local in-memory SDK peers; no provider or child.
import { readFile, writeFile, open, mkdtemp, chmod, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

const [clientPath, settings] = process.argv.slice(2);
const config = { command: 'fixture', args: [], skill: 'skill.md', ...JSON.parse(settings) };
const timeouts = [];
const modesAtWrite = [];
const temporary = await mkdtemp(join(tmpdir(), 'wren-planner-probe-'));
const outputPath = join(temporary, 'trace.json');
const previousUmask = process.umask(0);
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
    if (config._probeFailure) throw Error('scripted planner failure');
    this.state.messages.push({ role: 'assistant', stopReason: 'stop', content: [] });
  }
}
const context = vm.createContext({
  process: { argv: ['node', clientPath, 'client.json', 'questions.json', outputPath], env: {} },
});
const modules = {
  'node:fs/promises': {
    readFile: async path => path === 'client.json' ? JSON.stringify(config) : path === 'questions.json' ? '["question"]' : 'skill',
    writeFile,
    open: async (...args) => {
      const file = await open(...args);
      return {
        chmod: mode => file.chmod(mode),
        writeFile: async value => {
          modesAtWrite.push((await file.stat()).mode & 0o777);
          return file.writeFile(value);
        },
        close: () => file.close(),
      };
    },
  },
  '@earendil-works/pi-agent-core': { Agent },
  '@earendil-works/pi-ai/api/openai-completions': { streamSimple: () => { throw Error('provider must not run'); } },
  '@modelcontextprotocol/sdk/client/index.js': { Client },
  '@modelcontextprotocol/sdk/client/stdio.js': { StdioClientTransport: class {} },
};
const module = new vm.SourceTextModule(await readFile(clientPath, 'utf8'), { context });
let error = null;
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
}
const result = { timeouts, clients, error };
try {
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
