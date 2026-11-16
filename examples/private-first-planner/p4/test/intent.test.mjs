import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIntent,plannerContract} from '../intent-planning.mjs';
import {NemotronPlanner} from '../../p1/model.mjs';
const capabilities=[{id:'analytics'}];
const conversation=[{role:'user',content:'營收，2026-01-01 含至 2026-01-19 不含，UTC，總額與每週'}];
const args=()=>({metrics:[{quote:'營收',definition:'Sum order amounts in USD, excluding tests and applying paid/shipped defaults'}],period:{quotes:['2026-01-01','2026-01-19'],lower:'2026-01-01',upper:'2026-01-19',timezone:'UTC'},objective:'Revenue',filters:[],requested_statuses:[],groups:[{id:'total',capability:'analytics',quote:'總額',metric_index:0,grain:'scalar'},{id:'weekly',capability:'analytics',quote:'每週',metric_index:0,grain:'week'}],presentation:'dashboard_design',unsupported_reason:null});
const parse=x=>parseIntent('resolve_intent',x,capabilities,{conversation});
test('resolved user facts yield a plan with the same concrete definition in each group',()=>{
 const x=args(),d=parse(x);assert.equal(d.name,'plan_queries');assert.equal(d.args.groups.length,2);
 for(const g of d.args.groups)assert.equal(g.metric,x.metrics[0].definition);
 assert.deepEqual(d.args.constraints.period,{lower:'2026-01-01',upper:'2026-01-19',timezone:'UTC'});
 assert.throws(()=>parse({...x,question:'Please confirm'}));
});
test('host asks only for absent fields and does not let missing intent carry a plan',()=>{
 const both={...args(),metrics:[],period:null,groups:[]};assert.equal(parse(both).args.question,'請問您想查看哪個指標，以及哪段起訖期間？');
 assert.equal(parse({...args(),metrics:[],groups:[]}).args.question,'請問您想查看哪個指標？');
 assert.equal(parse({...args(),period:null,groups:[]}).args.question,'請問要查詢哪段起訖期間？');
 const missing=parse({...args(),period:null});assert.equal(missing.name,'clarify_intent');assert.equal(Object.hasOwn(missing.args,'groups'),false);
});
test('metadata, assistant text and example facts cannot substitute for user evidence',()=>{
 for(const bad of [{...args(),metrics:[{quote:'invoice value',definition:'invoices'}]}, {...args(),period:{...args().period,quotes:['2026-06-01']}}])assert.equal(parse(bad).name,'clarify_intent');
 assert.equal(parseIntent('resolve_intent',args(),capabilities,{conversation:[{role:'assistant',content:conversation[0].content}]}).name,'clarify_intent');
 assert.throws(()=>parseIntent('resolve_intent',args(),capabilities));
});
test('follow-up user facts are accepted; existing scope, group and date validation stays in force',()=>{
 const turns=[{role:'user',content:'營收總額與每週'},{role:'assistant',content:'期間？'},{role:'user',content:'2026-01-01 到 2026-01-19'}];
 assert.equal(parseIntent('resolve_intent',args(),capabilities,{conversation:turns}).name,'plan_queries');
 for(const bad of [{...args(),period:{...args().period,lower:'2026-02-30'}},{...args(),groups:[{...args().groups[0],metric_index:1}]},{...args(),groups:[{...args().groups[0],capability:'sql'}]}])assert.throws(()=>parse(bad));
 const x=args();x.requested_statuses=['paid','shipped','cancelled'];assert.deepEqual(parse(x).args.constraints.requested_statuses,x.requested_statuses);
});
test('native transport supplies actual conversation evidence to the resolver parser',async()=>{
 const model=new NemotronPlanner({id:'nvidia/nemotron-test',baseUrl:'https://test.invalid'},{apiKey:'secret',decisionContract:plannerContract,fetchImpl:async()=>Response.json({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'resolve_intent',arguments:JSON.stringify(args())}}]}}]})});
 const d=await model.decide({conversation,capabilities,metadata:{},timeoutMs:1000});assert.equal(d.name,'plan_queries');assert.equal(model.calls.length,1);assert.equal(model.calls[0].proposed.name,'resolve_intent');
});


test('unrequested weekly groups and fabricated grain evidence fail closed',()=>{
 const x=args();x.groups[1].quote='總額';assert.throws(()=>parse(x));
 x.groups[1].quote='weekly';assert.throws(()=>parse(x));
});
