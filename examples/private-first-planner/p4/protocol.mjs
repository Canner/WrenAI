import { immutable, requireThat, digest } from '../contracts.mjs';
export const modes=Object.freeze(['private_only','fixed_claude','adaptive']);
const scope='請用專案定義的營收，2026-01-01（含）到 2026-01-19（不含）、UTC，顯示總營收及按週營收，沿用專案預設口徑。';
export const cases=immutable([
  {id:'simple_charts',question:scope+'用基本圖表和標準排版即可，不需要額外美化。',human_answers:[],expected_route:'local_answer',clarify:false},
  {id:'standard_dashboard',question:scope+'做一份內部核對用的基本 dashboard，沿用預設樣式即可。',human_answers:[],expected_route:'local_answer',clarify:false},
  {id:'executive_dashboard',question:scope+'做成漂亮精緻、適合給主管看的 dashboard，希望有清楚的視覺層級。',human_answers:[],expected_route:'dashboard_design',clarify:false},
  {id:'ambiguous_design',question:'請幫我做一個漂亮的主管 dashboard，但先確認我要看的指標與期間。',human_answers:[scope+'請做成漂亮的主管 dashboard。私有備註 PRIVATE_BENCHMARK_CANARY 不要轉交設計模型。'],expected_route:'dashboard_design',clarify:true},
]);
export const protocol=immutable({version:1,repeats:2,case_ids:cases.map(c=>c.id),modes,
  design_calls_per_arm:1,max_claude_invocations:16,max_nemotron_designs:16,max_wall_ms:35*60_000,
  paired_data:true,worker_profile:'p1/profile',schema:'p2/DashboardSpec',renderer:'p2/renderDashboard',
  sample_policy:'Run all scheduled blocks once. Retain every failure; no replacement or cherry-picked retries.',
  latency:'Report shared private-phase wall time, measured arm wall time, and their arithmetic sum as composed latency, not independent E2E.',
  cost:'Claude client list estimate only. Nemotron tokens and deployment cost unknown; do not silently use zero for unknown cost.',
  auto_quality:['data_oracle','valid_design','no_external_requests','no_scripts','no_horizontal_overflow','source_values_visible','large_kpi_contrast_at_least_3','mobile_chart_label_at_least_12px'],
  visual_rubric:['hierarchy','readability','chart_fit','consistency','polish'],
  visual_scale:{1:'major problems',2:'noticeable problems',3:'usable',4:'clear and polished',5:'exceptional within this limited component system'},
  success_threshold:'All data/reference/disclosure gates must pass; failure remains a failure regardless of visual score.',
  interpretation:'Exploratory n=8 per mode; finite design choices and shared renderer limit quality differences. No significance or production P95 claim.',
});
export { plannerContract } from './intent-planning.mjs';
const orders=[['private_only','fixed_claude','adaptive'],['fixed_claude','adaptive','private_only'],['adaptive','private_only','fixed_claude'],['private_only','adaptive','fixed_claude'],['adaptive','fixed_claude','private_only'],['fixed_claude','private_only','adaptive'],['private_only','fixed_claude','adaptive'],['adaptive','fixed_claude','private_only']];
export function schedule() {return cases.flatMap((item,c)=>[0,1].map(repeat=>({case:item,repeat:repeat+1,order:orders[c*2+repeat]})));}
export function route(mode,proposal) {
  requireThat(modes.includes(mode)&&['local_answer','dashboard_design'].includes(proposal));
  return mode==='fixed_claude'||(mode==='adaptive'&&proposal==='dashboard_design')?'claude':'nemotron';
}
export function visualFingerprint(spec) {const {export_id,data_version,...visual}=spec;return digest(visual);}
export function percentile(values,q) {
  requireThat(q>0&&q<=1);
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  return sorted.length?sorted[Math.max(0,Math.ceil(q*sorted.length)-1)]:null;
}
export function aggregate(blocks) {
  return modes.map(mode=>{
    const arms=blocks.map(b=>({b,a:b.arms.find(a=>a.mode===mode)}));
    const completed=arms.filter(x=>x.a?.state==='completed');
    const attempted=arms.filter(x=>x.a && x.a.state!=='not_run');
    const costs=attempted.filter(x=>x.a.provider==='claude').map(x=>x.a.cost_usd);
    return {mode,scheduled:blocks.length,attempted:attempted.length,completed:completed.length,
      cloud_invocations:attempted.filter(x=>x.a.provider==='claude').length,
      arm_p50_ms:percentile(completed.map(x=>x.a.elapsed_ms),.5),arm_p95_ms:percentile(completed.map(x=>x.a.elapsed_ms),.95),
      composed_p50_ms:percentile(completed.map(x=>x.b.private_ms+x.a.elapsed_ms),.5),
      composed_p95_ms:percentile(completed.map(x=>x.b.private_ms+x.a.elapsed_ms),.95),
      known_claude_list_usd:costs.filter(Number.isFinite).reduce((a,b)=>a+b,0),
      missing_claude_costs:costs.filter(x=>!Number.isFinite(x)).length,
      total_cost_usd:null,unique_visuals:new Set(completed.map(x=>visualFingerprint(x.a.spec))).size};
  });
}
