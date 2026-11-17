import { resolve, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { runInteractive } from './harness.mjs';
import { specimen } from './test/specimen.mjs';

const [destination]=process.argv.slice(2);
if(!destination||process.argv.length!==3)throw Error('usage: node interactive/run.mjs NEW_OUTPUT');
const out=resolve(destination);await mkdir(out,{mode:0o700});
const records=[];
for(const variant of ['base','changed','edge','empty']) {
  const recipient='scripted:interactive';
  const start=performance.now();
  const result=await runInteractive({variant,recipient,out:join(out,variant),makeDesigner:({contract})=>({recipient,
    async design(bundle,{beforeSend}) {
      if(!contract.systemPrompt||!contract.schema)throw Error('missing_behavior_contract');
      await beforeSend();return {spec:specimen(bundle,{variant:variant==='changed'?'editorial':'default'}),cost_usd:0};
    }})});
  records.push({variant,state:result.state,attempts:result.attempts.length,elapsed_ms:Math.round(performance.now()-start)});
  console.log(JSON.stringify(records.at(-1)));
}
const summary={version:'interactive-suite/1',mode:'scripted',model_quality_measured:false,paid_model_calls:0,
  scheduled:records.length,passed:records.filter(r=>r.state==='completed').length,records};
await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));
if(summary.passed!==summary.scheduled)process.exitCode=1;
