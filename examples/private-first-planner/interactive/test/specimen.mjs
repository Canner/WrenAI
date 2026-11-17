// Deterministic fake designer output for OFFLINE testing only. This is not a
// production renderer or a template supplied to model providers.
function program() {
  const p = window.dashboardData, q = s => document.querySelector(s);
  const controls = Object.fromEntries(['region','category','dimension','lower','upper'].map(k => [k,q(`[data-control="${k}"]`)]));
  const initial = () => ({ region:'', category:'', dimension:'geography', parent:null, lower:p.period.lower, upper:p.period.upper });
  let state = initial();
  const money = n => n === null ? 'N/A' : '$' + n.toFixed(2);
  for (const field of ['region','category']) {
    for (const value of [...new Set(p.rows.map(r => r[field]))].sort()) {
      const option = document.createElement('option'); option.value = option.textContent = value; controls[field].append(option);
    }
  }
  for (const field of ['lower','upper']) { controls[field].min = p.period.lower; controls[field].max = p.period.upper; }
  function cell(tag, text, attr, value) {
    const el = document.createElement(tag); el.textContent = text;
    if(attr) el.setAttribute(attr,value); return el;
  }
  function render() {
    Object.entries(controls).forEach(([k,el]) => { el.value = state[k]; });
    q('[data-error]').hidden = true;
    const [top,leaf] = p.capabilities.dimensions[state.dimension], key = state.parent === null ? top : leaf;
    let cents = 0, count = 0; const map = new Map();
    for (const r of p.rows) {
      if (r.date < state.lower || r.date >= state.upper || (state.region && state.region !== r.region)
        || (state.category && state.category !== r.category) || (state.parent !== null && state.parent !== r[top])) continue;
      cents += r.revenue_cents; count += r.orders;
      const g = map.get(r[key]) || { label:r[key], cents:0, count:0 };
      g.cents += r.revenue_cents; g.count += r.orders; map.set(r[key],g);
    }
    const groups = [...map.values()].sort((a,b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
    q('[data-kpi="revenue"]').textContent = money(cents/100);
    q('[data-kpi="orders"]').textContent = String(count);
    q('[data-kpi="aov"]').textContent = money(count ? cents/count/100 : null);
    q('[data-period]').textContent = `${state.lower} inclusive — ${state.upper} exclusive · UTC`;
    q('[data-breadcrumb]').textContent = (state.dimension === 'geography' ? 'Geography' : 'Product') + (state.parent === null ? '' : ' / '+state.parent);
    q('[data-action="roll-up"]').disabled = state.parent === null;
    q('[data-empty]').hidden = groups.length !== 0;
    const table = q('tbody'); table.replaceChildren();
    const chart = q('[data-chart]'); chart.replaceChildren();
    const max = Math.max(1,...groups.map(g => Math.abs(g.cents)));
    for(const g of groups) {
      const row = document.createElement('tr'); row.dataset.row = g.label;
      for(const [field,text] of [['label',g.label],['revenue',money(g.cents/100)],['orders',String(g.count)],['aov',money(g.count ? g.cents/g.count/100 : null)]])
        row.append(cell('td',text,'data-field',field));
      const action = document.createElement('td');
      if(state.parent === null) {
        const b = cell('button','Explore '+g.label,'data-drill',g.label);
        b.addEventListener('click',()=>{state.parent=g.label;render();}); action.append(b);
      }
      row.append(action); table.append(row);
      const item = document.createElement('div'); item.className='chart-row';
      item.append(cell('span',g.label,'data-chart-label',g.label),cell('strong',money(g.cents/100),'data-chart-value',g.label));
      const track=document.createElement('div');track.className='track';
      const bar=document.createElement('div');bar.className='bar';
      const width=Math.abs(g.cents)/max*50;
      bar.style.width=(g.cents===0?'1px':width+'%');bar.style.left=(g.cents<0?50-width:50)+'%';
      bar.style.background=g.cents<0?'#a32f35':'#1a6684';track.append(bar);item.append(track);chart.append(item);
    }
  }
  for (const [key,el] of Object.entries(controls)) el.addEventListener('change',()=>{
    const next = { ...state, [key]:el.value, parent:null };
    if(!next.lower || !next.upper || next.lower < p.period.lower || next.upper > p.period.upper || next.lower >= next.upper) {
      q('[data-error]').hidden=false; el.value=state[key]; return;
    }
    state=next;render();
  });
  q('[data-action="roll-up"]').addEventListener('click',()=>{state.parent=null;render();});
  q('[data-action="reset"]').addEventListener('click',()=>{state=initial();render();});
  render();
}
export function specimen(bundle, { variant='default', fault=null }={}) {
  let javascript = `(${program.toString()})();`;
  if(fault === 'stale-kpi') javascript += `document.querySelector('[data-kpi="revenue"]').textContent='$1.00';`;
  if(fault === 'broken-reset') javascript += `const b=document.querySelector('[data-action="reset"]');b.replaceWith(b.cloneNode(true));`;
  if(fault === 'stale-chart') javascript += `const c=document.querySelector('[data-chart]');c.replaceWith(c.cloneNode(true));document.querySelector('[data-chart]').removeAttribute('data-chart');`;
  if(fault === 'no-chart') javascript += `document.querySelectorAll('.track').forEach(el=>el.remove());`;
  if(fault === 'infinite') javascript = 'while(true){}';
  if(fault === 'network') javascript += `fetch('https://invalid.example/').catch(()=>{});`;
  return { version:1, export_id:bundle.export_id, data_version:bundle.data_version,
    html:`<main><header><p class="eyebrow">SYNTHETIC DATA · INTERACTIVE ANALYSIS</p><h1>Revenue explorer</h1><p data-period></p></header>
    <section class="filters" aria-label="Analysis controls">
    <label>Region<select data-control="region"><option value="">All regions</option></select></label>
    <label>Category<select data-control="category"><option value="">All categories</option></select></label>
    <label>Group by<select data-control="dimension"><option value="geography">Geography</option><option value="product">Product</option></select></label>
    <label>From, inclusive<input type="date" data-control="lower"></label><label>Until, exclusive<input type="date" data-control="upper"></label>
    <button data-action="reset">Reset all</button></section><p data-error hidden role="alert">Choose a valid date range within the supplied period.</p>
    <section class="kpis" aria-label="Key metrics"><article><h2>Revenue</h2><strong data-kpi="revenue"></strong><small>USD · current selection</small></article>
    <article><h2>Orders</h2><strong data-kpi="orders"></strong><small>Current selection</small></article>
    <article><h2>Average order value</h2><strong data-kpi="aov"></strong><small>USD · revenue / orders</small></article></section>
    <section class="analysis"><div class="context"><h2 data-breadcrumb></h2><button data-action="roll-up">Back one level</button></div>
    <p data-empty hidden>No data matches these filters.</p><div data-chart="breakdown" aria-label="Revenue by selected dimension"></div>
    <table><caption>Current grouped aggregates</caption><thead><tr><th>Group</th><th>Revenue USD</th><th>Orders</th><th>AOV USD</th><th>Explore</th></tr></thead><tbody></tbody></table></section></main>`,
    css:`*{box-sizing:border-box}body{margin:0;background:#edf2f6;color:#193442;font:16px system-ui,sans-serif}main{max-width:1160px;margin:auto;padding:28px}h1{font-size:32px;margin:8px 0}h2{font-size:16px;margin:0 0 12px}.eyebrow,small{font-size:12px;color:#425b69}p{line-height:1.6}.filters,.kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:24px 0}label{display:flex;flex-direction:column;gap:8px;font-size:14px}button,select,input{font:inherit;min-width:0;min-height:44px;padding:9px;border:1px solid #94a9b6;border-radius:7px;background:white;color:#193442}button{cursor:pointer}button:disabled{opacity:.6;cursor:default}:focus-visible{outline:3px solid #18768e;outline-offset:3px}article,.analysis{background:white;border:1px solid #c9d5dd;border-radius:12px;padding:20px}article strong{display:block;font-size:30px;margin:14px 0;overflow-wrap:anywhere}small{display:block}.context{display:flex;align-items:center;justify-content:space-between;gap:10px}.context h2{margin:0}.chart-row{display:grid;grid-template-columns:1fr auto;gap:10px;margin:20px 0;font-size:14px}.track{grid-column:1/-1;background:#edf2f6;height:20px;position:relative;border-left:1px solid #bdcbd5}.track:after{content:'';position:absolute;left:50%;height:100%;border-left:1px solid #8498a6}.bar{height:100%;position:absolute}table{border-collapse:collapse;width:100%;margin-top:24px;font-size:14px}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #d5dfe5;overflow-wrap:anywhere}caption{text-align:left;padding:12px 0;font-weight:600}[data-error]{color:#9d2630}[hidden]{display:none!important}@media(max-width:600px){main{padding:16px}.filters{grid-template-columns:1fr 1fr}.kpis{grid-template-columns:1fr}.analysis{padding:14px}.context{align-items:flex-start}table,tbody,caption{display:block}caption{width:100%}thead{display:none}tr{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:12px 0;border-bottom:1px solid #aabbc5}td{display:block;padding:6px 0;border:0}[data-field="label"]{grid-column:1/-1;font-weight:bold}[data-field="revenue"]:before{content:'Revenue ';font-size:12px}[data-field="orders"]:before{content:'Orders ';font-size:12px}[data-field="aov"]:before{content:'AOV ';font-size:12px}tr td:last-child{grid-column:1/-1}tr button{width:100%}}` + (variant === 'editorial' ? 'body{background:#f7f4ed;color:#302f36}h1{font-family:Georgia,serif;font-size:38px}article{border-top:4px solid #96662b;border-radius:0}.analysis{border-radius:0}' : ''),
    javascript };
}
