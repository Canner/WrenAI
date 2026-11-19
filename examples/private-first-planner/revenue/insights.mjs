const prior=x=>String(Number(x.slice(0,4))-1)+x.slice(4);
function rows(p,s,lower,upper){return p.rows.filter(r=>r[0]>=lower&&r[0]<upper&&(!s.country||r[1]===s.country)&&(!s.channel||r[2]===s.channel)&&(s.parent===null||r[s.dimension==='country'?1:2]===s.parent));}
const net=rs=>rs.reduce((s,r)=>s+BigInt(r[3])-BigInt(r[4]),0n);
export function insightOracle(p,s,plan){
 const current=rows(p,s,s.lower,s.upper),old=rows(p,s,prior(s.lower),prior(s.upper));
 const covered=plan?.comparison!=='none'&&prior(s.lower)>=p.coverage.lower&&prior(s.upper)<=p.coverage.upper_exclusive;
 const result={net_change:covered&&current.length?{label:null,value:Number(net(current)-net(old))/p.amount_scale}:{label:null,value:null}};
 for(const [type,index]of [['country',1],['channel',2]]){
  if(!covered||!current.length||net(old)===0n){result[type]={label:null,value:null};continue;}
  const groups=[...new Set([...current,...old].map(r=>r[index]))].map(label=>({label,units:net(current.filter(r=>r[index]===label))-net(old.filter(r=>r[index]===label))}));
  const abs=n=>n<0n?-n:n;
  groups.sort((a,b)=>abs(a.units)>abs(b.units)?-1:abs(a.units)<abs(b.units)?1:a.label<b.label?-1:a.label>b.label?1:0);
  result[type]={label:groups[0].label,value:Number(groups[0].units)/p.amount_scale};
 }
 return result;
}
const amount=(text,n)=>n===null?text==='N/A':typeof text==='string'&&/^[+\-$\d,.\s]+$/.test(text)&&Math.abs(Number(text.replace(/[$,\s+]/g,''))-n)<.011;
export function compareInsights(observed,expected){const missing=[],failures=[];
 for(const type of ['net_change','country','channel']){
  const o=observed[type],e=expected[type];if(!o){missing.push(type);continue;}
  if(!o.valid||!amount(o.value,e.value)||(type!=='net_change'&&o.label!==(e.label??'N/A')))failures.push(type);
 }
 return {present:3-missing.length,missing,failures,expected,observed};
}
export async function inspectInsights(frame,p,s,plan){
 const observed=await frame.evaluate(()=>{
  const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0||r.right<=0||r.left>=innerWidth)return false;for(let a=e;a;a=a.parentElement){const x=getComputedStyle(a);if(x.display==='none'||x.visibility!=='visible'||+x.opacity===0)return false;}return true;};
  return Object.fromEntries(['net_change','country','channel'].map(type=>{const a=[...document.querySelectorAll(`[data-insight="${type}"]`)];if(!a.length)return[type,null];const c=a[0],v=c.querySelectorAll('[data-insight-value]'),l=c.querySelectorAll('[data-insight-label]');return[type,{valid:a.length===1&&visible(c)&&v.length===1&&visible(v[0])&&(type==='net_change'||l.length===1&&visible(l[0])),value:v[0]?.textContent.trim(),label:l[0]?.textContent.trim()}];}));
 });
 return compareInsights(observed,insightOracle(p,s,plan));
}
