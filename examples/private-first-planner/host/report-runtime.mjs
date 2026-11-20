import { connectWren } from './adapters/wren-client.mjs';
import { PiPlanner, privateModel } from './pi.mjs';
import { ReportSession } from './report.mjs';
import { PartitionedReportExecutor } from './report-partitions.mjs';
import { WrenReportExecutor } from './report-wren.mjs';
import { decisionContract } from '../analysis/contracts.mjs';
import { requireThat } from '../contracts.mjs';

// Explicit live binding; never auto-runs from the offline evaluator. Registry and
// verification are deployment-owned functions, not model-authored JSON grants.
export async function createReportRuntime(config, policy, { connect = connectWren, streamFn, observePlanner = {}, observeWorker = {}, partitionPolicy } = {}) {
  requireThat(['loadRegistry', 'authorize', 'verify'].every(k => typeof policy[k] === 'function'));
  const key = process.env[config.planner.credentialEnv]; requireThat(typeof key === 'string' && key.length > 0);
  const models = [false, true].map(worker => new PiPlanner({ model: privateModel(config.planner), apiKey: key,
    decisionContract: decisionContract(worker), maxTokens: 4096, timeoutMs: 120000, ...(streamFn ? { streamFn } : {}),
    ...(worker ? observeWorker : observePlanner) }));
  const port = await connect(config.wren), single = new WrenReportExecutor(port);
  const executor = partitionPolicy ? new PartitionedReportExecutor(single, partitionPolicy) : single;
  const session = new ReportSession({ ...policy, planner: models[0], worker: models[1], execute: x => executor.execute(x), continueExecution: x => executor.continueExecution(x) });
  return { session, planner: models[0], worker: models[1], async close() { session.close(); try { await executor.close(); } finally { await port.close(); } } };
}
