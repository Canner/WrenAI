import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {inspectInsights} from './insights.mjs';
import {resetHorizontalScroll,probeDrillReachability} from './reachability.mjs';
import {isolatedBrowser,loadPreview,capturePreview} from '../design/browser.mjs';
import {inspectChart} from '../design/chart.mjs';
import {validateCode} from '../design/contracts.mjs';
const axe=createRequire(new URL('../design/package.json',import.meta.url))('axe-core');
let admittedPlan=null;
const defaults=p=>({lower:admittedPlan?.period.lower??p.default_period.lower,upper:admittedPlan?.period.upper_exclusive??p.default_period.upper_exclusive,country:'',channel:'',dimension:admittedPlan?.primary_dimension??'country',parent:null});
const prior=m=>String(Number(m.slice(0,4))-1)+m.slice(4);
const selected=(p,s)=>p.rows.filter(r=>r[0]>=s.lower&&r[0]<s.upper&&(!s.country||s.country===r[1])&&(!s.channel||s.channel===r[2])&&(s.parent===null||s.parent===r[s.dimension==='country'?1:2]));
function totals(rows,p){const g=rows.reduce((n,r)=>n+BigInt(r[3]),0n),f=rows.reduce((n,r)=>n+BigInt(r[4]),0n);return {gross:Number(g)/p.amount_scale,refunds:Number(f)/p.amount_scale,net:Number(g-f)/p.amount_scale,refund_ratio:g?Number(f)/Number(g)*100:null};}
export function expected(p,s){const rows=selected(p,s),k=totals(rows,p),old={...s,lower:prior(s.lower),upper:prior(s.upper)},o=totals(selected(p,old),p);
 k.yoy=admittedPlan?.comparison==='none'?null:old.lower>=p.coverage.lower&&old.upper<=p.coverage.upper_exclusive&&o.net!==0?(k.net/o.net-1)*100:null;
 const key=s.parent===null?(s.dimension==='country'?1:2):(s.dimension==='country'?2:1);
 const groups=[...new Set(rows.map(r=>r[key]))].map(label=>({label,...totals(rows.filter(r=>r[key]===label),p)})).sort((a,b)=>b.net-a.net||(a.label<b.label?-1:a.label>b.label?1:0));
 const months=[];for(let m=s.lower;m<s.upper;){months.push({month:m,...totals(rows.filter(r=>r[0]===m),p)});let [y,n]=m.split('-').map(Number);n++;if(n===13){y++;n=1;}m=y+'-'+String(n).padStart(2,'0');}
 return {k,groups,months,empty:!rows.length};}
export function journey(p){let s=defaults(p);const steps=[{action:'initial',state:{...s}}];const add=(action,value,next)=>{s={...s,...next};steps.push({action,value,state:{...s}});};
 const advance=(m,n)=>{const d=new Date(m+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7);};
 add('lower',p.coverage.lower,{lower:p.coverage.lower,parent:null});add('upper',p.coverage.upper_exclusive,{upper:p.coverage.upper_exclusive,parent:null});
 const country=[...new Set(p.rows.map(r=>r[1]))].sort().at(-1),channels=[...new Set(p.rows.filter(r=>r[1]===country).map(r=>r[2]))].sort(),channel=channels[Math.floor(channels.length/2)];
 const first=s.dimension==='country'?country:channel,second=s.dimension==='country'?'channel':'country';
 add('country',country,{country,parent:null});add('drill',first,{parent:first});add('roll-up',null,{parent:null});
 add('channel',channel,{channel,parent:null});add('dimension',second,{dimension:second,parent:null});add('drill',second==='country'?country:channel,{parent:second==='country'?country:channel});add('roll-up',null,{parent:null});
 add('lower',advance(p.coverage.upper_exclusive,-1),{lower:advance(p.coverage.upper_exclusive,-1),parent:null});add('upper',p.coverage.upper_exclusive,{upper:p.coverage.upper_exclusive,parent:null});add('reset',null,defaults(p));
 add('lower',p.coverage.lower,{lower:p.coverage.lower,parent:null});const early=advance(p.coverage.lower,6)<p.coverage.upper_exclusive?advance(p.coverage.lower,6):p.coverage.upper_exclusive;
 add('upper',early,{upper:early,parent:null});add('invalid-lower',p.coverage.upper_exclusive,{});add('reset',null,defaults(p));return steps;}
