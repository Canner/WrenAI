import { digest, immutable, requireThat } from '../contracts.mjs';
import { validateReport } from '../analysis/browser/contract.mjs';
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const text={type:'string',minLength:1,maxLength:1200};
const strings={type:'array',items:text,minItems:1,maxItems:12};
export const planSchema=immutable(object({
  version:{type:'integer',enum:[1]},export_id:{type:'string'},data_version:{type:'string'},
  objective:text,primary_metric:text,
  period:object({lower:text,upper:text}),
  sections:{type:'array',minItems:5,maxItems:5,items:object({
    id:{type:'string',enum:['metrics','breakdown','trend','details','observations']},
    question:text,title:text,chart:{type:'string',enum:['cards','bar','dot','line','area','table','text']},
    metrics:strings,dimension:{type:['string','null']},rationale:text,
  })},
  interactions:object({filters:strings,drill:object({from:text,to:text}),reset:text}),
  limitations:strings,
}));
const exact=(v,keys)=>requireThat(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(','));
const nonempty=v=>typeof v==='string'&&v.trim().length>0&&v.length<=1200;
export function validatePlan(plan,bundle,report,scope){
  const c=validateReport(report).capabilities;
  exact(plan,Object.keys(planSchema.properties));
  requireThat(plan.version===1&&plan.export_id===bundle.export_id&&plan.data_version===bundle.data_version
    && digest(report.payload)===bundle.data_version&&digest(bundle.payload)===bundle.data_version
    && nonempty(plan.objective)&&nonempty(plan.primary_metric));
  exact(plan.period,['lower','upper']);requireThat(digest(plan.period)===digest(scope));
  requireThat(scope.lower>=c.period.lower&&scope.upper<=c.period.upper&&scope.lower<scope.upper);
  const metrics=c.measures.map(m=>m.id),dims=c.dimensions.map(d=>d.id),primary=metrics.includes('net')?'net':metrics[0];
  requireThat(plan.primary_metric===primary&&Array.isArray(plan.sections)&&plan.sections.length===5);
  const kinds={metrics:['cards'],breakdown:['bar','dot'],trend:['bar','line','area'],details:['table'],observations:['text']};
  requireThat(new Set(plan.sections.map(s=>s.id)).size===5);
  for(const s of plan.sections){
    exact(s,['id','question','title','chart','metrics','dimension','rationale']);
    requireThat(Object.hasOwn(kinds,s.id)&&kinds[s.id].includes(s.chart)&&[s.question,s.title,s.rationale].every(nonempty));
    requireThat(Array.isArray(s.metrics)&&s.metrics.length>0&&new Set(s.metrics).size===s.metrics.length&&s.metrics.every(m=>metrics.includes(m)));
    requireThat(['breakdown','details'].includes(s.id)?s.dimension===dims[0]:s.dimension===null);
    if(['breakdown','trend'].includes(s.id))requireThat(s.metrics.length===1&&s.metrics[0]===primary);
    if(['metrics','details'].includes(s.id))requireThat([...s.metrics].sort().join(',')===[...metrics].sort().join(','));
  }
  exact(plan.interactions,['filters','drill','reset']);exact(plan.interactions.drill,['from','to']);
  requireThat(Array.isArray(plan.interactions.filters)&&[...plan.interactions.filters].sort().join(',')===[...dims].sort().join(',')
    && plan.interactions.drill.from===dims[0]&&c.breakdowns.some(b=>b.from===dims[0]&&b.to===plan.interactions.drill.to)
    && nonempty(plan.interactions.reset)&&Array.isArray(plan.limitations)&&plan.limitations.length>0&&plan.limitations.every(nonempty));
  return immutable(plan);
}

// Contract admission is objective; these quality observations are not a model judge.
export function scorePlan(plan){
  return {contract_passed:true,questions:plan.sections.map(s=>({id:s.id,question:s.question})),
    choices:plan.sections.map(s=>({id:s.id,chart:s.chart,rationale:s.rationale})),
    distinct_questions:new Set(plan.sections.map(s=>s.question.toLowerCase())).size,
    semantic_quality_requires_review:true};
}
