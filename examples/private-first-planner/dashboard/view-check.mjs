import assert from 'node:assert/strict';
// A simple, inspectable geometric oracle. Alternative chart types remain allowed;
// the evaluator checks their visible encoding instead of imposing one renderer.
export function proportional(values,lengths,{tolerancePx=2,relativeTolerance=.05}={}){
  assert.equal(values.length,lengths.length);if(!values.length)return;
  const i=values.indexOf(Math.max(...values.map(Math.abs)));
  if(i<0||values[i]===0)return;
  const scale=lengths[i]/Math.abs(values[i]);
  for(let n=0;n<values.length;n++)assert(Math.abs(lengths[n]-Math.abs(values[n])*scale)<=Math.max(tolerancePx,Math.abs(values[n])*scale*relativeTolerance),'chart_scale_mismatch');
}
export async function checkPlanView(frame,plan,oracle,warnings,context){
  const view=await frame.evaluate(()=>{
    const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};
    const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
    const point=e=>{const r=rect(e);return{x:r.x+r.width/2,y:r.y+r.height/2};};
    return {sections:[...document.querySelectorAll('[data-plan-section]')].map(e=>({id:e.dataset.planSection,chart:e.dataset.chartType,visible:visible(e),text:e.textContent})),
      breakdown:[...document.querySelectorAll('[data-chart-value]')].map(e=>{const root=e.closest('[data-chart-group]')??e.closest('[data-drill]')??e.parentElement;const mark=root.querySelector('[data-drill-mark]');return{label:e.dataset.chartValue,mark:mark&&visible(mark)?{...rect(mark),...point(mark),tag:mark.tagName}:null};}),
      trend:[...document.querySelectorAll('[data-trend-mark]')].map(e=>({period:e.dataset.trendMark,visible:visible(e),...rect(e),...point(e),tag:e.tagName})),
      numericWrap:[...document.querySelectorAll('[data-kpi]')].filter(e=>{const range=document.createRange();range.selectNodeContents(e);return new Set([...range.getClientRects()].map(r=>Math.round(r.y))).size>1;}).map(e=>e.dataset.kpi),
      trendPaths:[...document.querySelectorAll('[data-plan-section="trend"] svg path,[data-plan-section="trend"] svg polyline')].filter(visible).length};
  });
  assert.deepEqual(view.sections.map(s=>s.id),plan.sections.map(s=>s.id),'plan_section_order');
  for(const [i,s] of plan.sections.entries()){
    const v=view.sections[i];assert(v.visible&&v.chart===s.chart&&v.text.includes(s.title)&&v.text.includes(s.question),'plan_section_content');
  }
  const b=plan.sections.find(s=>s.id==='breakdown'),t=plan.sections.find(s=>s.id==='trend');
  assert.equal(view.breakdown.length,oracle.groups.length);assert(view.breakdown.every(m=>m.mark),'visible_chart_marks');
  const values=oracle.groups.map(g=>g.metrics[oracle.primary]);
  if(b.chart==='bar')proportional(values,view.breakdown.map(x=>x.mark.width));
  else if(values.length>2){
    // Dot position is an affine mapping of the measure, independent of radius.
    const max=values.indexOf(Math.max(...values)),min=values.indexOf(Math.min(...values));
    const span=values[max]-values[min],xs=view.breakdown.map(x=>x.mark.x);
    if(span/Math.max(...values.map(Math.abs),1)>.02)assert(Math.abs(xs[max]-xs[min])>1,'collapsed_dot_positions');
    if(span)for(let i=0;i<values.length;i++)assert(Math.abs(xs[i]-(xs[min]+(values[i]-values[min])/span*(xs[max]-xs[min])))<=2,'dot_scale_mismatch');
  }
  assert.deepEqual(view.trend.map(x=>x.period),oracle.trend.map(x=>x.period),'trend_plan_marks');
  assert(view.trend.every(x=>x.visible),'visible_trend_marks');
  if(t.chart==='bar')proportional(oracle.trend.map(x=>x.value),view.trend.map(x=>x.height));
  else{
    assert(view.trendPaths>0,'missing_trend_path');
    const vs=oracle.trend.map(x=>x.value),ys=view.trend.map(x=>x.y),max=vs.indexOf(Math.max(...vs)),min=vs.indexOf(Math.min(...vs)),span=vs[max]-vs[min];
    if(span/Math.max(...vs.map(Math.abs),1)>.02)assert(Math.abs(ys[max]-ys[min])>1,'collapsed_trend_points');
    assert(view.trend.every((p,i)=>i===0||p.x>view.trend[i-1].x),'trend_point_order');
    if(span)for(let i=0;i<vs.length;i++)assert(Math.abs(ys[i]-(ys[min]+(vs[i]-vs[min])/span*(ys[max]-ys[min])))<=2,'trend_point_scale_mismatch');
  }
  if(view.numericWrap.length)warnings.push({...context,code:'wrapped_kpi',metrics:view.numericWrap});
}