const amount=(text,n)=>n===null?text==='N/A':typeof text==='string'&&/^[+\-$\d,.%\s]+$/.test(text)&&Math.abs(Number(text.replace(/[$,%\s+]/g,''))-n)<.011;
async function observe(f){return f.evaluate(()=>{
 const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0||r.right<=0||r.left>=innerWidth)return false;for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility!=='visible'||+s.opacity===0)return false;}return true;};
 const one=s=>{const a=[...document.querySelectorAll(s)];return a.length===1&&visible(a[0])?a[0].textContent.trim():null;};
 const map=(a,b)=>[...document.querySelectorAll(a)].map(e=>({key:e.getAttribute(b),text:visible(e)?e.textContent.trim():null}));
 const controls=Object.fromEntries(['country','channel','dimension','lower','upper'].map(k=>{const e=document.querySelector(`[data-control="${k}"]`);return [k,e&&visible(e)&&e.labels?.length?e.value:null];}));
 const rows=[...document.querySelectorAll('[data-row]')].map(e=>Object.fromEntries(['label','gross','refunds','net','refund_ratio'].map(k=>{const a=e.querySelectorAll(`[data-field="${k}"]`);return[k,a.length===1&&visible(a[0])?a[0].textContent.trim():null];})));
 const up=document.querySelector('[data-action="roll-up"]');
 const small=[...document.querySelectorAll('[data-kpi],[data-month],[data-trend-value],[data-chart-label],[data-chart-value],[data-field]')].filter(visible).some(e=>{const m=e instanceof SVGGraphicsElement?e.getScreenCTM():null;return parseFloat(getComputedStyle(e).fontSize)*(m?Math.hypot(m.c,m.d):1)<14;});
 return {k:Object.fromEntries(['net','gross','refunds','refund_ratio','yoy'].map(k=>[k,one(`[data-kpi="${k}"]`)])),controls,rows,
 months:map('[data-month]','data-month'),trend:map('[data-trend-value]','data-trend-value'),labels:map('[data-chart-label]','data-chart-label'),values:map('[data-chart-value]','data-chart-value'),
 breadcrumb:one('[data-breadcrumb]'),period:one('[data-period]'),up:up&&visible(up)?up.disabled:null,
 drills:[...document.querySelectorAll('[data-drill]')].map(e=>({key:e.getAttribute('data-drill'),ok:visible(e)&&!e.disabled})),
 empty:!!one('[data-empty]'),error:!!one('[data-error]'),synthetic:/synthetic/i.test(document.body.innerText),
 warnings:[...(small?['small_text']:[]),...(document.documentElement.scrollWidth>innerWidth+1?['horizontal_overflow']:[])]};});}
export function matchesBreadcrumb(value,state){
 const dimension=state.dimension==='country'?/\bcountr(?:y|ies)\b/i:/\bchannels?\b/i;
 return typeof value==='string'&&dimension.test(value)&&(state.parent===null||value.includes(state.parent));
}
export function compare(o,e,s,a){const fails=[];
 if(!Object.keys(e.k).every(k=>amount(o.k[k],e.k[k])))fails.push('kpi');
 if(o.rows.length!==e.groups.length||!e.groups.every((g,i)=>o.rows[i]?.label===g.label&&['gross','refunds','net','refund_ratio'].every(k=>amount(o.rows[i][k],g[k]))))fails.push('table');
 if(o.months.length!==e.months.length||o.trend.length!==e.months.length||!e.months.every(m=>o.months.filter(x=>x.key===m.month&&x.text===m.month).length===1&&o.trend.filter(x=>x.key===m.month&&amount(x.text,m.net)).length===1))fails.push('trend');
 if(o.labels.length!==e.groups.length||o.values.length!==e.groups.length||!e.groups.every(g=>o.labels.filter(x=>x.key===g.label&&x.text===g.label).length===1&&o.values.filter(x=>x.key===g.label&&amount(x.text,g.net)).length===1))fails.push('breakdown');
 if(!Object.keys(o.controls).every(k=>o.controls[k]===s[k]))fails.push('controls');
 if(!matchesBreadcrumb(o.breadcrumb,s))fails.push('breadcrumb');
 if(![s.lower,s.upper,'UTC','inclusive','exclusive'].every(x=>o.period?.includes(x))||!o.synthetic)fails.push('scope');
 if(o.empty!==e.empty||o.error!==(a==='invalid-lower'))fails.push('empty_error');
 if(o.up!==(s.parent===null)||(s.parent===null?(o.drills.length!==e.groups.length||!e.groups.every(g=>o.drills.some(x=>x.key===g.label&&x.ok))):o.drills.length!==0))fails.push('drill_controls');
 return fails;}
