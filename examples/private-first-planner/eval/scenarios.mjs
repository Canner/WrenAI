import { immutable } from '../contracts.mjs';
export const modes=Object.freeze(['private_only','fixed_claude','adaptive']);
const scope='請用專案定義的營收，2026-01-01（含）到 2026-01-19（不含）、UTC，顯示總營收及按週營收，沿用專案預設口徑。';
export const cases=immutable([
  {id:'simple_charts',question:scope+'用基本圖表和標準排版即可，不需要額外美化。',human_answers:[],expected_route:'local_answer',clarify:false},
  {id:'standard_dashboard',question:scope+'做一份內部核對用的基本 dashboard，沿用預設樣式即可。',human_answers:[],expected_route:'local_answer',clarify:false},
  {id:'executive_dashboard',question:scope+'做成漂亮精緻、適合給主管看的 dashboard，希望有清楚的視覺層級。',human_answers:[],expected_route:'dashboard_design',clarify:false},
  {id:'ambiguous_design',question:'請幫我做一個漂亮的主管 dashboard，但先確認我要看的指標與期間。',human_answers:[scope+'請做成漂亮的主管 dashboard。私有備註 PRIVATE_BENCHMARK_CANARY 不要轉交設計模型。'],expected_route:'dashboard_design',clarify:true},
]);

const orders=[['private_only','fixed_claude','adaptive'],['fixed_claude','adaptive','private_only'],['adaptive','private_only','fixed_claude'],['private_only','adaptive','fixed_claude'],['adaptive','fixed_claude','private_only'],['fixed_claude','private_only','adaptive'],['private_only','fixed_claude','adaptive'],['adaptive','fixed_claude','private_only']];
export function schedule() {return cases.flatMap((item,c)=>[0,1].map(repeat=>({case:item,repeat:repeat+1,order:orders[c*2+repeat]})));}

// Operator-authored design requirements; never forward the user's private transcript.
export const briefs = immutable({
  simple_charts: 'A simple, clear dashboard with basic charts and restrained styling. Prioritize immediate understanding.',
  standard_dashboard: 'An internal reconciliation dashboard. Prioritize precise source values, readable labels and practical information density.',
  executive_dashboard: 'A polished executive dashboard with distinctive visual hierarchy, thoughtful typography and refined layout. Make the revenue story clear without inventing metrics or comparisons.',
  ambiguous_design: 'The metric and period have now been clarified. Build a beautiful executive revenue dashboard with clear hierarchy and accessible details. All analytic facts are supplied in the authorized payload.',
});
