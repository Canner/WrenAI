import { dataSummary } from '../harnesses/data-validation.mjs';
const esc = x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function renderPrivateResults(snapshot) {
  const tables=snapshot.results.map(item=>`<section><h2>${esc(item.group.grain)}</h2><p>${esc(dataSummary(item.validation))}</p><table><tbody>${item.result.rows.map(row=>`<tr>${item.result.columns.map(c=>`<td>${esc(row[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Private results</title><style>body{font:16px system-ui;max-width:800px;margin:48px auto;padding:20px}td{padding:12px;border-bottom:1px solid #ccc}section{margin:32px 0}</style><h1>Private results</h1><p>${esc(dataSummary(snapshot.data_validation))} These are private query results; no cloud-generated claims are included.</p>${tables}</html>`;
}