async function act(f,{action:a,value:v}){if(a==='initial')return;if(a==='reset'||a==='roll-up')await f.locator(`[data-action="${a}"]`).click();else if(a==='drill')await f.locator(`[data-drill=${JSON.stringify(v)}]`).click();else if(['lower','upper','invalid-lower'].includes(a)){const e=f.locator(`[data-control="${a==='invalid-lower'?'lower':a}"]`);await e.fill(v);await e.press('Tab');}else await f.locator(`[data-control="${a}"]`).selectOption(v);await f.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
const [input,out]=process.argv.slice(2);
try {const {spec,bundle,analysis_plan}=JSON.parse(await readFile(input,'utf8'));admittedPlan=analysis_plan??null;validateCode(spec,bundle);await mkdir(out,{recursive:true});const b=await isolatedBrowser();const records=[],warnings=new Set();
 const changed=structuredClone(bundle.payload);changed.rows=changed.rows.map((r,i)=>[r[0],r[1]+' X','Alt '+r[2],r[3]+(i+1)*100000000,r[4]+100000000]);
 try {for(const [kind,p] of [['original',bundle.payload],['changed',changed]])for(const width of [1280,390]){const v=await loadPreview(b.browser,spec,p,{width,height:900});
  try{for(const [i,step]of journey(p).entries()){let o=null,failures=[];const start=performance.now();
   try{await act(v.frame,step);await resetHorizontalScroll(v.frame);o=await observe(v.frame);o.drill_reachability=await probeDrillReachability(v.frame,o.drills);if(o.drill_reachability.some(x=>x.reachable))warnings.add('horizontal_scroll_for_drill');const e=expected(p,step.state);failures=compare(o,e,step.state,step.action);o.analysis=await inspectInsights(v.frame,p,step.state,admittedPlan);if(o.analysis.failures.length)failures.push('insight_data');o.warnings.forEach(x=>warnings.add(x));
    for(const [marker,rows]of [['trend',e.months],['breakdown',e.groups]])if(rows.some(r=>r.net!==0)){const chart=await inspectChart(v.frame,{datasets:[{}, {rows}]},{marker,contract:'revenue-chart/1',recover:false});if(!chart.present)failures.push('chart_rendering');}
   }catch{failures.push('interaction');}
   if(v.errors.length||v.consoleErrors.length)failures.push('runtime_error');if(v.network.length||v.consoleErrors.some(x=>/connect-src|Connecting to|Refused to connect/i.test(x)))failures.push('network_attempt');
   records.push({kind,width,index:i,action:step.action,state:step.state,observed:o,failures,runtime_errors:[...v.errors,...v.consoleErrors],network_attempts:[...v.network],elapsed_ms:Math.round(performance.now()-start)});
   if(i===0){await v.frame.evaluate(axe.source);const c=await v.frame.evaluate(async()=>{const a=await axe.run(document,{runOnly:{type:'rule',values:['color-contrast']}});return{violations:a.violations.length,incomplete:a.incomplete.length};});if(c.violations)warnings.add('contrast_violation');if(c.incomplete)warnings.add('contrast_unverified');records.at(-1).contrast=c;}
   if(i===0||i===2||step.action==='drill'||failures.length)await capturePreview(v,join(out,`${kind}-${width}-${i}.png`));if(failures.length)break;
  }}finally{await v.context.close();}
 }}finally{await b.close();}
 const failures=records.flatMap(r=>r.failures),pass=!failures.length&&records.length===journey(bundle.payload).length*4;
 const qa={version:'revenue-browser/1',pass,warnings:[...warnings],records,repair_codes:pass||failures.includes('network_attempt')?[]:[...new Set(failures.map(f=>['interaction','runtime_error','controls','breadcrumb','empty_error','drill_controls'].includes(f)?'interaction':f==='chart_rendering'?f:'data_binding'))]};
 await writeFile(join(out,'qa.json'),JSON.stringify(qa,null,2));
}catch(e){await writeFile(join(out,'qa-error.txt'),String(e));process.exitCode=1;}

}
