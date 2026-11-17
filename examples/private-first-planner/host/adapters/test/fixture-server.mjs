// Test-only subprocess: no model, database, network listener or provider credential.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const mode = process.argv[2];
const names = ['capabilities', 'open_session', 'close_session', 'read_metadata', 'ask_data', 'continue_task', 'get_evidence'];
if (mode === 'raw-sql') names.push('run_sql');
const server = new Server({ name: 'scripted-wren-client-test', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: names.map(name => ({ name, inputSchema: { type: 'object' } })) }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  if (mode === 'tool-error') return { isError: true, content: [{ type: 'text', text: 'private diagnostic' }] };
  if (mode === 'ambiguous-text') return { content: [{ type: 'text', text: '{}' }, { type: 'text', text: '{}' }] };
  return { content: [{ type: 'text', text: JSON.stringify({ method: request.params.name, received: request.params.arguments }) }] };
});
await server.connect(new StdioServerTransport());
