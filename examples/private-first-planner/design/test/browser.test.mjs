import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {networkPolicy,browserPolicy,isolatedBrowser,loadPreview} from '../browser.mjs';
import {chromium} from 'playwright';
import {inspectArtifact} from '../qa.mjs';
import {runQA} from '../qa-process.mjs';
import {bundle,code} from './fixtures.mjs';
// Test-only PNG decoder bundled with the exact pinned Playwright version.
const require=createRequire(import.meta.url);
const {PNG}=require(join(dirname(require.resolve('playwright-core/package.json')),'lib/utilsBundle.js'));

test('OS denies home file contents even outside browser origin checks',()=>{
  assert.throws(()=>execFileSync('/usr/bin/sandbox-exec',['-p',browserPolicy(chromium.executablePath(),process.env.HOME),'/bin/cat',new URL('./fixtures.mjs',import.meta.url).pathname],{stdio:'pipe',timeout:3000}),e=>/Operation not permitted|Permission denied/.test(String(e.stderr)));
});

test('OS denies IPv4, IPv6 and UDP networking before browser routes or CSP',()=>{
  for(const script of [
    `require('net').connect(9,'127.0.0.1').on('error',e=>{console.log(e.code)}).on('connect',()=>process.exit(9))`,
    `require('net').connect(9,'::1').on('error',e=>{console.log(e.code)}).on('connect',()=>process.exit(9))`,
    `const s=require('dgram').createSocket('udp4');s.on('error',e=>{console.log(e.code);s.close()});s.send('x',9,'127.0.0.1',e=>{if(e){console.log(e.code);s.close()}});`,
  ])assert.match(execFileSync('/usr/bin/sandbox-exec',['-p',networkPolicy,process.execPath,'-e',script],{encoding:'utf8',timeout:3000}),/EPERM|EACCES/);
});
test('actual isolated frontend renders, responds and rebinds counterfactual values',async()=>{
  const out=await mkdtemp(join(tmpdir(),'free-qa-'));
  try{const result=await inspectArtifact(code(),bundle,out);assert.equal(result.passed,true,JSON.stringify(result));
    for(const name of ['desktop','mobile','desktop-details','mobile-details']){
      const png=PNG.sync.read(await readFile(join(out,name+'.png')));let ink=0;
      for(let i=0;i<png.data.length;i+=4)if(png.data[i]<200||png.data[i+1]<200||png.data[i+2]<200)ink++;
      assert.ok(ink>1000,`${name}: screenshot lost the known fixture's painted content`);
    }
  }
  finally{await rm(out,{recursive:true,force:true});}
});
test('generated program starts after the opaque iframe has real layout dimensions',async()=>{
  const isolated=await isolatedBrowser();
  try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    const spec=code();spec.html='<div id="layout-probe" style="width:100%;height:80px"></div>'+spec.html;
    spec.javascript="window.initialSize=[innerWidth,innerHeight,document.querySelector('#layout-probe').clientWidth,document.querySelector('#layout-probe').clientHeight];"+spec.javascript;
    const view=await loadPreview(isolated.browser,spec,bundle.payload,viewport);
    try{assert.deepEqual(await view.frame.evaluate(()=>window.initialSize),[viewport.width,viewport.height,viewport.width,80]);}
    finally{await view.context.close();}
  }}finally{await isolated.close();}
});
test('hardcoded numbers and broken controls fail actual rendered acceptance',async()=>{
  const out=await mkdtemp(join(tmpdir(),'free-hardcode-'));
  try{const spec=code();spec.javascript+=`\ndocument.querySelector('[data-value="revenue_total:0"]').textContent='770';`;
    const result=await inspectArtifact(spec,bundle,out);assert.equal(result.correctness_pass,false);assert.equal(result.counterfactual.values_pass,false);}
  finally{await rm(out,{recursive:true,force:true});}
});
test('generated code cannot fetch, open sockets/popups, read parent/storage or use eval',async()=>{
  let reached=0;const server=createServer((_,res)=>{reached++;res.end('secret');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const isolated=await isolatedBrowser();
  try{const spec=code(),url=`http://127.0.0.1:${server.address().port}/canary`;
    spec.javascript+=`\nwindow.probe={};try{parent.document.body.textContent='escaped';probe.parent=true}catch{probe.parent=false};try{localStorage.setItem('x','y');probe.storage=true}catch{probe.storage=false};try{eval('1');probe.eval=true}catch{probe.eval=false};probe.popup=!!window.open(${JSON.stringify(url)});fetch(${JSON.stringify(url)}).catch(()=>{});try{new WebSocket(${JSON.stringify(url.replace('http:','ws:'))})}catch{};new Image().src=${JSON.stringify(url)};`;
    const view=await loadPreview(isolated.browser,spec,bundle.payload,{width:1280,height:900});
    try {assert.deepEqual(await view.frame.evaluate(()=>window.probe),{parent:false,storage:false,eval:false,popup:false});assert.equal(reached,0);assert.ok(view.consoleErrors.length>0);}
    finally{await view.context.close();}
  }finally{await isolated.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('parent watchdog terminates non-returning generated JavaScript',async()=>{
  const out=await mkdtemp(join(tmpdir(),'free-loop-'));
  try{const spec=code();spec.javascript='while(true){}';const input=join(out,'artifact.json');await writeFile(input,JSON.stringify({spec,bundle}));
    const result=await runQA(input,out,{timeoutMs:5000});assert.equal(result.passed,false);assert.equal(result.error,'browser_deadline');}
  finally{await rm(out,{recursive:true,force:true});}
});

// Readability observations never change the delivery gate.
test('semantic label measurement catches SVG scaling and accepts independent HTML text', async () => {
  const { inspectLabels } = await import('../readability.mjs');
  const isolated = await isolatedBrowser();
  try {
    const specimen = code();
    const normal = await loadPreview(isolated.browser, specimen, bundle.payload, { width: 390, height: 844 });
    try {
      const result = await inspectLabels(normal.frame, bundle.payload);
      assert.equal(result.target_met, true); assert.equal(result.label_count, 7);
    } finally { await normal.context.close(); }
    specimen.javascript += `
      const labels=[...document.querySelectorAll('[data-value],[data-week]')];
      const chart=document.querySelector('[data-chart]');
      chart.innerHTML='<svg viewBox="0 0 900 300" style="width:100%"></svg>';
      const svg=chart.querySelector('svg');
      labels.forEach((el,i)=>{const text=document.createElementNS('http://www.w3.org/2000/svg','text');
        for(const attr of ['data-value','data-week'])if(el.hasAttribute(attr)){text.setAttribute(attr,el.getAttribute(attr));el.removeAttribute(attr);}
        text.textContent=el.textContent;text.setAttribute('x','10');text.setAttribute('y',String(30+i*35));
        text.style.fontSize='18px';svg.append(text);});`;
    const scaled = await loadPreview(isolated.browser, specimen, bundle.payload, { width: 390, height: 844 });
    try {
      const result = await inspectLabels(scaled.frame, bundle.payload);
      assert.equal(result.all_visible, true); assert.equal(result.target_met, false);
      assert.ok(result.min_label_px < 8);
    } finally { await scaled.context.close(); }
  } finally { await isolated.close(); }
});

test('chart presence supports CSS, SVG and canvas; empty, hidden and unrelated graphics do not count', async () => {
  const { inspectData } = await import('../qa.mjs');
  const isolated = await isolatedBrowser();
  const css = `const root=document.querySelector('[data-chart]'); root.querySelector('svg').remove();
    window.dashboardData.datasets[1].rows.forEach(r=>{const bar=document.createElement('div');bar.style.cssText='background:#175b8a;height:16px;margin:8px 0;width:'+r.revenue/5+'px';root.append(bar)});`;
  const cases = [
    ['svg root itself', `const root=document.querySelector('[data-chart]');root.removeAttribute('data-chart');root.querySelector('svg').setAttribute('data-chart','revenue_weekly');`, true, 'matched', 'svg'],
    ['CSS bars', css, true, 'matched', 'css'],
    ['recovered CSS', css+`root.removeAttribute('data-chart');root.setAttribute('role','img');root.setAttribute('aria-label','Weekly revenue chart');const empty=document.createElement('div');empty.setAttribute('data-chart','revenue_weekly');empty.hidden=true;document.body.append(empty);`, true, 'fallback', 'css'],
    ['canvas', `const root=document.querySelector('[data-chart]');root.querySelector('svg').remove();const c=document.createElement('canvas');c.width=300;c.height=150;root.append(c);const ctx=c.getContext('2d');ctx.fillStyle='#175b8a';window.dashboardData.datasets[1].rows.forEach((r,i)=>ctx.fillRect(i*90,150-r.revenue/4,50,r.revenue/4));`, true, 'matched', 'canvas'],
    ['empty SVG', `document.querySelector('svg').innerHTML='';`, false],
    ['text-only SVG', `document.querySelector('svg').innerHTML='<text x="10" y="20">Not a chart</text>';`, false],
    ['hidden SVG', `document.querySelector('svg').style.display='none';`, false],
    ['transparent parent', `document.querySelector('[data-chart]').style.opacity='0';`, false],
    ['blank canvas', `document.querySelector('svg').outerHTML='<canvas width="300" height="150"></canvas>';`, false],
    ['solid canvas background', `document.querySelector('svg').outerHTML='<canvas width="300" height="150"></canvas>';document.querySelector('canvas').getContext('2d').fillRect(0,0,300,150);`, false],
    ['hidden CSS', css+`root.style.visibility='hidden';`, false],
    ['labels only', `document.querySelector('svg').remove();`, false],
    ['unrelated decoration', `document.querySelector('[data-chart]').removeAttribute('data-chart');`, false],
  ];
  try {for(const viewport of [{width:1280,height:900},{width:390,height:844}]) for (const [name,program,present,marker,renderer] of cases) {
    const spec=code();spec.javascript+=program;
    const view=await loadPreview(isolated.browser,spec,bundle.payload,viewport);
    try {const checks=await inspectData(view.frame,bundle.payload);
      assert.equal(checks.chart_present,present,name+JSON.stringify(checks.chart));
      if(present){assert.equal(checks.chart.marker,marker,name);assert.equal(checks.chart.renderer,renderer,name);}
      assert.equal(view.errors.length,0,name);
    } finally {await view.context.close();}
  }} finally {await isolated.close();}
});
