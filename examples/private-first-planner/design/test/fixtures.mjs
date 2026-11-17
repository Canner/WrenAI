import { fixturePayload } from '../../host/fixture.mjs';
import { digest } from '../../contracts.mjs';
export const bundle={export_id:'00000000-0000-0000-0000-000000000001',data_version:digest(fixturePayload),payload:fixturePayload,recipient:'test'};
export function code(b=bundle) {
  return {version:1,export_id:b.export_id,data_version:b.data_version,
    html:'<main><h1>Revenue</h1><p>Synthetic data</p><p data-period></p><h2 data-value="revenue_total:0"></h2><div data-chart="revenue_weekly"></div><button data-action="toggle-details">Show details</button><section data-details hidden><h2>Source values</h2><table></table></section></main>',
    css:'body{margin:0;background:white;color:#17212b;font:16px Arial}main{padding:20px;max-width:1000px;margin:auto}svg{width:100%;height:auto}svg text{font-size:22px;fill:#17212b}button{background:#17212b;color:white;font:16px Arial;padding:12px;border:0}td{padding:8px}h2{font-size:30px}',
    javascript:`const d=window.dashboardData,rows=d.datasets[1].rows;document.querySelector('[data-value="revenue_total:0"]').textContent='$'+d.datasets[0].rows[0].revenue;
      document.querySelector('[data-period]').textContent=d.period.lower+' inclusive to '+d.period.upper+' exclusive, UTC; first week may be partial.';
      const max=Math.max(...rows.map(r=>r.revenue));
      document.querySelector('[data-chart]').innerHTML='<svg viewBox="0 0 480 250" role="img" aria-label="Weekly revenue">'+rows.map((r,i)=>'<rect x="'+(i*160+40)+'" y="'+(180-r.revenue/max*130)+'" width="50" height="'+(r.revenue/max*130)+'" fill="#175b8a"/>').join('')+'</svg>'+rows.map((r,i)=>'<p><span data-week="'+i+'">'+r.week+'</span> <span data-value="revenue_weekly:'+i+'">$'+r.revenue+'</span></p>').join('');
      document.querySelector('table').innerHTML=rows.map(r=>'<tr><td>'+r.week+'</td><td>$'+r.revenue+'</td></tr>').join('');
      document.querySelector('button').addEventListener('click',()=>{const section=document.querySelector('[data-details]');section.hidden=!section.hidden;});`,
  };
}
export function snapshot() {
  const evidence={mandatory_scope:{kind:'project_defaults',declared_defaults_enforced:true},checks_summary:'all_satisfied',
    applied_period:{lower:'2026-01-01',upper:'2026-01-19',lower_inclusive:true,upper_inclusive:false},
    checks:{'exclude-test-orders':{result:'satisfied'},'count-paid-and-shipped':{result:'satisfied'}},
    observed:{aggregated:true,models:['orders'],columns:{orders:['amount','is_test','order_date','status']},joins:[],status_literals:{'orders.status':['paid','shipped']}},unverified:['fiscal_calendar_bounds']};
  return {state:'completed',plan_revision:0,plans:[{presentation:'dashboard_design',constraints:{period:fixturePayload.period,filters:[],requested_statuses:[]}}],
    results:fixturePayload.datasets.map(d=>({plan_revision:0,group:{grain:d.grain},evidence,
      result:{kind:'table',timezone:'UTC',columns:d.columns.map((_,i)=>({key:'c'+i,label:'PRIVATE_LABEL'})),
        rows:d.rows.map(r=>Object.fromEntries(d.columns.map((k,i)=>['c'+i,r[k]])))}}))};
}
