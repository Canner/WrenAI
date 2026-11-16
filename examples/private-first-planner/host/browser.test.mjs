import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from './store.mjs';
import { Host } from './controller.mjs';
import { scriptedPorts } from './scripted.mjs';
import { artifactPorts } from './artifacts.mjs';
import { cases } from '../p4/protocol.mjs';
import { uiCommand, viewState } from './tui.mjs';
import { previewCandidate } from './preview.mjs';
import { bundle, code } from '../p5/test/fixtures.mjs';

test('real QA rejects wrong values, bounded repair passes, and approved artifact opens in isolated viewer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'host-browser-'));
  const ports = scriptedPorts({ invalidFirst: true });
  const host = new Host(new Store(join(directory, 'state')), { ...ports, ...artifactPorts(join(directory, 'artifacts')) });
  let preview;
  try {
    host.command(uiCommand(host.snapshot(), cases[2].question)); await host.idle();
    assert.equal(host.snapshot().task.pending?.source, 'export');
    host.command(uiCommand(host.snapshot(), '/approve')); await host.idle();
    const task = host.snapshot().task; assert.equal(task.reason, 'cloud_design'); assert.equal(task.attempts.length, 2);
    assert.equal(task.attempts[0].qa.pass, false); assert.equal(task.attempts[1].qa.pass, true);
    await assert.rejects(previewCandidate(task.attempts[0].artifact, { headless: true }));
    preview = await previewCandidate(task.artifact, { headless: true });
    assert.equal(await preview.view.frame.locator('[data-value="revenue_total:0"]').textContent(), '$770');
    assert.equal(await preview.view.page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    assert.equal(preview.view.network.length, 0);
    const artifact = JSON.parse(await readFile(task.artifact)); assert.ok(artifact.design_ms >= 0 && artifact.qa_ms > 0);
  } finally { await preview?.close(); await host.close(); await rm(directory, { recursive: true, force: true }); }
});

test('free layout with small text is delivered with visible warnings and no automatic repair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'host-warning-'));
  const ports = scriptedPorts(), original = ports.makeDesigner;
  ports.makeDesigner = options => {
    const designer = original(options), design = designer.design;
    designer.design = async (...args) => {
      const result = await design(...args);
      result.spec.css += 'body{font-size:8px}main{display:flex;flex-direction:column}h1{order:1}';
      return result;
    }; return designer;
  };
  const host = new Host(new Store(join(directory, 'state')), { ...ports, ...artifactPorts(join(directory, 'artifacts')) });
  let preview;
  try {
    host.command(uiCommand(host.snapshot(), cases[2].question)); await host.idle();
    host.command(uiCommand(host.snapshot(), '/approve')); await host.idle();
    const task = host.snapshot().task;
    assert.equal(task.reason, 'cloud_design'); assert.equal(task.attempts.length, 1); assert.equal(ports.counters.cloud, 1);
    assert.equal(task.attempts[0].qa.decision, 'accept_with_warnings'); assert.equal(task.attempts[0].qa.strict_quality_pass, false);
    assert.equal(task.attempts[0].qa.quality_pass, false); assert.match(viewState(host.snapshot()), /文字偏小/);
    preview = await previewCandidate(task.artifact, { headless: true });
    assert.equal(preview.assessment.decision, 'accept_with_warnings');
    assert.equal(await preview.view.frame.locator('[data-value="revenue_total:0"]').textContent(), '$770');
  } finally { await preview?.close(); await host.close(); await rm(directory, { recursive: true, force: true }); }
});

test('actual runtime, network and changed-data failures still block under the delivery contract', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'host-negative-'));
  const ports = artifactPorts(directory);
  try {
    for (const [program, blocker] of [
      ['throw new Error("broken");', 'runtime_error'],
      ['fetch("https://example.invalid").catch(()=>{});', 'security_policy_violation'],
      ['if(window.dashboardData.datasets[0].rows[0].revenue!==770)throw new Error("changed data error");', 'runtime_error'],
      ['if(window.dashboardData.datasets[0].rows[0].revenue!==770)fetch("https://example.invalid").catch(()=>{});', 'security_policy_violation'],
      ['document.querySelector("[data-value]").textContent="770";', 'values_pass'],
    ]) {
      const spec = code(); spec.javascript += program;
      const result = await ports.inspect({ spec, bundle });
      assert.equal(result.pass, false, program); assert.ok(result.blockers.some(x => x.code === blocker), JSON.stringify(result));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('missing chart sends chart_rendering and repairs once; recovered CSS chart delivers without repair', async () => {
  for(const mode of ['missing','fallback']) {
    const directory=await mkdtemp(join(tmpdir(),'host-chart-')),sent=[];
    const ports=scriptedPorts({observe:x=>sent.push(x)}),original=ports.makeDesigner;
    ports.makeDesigner=options=>{
      const designer=original(options),design=designer.design;
      designer.design=async(...args)=>{
        const result=await design(...args);
        if(options.attempt===0){
          result.spec.javascript+=`const chart=document.querySelector('[data-chart]');chart.querySelector('svg').remove();`;
          if(mode==='fallback')result.spec.javascript+=`chart.removeAttribute('data-chart');chart.setAttribute('role','img');chart.setAttribute('aria-label','Weekly revenue chart');window.dashboardData.datasets[1].rows.forEach(r=>{const bar=document.createElement('div');bar.style.cssText='background:#175b8a;height:16px;width:'+r.revenue/5+'px';chart.append(bar)});`;
        }
        return result;
      };return designer;
    };
    const host=new Host(new Store(join(directory,'state')),{...ports,...artifactPorts(join(directory,'artifacts'))});
    try {
      host.command(uiCommand(host.snapshot(),cases[2].question));await host.idle();
      host.command(uiCommand(host.snapshot(),'/approve'));await host.idle();
      const task=host.snapshot().task;assert.equal(task.reason,'cloud_design');
      assert.equal(task.attempts.length,mode==='missing'?2:1);
      if(mode==='missing')assert.deepEqual(sent[1].diagnostics,['chart_rendering']);
      else {assert.equal(task.attempts[0].qa.decision,'accept_with_warnings');assert.match(viewState(host.snapshot()),/圖表可見/);}
    }finally{await host.close();await rm(directory,{recursive:true,force:true});}
  }
});
