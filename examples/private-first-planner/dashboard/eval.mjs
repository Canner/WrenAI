import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {digest,requireThat} from '../contracts.mjs';
import {ExportBroker} from '../host/export.mjs';
import {fixtureReport,fixturePlan,specimen,scope} from './fixtures.mjs';
import {planDashboard,frontendUnit} from './units.mjs';
import {behaviors} from './behaviors/index.mjs';

export async function releaseFor(unit){
  const component=unit==='dashboard-plan'?'plan_dashboard':'generate_dashboard_frontend';
  const files=['contracts.mjs','units.mjs','../design/claude.mjs','../host/export.mjs',...(unit==='dashboard-frontend'?['view-check.mjs','browser-qa.mjs','../design/design.mjs','../host/cloud.mjs','../analysis/browser/contract.mjs','../analysis/browser/runtime.mjs']:[])];
  const sources=Object.fromEntries(await Promise.all(files.map(async file=>[file,digest(await readFile(new URL(file,import.meta.url),'utf8'))])));
  return {unit,component,prompt_digest:digest(behaviors[component].prompt),sources};
}
// This factory performs no network/model calls. Live callers provide the same
// unit ports from units.mjs with explicitly configured authorized adapters.
export async function evaluateScripted(unit,out,{browser=false}={}){
  requireThat(['dashboard-plan','dashboard-frontend'].includes(unit));await mkdir(out,{mode:0o700});
  const report=fixtureReport(),manifest={version:'dashboard-unit-eval/1',mode:'scripted',unit,release:await releaseFor(unit),browser,
    cases:unit==='dashboard-plan'?['valid-bar','valid-line','unsupported-metric','unsupported-dimension','wrong-period','expired-grant']:['valid-bar','valid-line','valid-area','valid-dot','valid-horizontal-trend','wrong-plan','revoked-grant']};
  const write=(name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2),{flag:'wx',mode:0o600});await write('manifest.json',manifest);const records=[];
  for(const id of manifest.cases){
    let now=1000;const broker=new ExportBroker({policy:{id:'synthetic',version:'1',briefs:{default:'Synthetic revenue'},project:async()=>report.payload},current:async()=>null,audit:async()=>{},epoch:'fixture',now:()=>now});
    const bundle=await broker.propose({recipient:'scripted',brief_id:'default'});broker.approve(bundle.export_id,digest(bundle));
    const plan=fixturePlan(bundle,report,{trend:id==='valid-line'?'line':id==='valid-area'?'area':'bar',breakdown:id==='valid-dot'?'dot':'bar'});let calls=0;
    if(id==='unsupported-metric')plan.sections[0].metrics.push('profit');
    if(id==='unsupported-dimension')plan.sections.find(s=>s.id==='breakdown').dimension='city';
    if(id==='wrong-period')plan.period={lower:'1999-01-01',upper:'1999-03-01'};
    if(id==='wrong-plan')plan.data_version='0'.repeat(64);
    if(id==='expired-grant')now=bundle.expires_at;if(id==='revoked-grant')broker.revoke();
    const designer={recipient:'scripted',design:async(_,{beforeSend})=>{await beforeSend();calls++;return{spec:unit==='dashboard-plan'?plan:specimen(bundle,plan,{horizontalTrend:id==='valid-horizontal-trend'}),usage:null,cost_usd:null};}};
    let result;
    try{result=unit==='dashboard-plan'?await planDashboard({broker,planner:designer,report,scope,signal:new AbortController().signal}):await frontendUnit({broker,designer,plan,report,scope,signal:new AbortController().signal,
      inspect:browser?async generated=>{const input=join(out,id+'-candidate.json');await writeFile(input,JSON.stringify(generated),{flag:'wx',mode:0o600});const {inspectDashboard}=await import('./browser-qa.mjs');return inspectDashboard(input,join(out,id+'-browser'));}:undefined});}
    catch(error){result={state:'rejected',reason:error.message};}
    const expected=id.startsWith('valid'),success=['planned','generated'].includes(result.state)&&(!browser||unit==='dashboard-plan'||result.qa?.pass===true);
    const record={id,calls,result,expected_success:expected,passed:success===expected,quality_measured:browser&&unit==='dashboard-frontend'&&expected};records.push(record);await write(id+'.json',record);
  }
  const summary={version:'dashboard-unit-eval/1',mode:'scripted',unit,scheduled:records.length,passed:records.filter(r=>r.passed).length,model_cost_usd:null,records:records.map(({id,passed,result,quality_measured})=>({id,passed,state:result.state,quality_measured}))};await write('summary.json',summary);return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [unit,out,flag]=process.argv.slice(2);requireThat(out&&(flag===undefined||flag==='--browser'));
  evaluateScripted(unit,resolve(out),{browser:flag==='--browser'}).then(s=>{console.log(JSON.stringify(s,null,2));if(s.passed!==s.scheduled)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1});
}
