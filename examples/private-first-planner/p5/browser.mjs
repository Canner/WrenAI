import { chromium } from 'playwright';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { requireThat } from '../contracts.mjs';

// IP networking is denied by the OS for Chromium and its descendants. Local Unix
// sockets remain available for Chromium's isolated profile/IPC; no TCP exception.
export const networkPolicy = '(version 1)(allow default)(deny network-outbound (remote ip "*:*"))(deny network-inbound (local ip "*:*"))';
export function browserPolicy(executable,home) {
  const app=executable.slice(0,executable.indexOf('.app/')+4);
  requireThat(app.endsWith('.app')&&typeof home==='string'&&home.startsWith('/'));
  return networkPolicy+`(deny file-read* file-write* (subpath ${JSON.stringify(home)}))(allow file-read-metadata (subpath ${JSON.stringify(home)}))(allow file-read* (subpath ${JSON.stringify(app)}))`;
}
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
export async function isolatedBrowser({headless=true}={}) {
  requireThat(process.platform === 'darwin'); // No silent fallback without OS isolation.
  const dir = await mkdtemp(join(tmpdir(), 'dashboard-browser-'));
  const wrapper = join(dir, 'chromium');
  await writeFile(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -p ${quote(browserPolicy(chromium.executablePath(),process.env.HOME))} ${quote(chromium.executablePath())} "$@"\n`, {mode:0o700});
  try {
    // Chromium cannot initialize a nested macOS Seatbelt profile. Its native
    // process sandbox is replaced by the mandatory inherited OS policy above.
    const browser = await chromium.launch({headless,chromiumSandbox:false,executablePath:wrapper,timeout:15000,
      env:{PATH:process.env.PATH,HOME:dir,TMPDIR:tmpdir()},
      args:['--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
    return { browser, async close(){try {await browser.close();} finally {await rm(dir,{recursive:true,force:true});}} };
  } catch(error) {await rm(dir,{recursive:true,force:true});throw error;}
}
const hash = text => createHash('sha256').update(text).digest('base64');
const attr = s => s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');

export function previewDocument(spec,payload,viewport={height:900}) {
  const data=JSON.stringify(payload).replaceAll('<','\\u003c');
  const bootstrap=`const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};Object.defineProperty(window,'dashboardData',{value:freeze(${data}),writable:false,configurable:false});`;
  // A srcdoc child can execute while its parent iframe still has zero layout.
  // Start from native animation frames, NOT CDP evaluation: invoking candidate
  // code from evaluate() can inherit its unsafe-eval CSP bypass.
  const program=`(()=>{const start=()=>{if(innerWidth<=0||document.body.getBoundingClientRect().width<=0){requestAnimationFrame(start);return;}requestAnimationFrame(()=>{try{(()=>{'use strict';\n${spec.javascript}\n})();}finally{document.documentElement.dataset.hostReady='true';}});};requestAnimationFrame(start);})();`;
  const csp=`default-src 'none'; script-src 'sha256-${hash(bootstrap)}' 'sha256-${hash(program)}'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`;
  const document=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${attr(csp)}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${spec.css}</style></head><body>${spec.html}<script>${bootstrap}</script><script>${program}</script></body></html>`;
  // Never add allow-same-origin, top-navigation, forms, popups or downloads.
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}iframe{width:100%;height:${viewport.height}px;border:0;display:block}</style></head><body><iframe title="Generated dashboard" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${attr(document)}"></iframe></body></html>`;
}

export async function loadPreview(browser,spec,payload,viewport) {
  const context=await browser.newContext({viewport,serviceWorkers:'block',acceptDownloads:false,offline:true});
  const network=[],errors=[],consoleErrors=[];
  await context.route('**/*',route=>{network.push({kind:'request',url:route.request().url()});return route.abort();});
  await context.routeWebSocket('**/*',socket=>{network.push({kind:'websocket',url:socket.url()});socket.close();});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  page.on('popup',p=>{network.push({kind:'popup',url:p.url()});p.close().catch(()=>{});});
  page.on('download',d=>{network.push({kind:'download',url:d.url()});d.cancel().catch(()=>{});});
  page.setDefaultTimeout(3000);
  await page.setContent(previewDocument(spec,payload,viewport),{waitUntil:'load',timeout:5000});
  const frame=page.frames().find(f=>f!==page.mainFrame());requireThat(frame);
  await frame.waitForLoadState('load',{timeout:3000});
  await page.locator('iframe').waitFor({state:'visible'});
  await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  requireThat(await frame.evaluate(()=>innerWidth>0&&document.body.getBoundingClientRect().width>0));
  await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  if(!errors.length) await frame.waitForFunction(()=>document.documentElement.dataset.hostReady==='true',{},{timeout:3000});
  const height=await frame.evaluate(()=>Math.max(document.body.scrollHeight,document.documentElement.scrollHeight));
  requireThat(height>0&&height<=6000);
  await page.locator('iframe').evaluate((el,h)=>{el.style.height=`${h+2}px`;},Math.max(viewport.height,height));
  // Let the out-of-process iframe submit its painted surface before capture.
  await page.waitForTimeout(150);
  return {context,page,frame,network,errors,consoleErrors};
}

export async function capturePreview(view,path) {
  // fullPage capture can temporarily resize the outer viewport before the
  // opaque iframe compositor submits its new surface, yielding a blank PNG.
  // Resize explicitly first; preserve the child iframe's dimensions and width.
  const height=await view.page.locator('iframe').evaluate(e=>Math.ceil(e.getBoundingClientRect().bottom));
  requireThat(height>0&&height<=6004);
  await view.page.setViewportSize({width:view.page.viewportSize().width,height});
  await view.page.waitForTimeout(150);
  await view.page.screenshot({path,fullPage:false,timeout:5000});
}
