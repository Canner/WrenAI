import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from '../contracts.mjs';
import {aggregate} from './protocol.mjs';
const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const out=process.argv[2];const report=JSON.parse(await readFile(join(out,'report.json'),'utf8'));
const dir=join(out,'blind');await mkdir(dir,{mode:0o700});const mapping=[];
for(const block of report.blocks)for(const arm of block.arms){
  if(arm.state!=='completed')continue;
  const id='V-'+digest([block.index,arm.mode,'paired-design-v1']).slice(0,6).toUpperCase();
  await copyFile(join(out,`block-${String(block.index).padStart(2,'0')}`,arm.artifact),join(dir,`${id}.html`));
  mapping.push({id,block:block.index,case_id:block.case_id,repeat:block.repeat,mode:arm.mode,provider:arm.provider,spec:arm.spec});
}
mapping.sort((a,b)=>a.id.localeCompare(b.id));
await writeFile(join(out,'blind-mapping.json'),JSON.stringify(mapping,null,2),{flag:'wx',mode:0o600});
const style='body{font:16px system-ui;margin:36px;background:#f4f6f8;color:#172633}main{max-width:1300px;margin:auto}a{color:#126765}table{border-collapse:collapse;width:100%;background:white}th,td{padding:12px;border:1px solid #ddd;text-align:left}section{margin:28px 0;padding:24px;background:white;border-radius:16px}iframe{width:100%;height:780px;border:0}p{line-height:1.6}';
const blind=`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anonymous design comparison</title><style>${style}</style><main><h1>Anonymous design comparison</h1><p>Same approved synthetic data, design contract and renderer. Rate hierarchy, readability, chart fit, consistency and polish from 1 to 5. Labels reveal no model or routing mode. Identical-looking results may be identical choices.</p>${mapping.map(m=>`<section><h2>${m.id}</h2><p>Case: ${esc(m.case_id)} · repeat ${m.repeat} · <a href="${m.id}.html">Open full size</a></p><iframe sandbox src="${m.id}.html" title="${m.id}"></iframe></section>`).join('')}</main></html>`;
await writeFile(join(dir,'index.html'),blind,{flag:'wx',mode:0o600});
const summary=aggregate(report.blocks);const seconds=x=>x===null?'—':(x/1000).toFixed(2);
const html=`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>P4 paired comparison</title><style>${style}</style><main><h1>P4 三流程配對比較</h1><p>同一組合成資料，每個案例共用一次 Nemotron/Wren 查詢，再分別執行三個設計流程。下列完整時間是「共同查詢＋該流程」的組合值，不是三條獨立端到端實測。</p><p><a href="blind/index.html">開啟匿名成品比較</a> · <a href="report.json">原始量測</a></p><table><thead><tr><th>流程</th><th>完成／已排定</th><th>Claude 次數</th><th>設計 P50 秒</th><th>組合 P50 秒</th><th>已知 Claude 估算 USD</th></tr></thead><tbody>${summary.map(s=>`<tr><td>${esc(s.mode)}</td><td>${s.completed}/${s.scheduled}</td><td>${s.cloud_invocations}</td><td>${seconds(s.arm_p50_ms)}</td><td>${seconds(s.composed_p50_ms)}</td><td>${s.known_claude_list_usd.toFixed(6)}${s.missing_claude_costs?' + 未知':''}</td></tr>`).join('')}</tbody></table><p>Claude 金額為 client list estimate，非帳單。Nemotron 權杖用量另存原始量測，部署與總成本未知，不以 0 補值。每組僅 8 個預排樣本，P95 不代表正式服務尾端延遲。</p><h2>案例紀錄</h2>${report.blocks.map(b=>`<section><h3>${esc(b.case_id)} #${b.repeat}</h3><p>資料階段：${esc(b.state)}；共同時間 ${seconds(b.private_ms)} 秒；路由提議：${esc(b.proposal??'無')}</p><ul>${b.arms.map(a=>`<li>${esc(a.mode)} → ${esc(a.provider)}：${esc(a.state)}，${seconds(a.elapsed_ms)} 秒${a.artifact?` · <a href="block-${String(b.index).padStart(2,'0')}/${a.artifact}">成品</a>`:''}</li>`).join('')}</ul></section>`).join('')}</main></html>`;
await writeFile(join(out,'index.html'),html,{flag:'wx',mode:0o600});
console.log(JSON.stringify({variants:mapping.length,gallery:join(out,'index.html')}));
