import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import axe from 'axe-core';
import { inspectChart } from './chart.mjs';
import { inspectLabels } from './readability.mjs';
import { isolatedBrowser, loadPreview, capturePreview } from './browser.mjs';
import { validateCode } from './contracts.mjs';
import { protocol } from './browser-config.mjs';

export const counterfactual=payload=>{
  const x=structuredClone(payload);x.period={lower:'2026-02-01',upper:'2026-02-23',timezone:'UTC'};
  x.datasets[0].rows[0].revenue=931;
  x.datasets[1].rows=[{week:'2026-02-02',revenue:71},{week:'2026-02-09',revenue:260},{week:'2026-02-16',revenue:600}];
  return x;
};
export async function inspectData(frame,payload) {
  const checks = await frame.evaluate(data=>{
    const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)!==0;};
    const numeric=s=>Number(s.replace(/[$,\s]|USD/g,''));
    const values=data.datasets.flatMap(d=>d.rows.map((row,i)=>{
      const found=[...document.querySelectorAll(`[data-value="${d.id}:${i}"]`)];
      return {id:`${d.id}:${i}`,expected:row.revenue,actual:found[0]?.textContent,
        pass:found.length===1&&visible(found[0])&&numeric(found[0].textContent)===row.revenue};
    }));
    const dates=data.datasets[1].rows.map((row,i)=>{const el=document.querySelector(`[data-week="${i}"]`);return {expected:row.week,actual:el?.textContent,pass:visible(el)&&el.textContent.trim()===row.week};});
    const period=document.querySelector('[data-period]'),p=period?.textContent??'';
    const chart=document.querySelector('[data-chart="revenue_weekly"]');
    const texts=[...document.querySelectorAll('body *')].filter(el=>visible(el)&&[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
    const font=el=>{let size=parseFloat(getComputedStyle(el).fontSize);if(el instanceof SVGTextElement){const m=el.getScreenCTM();size*=Math.hypot(m.a,m.b);}return size;};
    const fonts=texts.map(el=>({text:el.textContent.trim().slice(0,80),px:font(el)}));
    return {values,dates,values_pass:values.every(x=>x.pass),dates_pass:dates.every(x=>x.pass),
      period_pass:visible(period)&&[data.period.lower,data.period.upper,'UTC','inclusive','exclusive'].every(x=>p.includes(x)),
      chart_present:visible(chart)&&!!chart.querySelector('svg,canvas'),synthetic_label:/synthetic/i.test(document.body.innerText),
      no_overflow:document.documentElement.scrollWidth<=innerWidth+1,
      min_font_px:Math.min(...fonts.map(x=>x.px)),small_text:fonts.filter(x=>x.px<11.99),
      text:document.body.innerText.slice(0,20000)};
  },payload);
  const chart = await inspectChart(frame,payload);
  return {...checks,chart_legacy_present:checks.chart_present,chart_present:chart.present,chart};
}
export async function inspectArtifact(spec,bundle,out) {
  validateCode(spec,bundle);
  const isolated=await isolatedBrowser(),views=[];
  try {
    for(const viewport of protocol.browser_viewports){
      const view=await loadPreview(isolated.browser,spec,bundle.payload,viewport);
      try {
        const before=await inspectData(view.frame,bundle.payload);
        const labels=await inspectLabels(view.frame,bundle.payload);
        const shot=viewport.width>600?'desktop.png':'mobile.png';
        await capturePreview(view,join(out,shot));
        const details=view.frame.locator('[data-details]'),button=view.frame.locator('[data-action="toggle-details"]');
        let interaction=false;
        try {const hidden=!(await details.isVisible());await button.click({timeout:1500});interaction=hidden&&await details.isVisible();} catch {}
        // Audit CSS contrast in the actual isolated document; no model-provided test result is trusted.
        await view.frame.evaluate(axe.source);
        const contrast=await view.frame.evaluate(async()=>{
          const r=await axe.run(document,{runOnly:{type:'rule',values:['color-contrast']}});
          return {violations:r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),
            incomplete:r.incomplete.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))};
        });
        const height=await view.frame.evaluate(()=>Math.max(document.body.scrollHeight,document.documentElement.scrollHeight));
        await view.page.locator('iframe').evaluate((el,h)=>{el.style.height=`${Math.min(6000,h+4)}px`;},Math.max(viewport.height,height));
        await view.page.waitForTimeout(150);
        await capturePreview(view,join(out,shot.replace('.png','-details.png')));
        views.push({viewport,checks:before,labels,interaction,contrast,network:view.network,errors:view.errors,console_errors:view.consoleErrors,screenshot:shot});
      } finally {await view.context.close();}
    }
    const alt=counterfactual(bundle.payload),probe=await loadPreview(isolated.browser,spec,alt,protocol.browser_viewports[0]);
    let binding, bindingRuntime;
    try {binding=await inspectData(probe.frame,alt);
      bindingRuntime={network:probe.network,errors:probe.errors,console_errors:probe.consoleErrors};
    }finally{await probe.context.close();}
    const networkPass=views.every(v=>!v.network.length&&!v.console_errors.some(s=>/Content Security Policy|refused|blocked/i.test(s)));
    const correctness=views.every(v=>v.checks.values_pass&&v.checks.dates_pass&&v.checks.period_pass&&v.checks.chart_legacy_present&&v.checks.synthetic_label&&v.interaction&&!v.errors.length)
      &&binding.values_pass&&binding.dates_pass&&binding.period_pass;
    const readability=views.every(v=>v.checks.no_overflow&&!v.checks.small_text.length&&!v.contrast.violations.length&&!v.contrast.incomplete.length);
    // Preserve the original strict score for historical comparison. The host's
    // versioned delivery policy also checks changed-data runtime observations.
    return {evidence_version:'revenue-browser-evidence/2',views,counterfactual:binding,counterfactual_runtime:bindingRuntime,
      network_pass:networkPass,correctness_pass:correctness,readability_pass:readability,passed:networkPass&&correctness&&readability};
  } finally {await isolated.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [input,out]=process.argv.slice(2);
  try {const {spec,bundle}=JSON.parse(await readFile(input,'utf8'));const result=await inspectArtifact(spec,bundle,out);
    await writeFile(join(out,'qa.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
  } catch {await writeFile(join(out,'qa.json'),JSON.stringify({passed:false,error:'browser_validation_failed'}),{flag:'wx',mode:0o600});process.exitCode=1;}
}
