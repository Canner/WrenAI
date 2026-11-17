import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const axe = createRequire(new URL('../design/package.json', import.meta.url))('axe-core');
import { pathToFileURL } from 'node:url';
import { isolatedBrowser, loadPreview, capturePreview } from '../design/browser.mjs';
import { inspectChart } from '../design/chart.mjs';
import { validateCode } from '../design/contracts.mjs';
import { validatePayload, syntheticPayload, deliveryContract } from './data.mjs';
import { expected, journeys } from './oracle.mjs';

export async function observe(frame) {
  return frame.evaluate(() => {
    const visible = el => {
      if(!el) return false;
      const r=el.getBoundingClientRect(); if(r.width<=0 || r.height<=0 || r.right<=0 || r.left>=innerWidth) return false;
      for(let x=el;x;x=x.parentElement){const s=getComputedStyle(x);if(s.display==='none'||s.visibility!=='visible'||+s.opacity===0)return false;}
      return true;
    };
    const one = selector => { const els=[...document.querySelectorAll(selector)];
      return els.length===1 && visible(els[0]) ? els[0].textContent.trim() : null; };
    const controls = Object.fromEntries(['region','category','dimension','lower','upper'].map(k=>{
      const els=[...document.querySelectorAll(`[data-control="${k}"]`)]; const el=els[0];
      return [k,els.length===1 && visible(el) && el.labels?.length>0 && [...el.labels].some(visible)
        && (['lower','upper'].includes(k) ? el.tagName==='INPUT' && el.type==='date' : el.tagName==='SELECT') ? el.value : null];
    }));
    const read = el => {
      const o={label:el.getAttribute('data-row'),visible:visible(el)};
      for(const k of ['label','revenue','orders','aov']) {const cells=el.querySelectorAll(`[data-field="${k}"]`);o[k]=cells.length===1&&visible(cells[0])?cells[0].textContent.trim():null;}
      return o;
    };
    const chartLabels=[...document.querySelectorAll('[data-chart-label]')].map(el=>({key:el.getAttribute('data-chart-label'),text:visible(el)?el.textContent.trim():null}));
    const chartValues=[...document.querySelectorAll('[data-chart-value]')].map(el=>({key:el.getAttribute('data-chart-value'),text:visible(el)?el.textContent.trim():null}));
    const drill=[...document.querySelectorAll('[data-drill]')].map(el=>({key:el.getAttribute('data-drill'),enabled:visible(el)&&el.tagName==='BUTTON'&&!el.disabled&&el.textContent.includes(el.getAttribute('data-drill'))}));
    const labels=[...document.querySelectorAll('[data-kpi],[data-field],[data-chart-label],[data-chart-value]')].filter(visible);
    const minFont=labels.length?Math.min(...labels.map(el=>{const size=parseFloat(getComputedStyle(el).fontSize);const m=el instanceof SVGGraphicsElement?el.getScreenCTM():null;return m?size*Math.hypot(m.c,m.d):size;})):null;
    const up=document.querySelector('[data-action="roll-up"]');
    return { kpis:Object.fromEntries(['revenue','orders','aov'].map(k=>[k,one(`[data-kpi="${k}"]`)])),
      controls,rows:[...document.querySelectorAll('[data-row]')].map(read),chartLabels,chartValues,drill,
      breadcrumb:one('[data-breadcrumb]'),period:one('[data-period]'),empty:one('[data-empty]'),error:one('[data-error]'),
      upDisabled:up&&visible(up)?up.disabled:null, synthetic:/synthetic/i.test(document.body.innerText),
      warnings:[...(document.documentElement.scrollWidth>innerWidth+1?['horizontal_overflow']:[]),...(minFont!==null&&minFont<14?['small_text']:[])] };
  });
}
const numeric = (text, want) => {
  if(want===null) return text==='N/A';
  if(typeof text!=='string'||!/^\$?-?\d[\d,]*(\.\d{1,2})?$/.test(text)) return false;
  return Math.abs(Number(text.replace(/[$,]/g,''))-want)<0.011;
};
export function compare(o,want,s,step) {
  const failures=[];
  if(!['revenue','orders','aov'].every(k=>numeric(o.kpis[k],want[k])))failures.push('kpi');
  if(o.rows.length!==want.groups.length||!want.groups.every((g,i)=>o.rows[i]?.visible&&o.rows[i]?.label===g.label
    && ['revenue','orders','aov'].every(k=>numeric(o.rows[i][k],g[k]))))failures.push('table');
  if(o.chartLabels.length!==want.groups.length||o.chartValues.length!==want.groups.length||!want.groups.every(g=>
    o.chartLabels.filter(x=>x.key===g.label&&x.text===g.label).length===1&&o.chartValues.filter(x=>x.key===g.label&&numeric(x.text,g.revenue)).length===1))failures.push('chart_values');
  if(!Object.keys(o.controls).every(k=>o.controls[k]===s[k]))failures.push('controls');
  if(!o.breadcrumb?.includes(s.dimension==='geography'?'Geography':'Product')||(s.parent!==null&&!o.breadcrumb.includes(s.parent)))failures.push('breadcrumb');
  if(![s.lower,s.upper,'UTC','inclusive','exclusive'].every(t=>o.period?.includes(t)))failures.push('period');
  if(!o.synthetic || Boolean(o.empty)!==(want.groups.length===0))failures.push('content');
  if(o.upDisabled!==(s.parent===null))failures.push('roll-up');
  if(s.parent===null ? (o.drill.length!==want.groups.length || !want.groups.every(g=>o.drill.some(d=>d.key===g.label&&d.enabled))) : o.drill.length!==0)failures.push('drill');
  if(Boolean(o.error)!==(step==='invalid-lower'))failures.push('error-state');
  return failures;
}
async function operate(frame, step) {
  const {action,value}=step;
  if(action==='initial')return;
  if(action==='reset') { const button=frame.locator('[data-action="reset"]');await button.focus();await button.press('Enter'); }
  else if(action==='roll-up')await frame.locator('[data-action="roll-up"]').click();
  else if(action==='drill')await frame.locator(`[data-drill=${JSON.stringify(value)}]`).click();
  else if(['lower','upper','invalid-lower'].includes(action)) {
    const control=frame.locator(`[data-control="${action==='invalid-lower'?'lower':action}"]`);
    await control.fill(value); await control.press('Tab');
  } else await frame.locator(`[data-control="${action}"]`).selectOption(value);
  await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
export async function inspectInteractive(spec,bundle,out,{counterfactual=true}={}) {
  validatePayload(bundle.payload);validateCode(spec,bundle);await mkdir(out,{recursive:true});
  const browser=await isolatedBrowser(); const records=[],warnings=new Set();
  const inputs=[['original',bundle.payload],...(counterfactual?[['changed',syntheticPayload(bundle.payload.period.lower==='2026-03-01'?'base':'changed')]]:[])];
  try {
    for(const [input,payload] of inputs)for(const width of [1280,390]) {
      const view=await loadPreview(browser.browser,spec,payload,{width,height:900});
      try {
        for(const [index,step] of journeys(payload).entries()) {
          const start=performance.now();let observed=null,failures=[];
          try {
            await operate(view.frame,step); observed=await observe(view.frame);
            const want=expected(payload,step.state);failures=compare(observed,want,step.state,step.action);
            if(want.groups.some(g=>g.revenue!==0)) {
              const chart=await inspectChart(view.frame,{datasets:[{}, {rows:want.groups}]},
                {marker:'breakdown',contract:'interactive-chart-presence/1',recover:false});
              if(!chart.present)failures.push('chart_rendering');
            }
            observed.warnings.forEach(x=>warnings.add(x));
          }catch{failures.push('interaction');}
          if(view.network.length||view.errors.length||view.consoleErrors.length)failures.push('runtime_or_network');
          records.push({input,width,index,action:step.action,state:step.state,observed,failures,elapsed_ms:Math.round(performance.now()-start)});
          if(index===0) {
            await view.frame.evaluate(axe.source);
            const contrast=await view.frame.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'rule',values:['color-contrast']}});return {violations:r.violations.length,incomplete:r.incomplete.length};});
            if(contrast.violations)warnings.add('contrast_violation');
            if(contrast.incomplete)warnings.add('contrast_unverified');
            records.at(-1).contrast=contrast;
          }
          if(index===0||step.action==='drill'||step.action==='invalid-lower')
            await capturePreview(view,join(out,`${input}-${width}-${index}.png`));
          // A failed transition invalidates later observations. Never silently
          // count unexecuted steps as passes; retain the failure and stop this view.
          if(failures.length)break;
        }
      }finally{await view.context.close();}
    }
  }finally{await browser.close();}
  const failures=records.flatMap(r=>r.failures),pass=failures.length===0&&records.length===inputs.reduce((n,[,p])=>n+journeys(p).length*2,0);
  const fatal=failures.includes('runtime_or_network');
  return {version:deliveryContract,pass,quality_pass:pass&&warnings.size===0,warnings:[...warnings],records,
    repair_codes:pass||fatal?[]:[...new Set(failures.map(f=>f==='chart_rendering'?'chart_rendering':
      ['interaction','controls','breadcrumb','roll-up','drill','error-state'].includes(f)?'interaction':'data_binding'))]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [input,out]=process.argv.slice(2);
  try {const {spec,bundle}=JSON.parse(await readFile(input,'utf8'));
    const qa=await inspectInteractive(spec,bundle,out);await writeFile(join(out,'qa.json'),JSON.stringify(qa,null,2));
  }catch{process.exitCode=1;}
}
