import { dataSummary } from '../harnesses/data-validation.mjs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { TuiMainScreen, Text, Input, ProcessTerminal, matchesKey } from '@earendil-works/pi-tui';
import { digest, requireThat } from '../contracts.mjs';
import { warningSummary } from './validation.mjs';

// Deterministic trusted control mapping. Approval is a dedicated UI action;
// neither a planner tool call nor ordinary conversation text can grant export.
export function uiCommand(state, value) {
  const task = state.task; let type, payload;
  if (value === '/cancel') { type = 'cancel'; payload = {}; }
  else if (value.startsWith('/redesign ')) { type = 'redesign'; payload = { brief_id: value.slice(10).trim() }; }
  else if (task?.state === 'waiting' && task.pending.source === 'export') {
    requireThat(['/approve', '/deny'].includes(value)); type = 'export';
    payload = { question_id: task.pending.id, export_id: task.export.export_id, request_digest: digest(task.export), approve: value === '/approve' };
  } else if (task?.state === 'waiting') {
    type = 'answer'; payload = { question_id: task.pending.id, answer: value };
  } else {
    type = 'submit'; const plan_only = value.startsWith('/plan ');
    payload = { message: plan_only ? value.slice(6) : value, route: 'adaptive', plan_only };
  }
  return { id: randomUUID(), expected_revision: state.revision, type, payload };
}
const safe = text => String(text).replace(/[\x00-\x1f\x7f-\x9f]/g, c => c === '\n' ? '\n' : '');
export function viewState(state) {
  const task = state.task;
  if (!task) return '已就緒，請輸入分析需求。';
  const names = { planning: '規劃中', working: '處理中', querying: '查詢中', designing: '設計與檢查中',
    waiting: '等待您的回覆', completed: '已完成', failed: '未完成', cancelled: '已取消', interrupted: '工作已中斷', unsupported: '目前不支援' };
  const preview = [];
  if (task.pending?.source === 'export') {
    const bundle = task.export;
    preview.push(`接收模型：${bundle.recipient}`, '用途：dashboard 設計', `設計需求：${bundle.design_brief}`,
      `授權期限：${new Date(bundle.expires_at).toLocaleString()}；最多修稿 ${bundle.max_repairs} 次。`, '將傳送的資料：');
    // Show every projected field; omit only internal grant IDs/hashes. Unknown
    // domain fields remain visible instead of being silently hidden by this UI.
    for (const [key, value] of Object.entries(bundle.payload)) {
      if (key === 'datasets' && Array.isArray(value)) {
        for (const data of value) preview.push(JSON.stringify(data));
      } else preview.push(`${key}：${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
    preview.push('輸入 /approve 同意傳送，或 /deny 保留私有結果。');
  }
  return safe([`狀態：${task.state === 'completed' && task.data_validation?.status === 'unverified' ? '預覽可用（尚未驗證）' : names[task.state] ?? task.state}`, task.pending?.question ?? '', ...preview,
    !task.plan_only && (task.results?.length || task.data_validation) ? dataSummary(task.data_validation) : '',
    task.reason === 'cloud_design' ? warningSummary(task.attempts?.find(x => x.artifact === task.artifact)?.qa) : '',
    task.artifact ? `結果檔案：${task.artifact}` : '',
    task.state === 'failed' ? '此次工作未完成，既有結果仍保存在本機。' : ''].join('\n'));
}
export function createView({ terminal = new ProcessTerminal(), submit, quit }) {
  const tui = new TuiMainScreen(terminal), status = new Text('Connecting…'), input = new Input({ prompt: '> ' });
  tui.addChild(new Text('Private-first · pi\n/plan · /cancel · /redesign default · /quit'));
  tui.addChild(status); tui.addChild(input); tui.setFocus(input);
  input.onSubmit = value => { input.setValue(''); if (value === '/quit') quit(); else submit(value); };
  tui.addInputListener(data => { if (matchesKey(data, 'ctrl+c')) { quit(); return { consume: true }; } });
  return { start: () => tui.start(), stop: () => tui.stop(), update: value => { status.setText(safe(value)); tui.requestRender(); } };
}
export async function connectUI({ url, token }) {
  requireThat(/^http:\/\/127\.0\.0\.1:\d+$/.test(url));
  let state, stopped = false, submitting = false, refreshBusy = false, lastView;
  const request = async (path, options = {}) => {
    const response = await fetch(`${url}${path}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    requireThat(response.ok); return response.json();
  };
  const refresh = async () => {
    if (refreshBusy || stopped || submitting) return; refreshBusy = true;
    try { state = await request('/state'); const next = viewState(state);
      if (!stopped && next !== lastView) { view.update(next); lastView = next; } }
    catch { if (!stopped) view.update('Host unavailable. No command has been replayed.'); }
    finally { refreshBusy = false; }
  };
  const quit = () => { stopped = true; clearInterval(timer); view.stop(); };
  const view = createView({ quit, submit: async value => {
    if (!state || submitting) return; submitting = true;
    try { await request('/commands', { method: 'POST', body: JSON.stringify(uiCommand(state, value)) }); }
    catch { view.update('Command rejected or status unknown. Refresh before submitting again.'); }
    finally { submitting = false; await refresh(); }
  } });
  const timer = setInterval(refresh, 500); view.start(); await refresh(); return { close: quit };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await connectUI(JSON.parse(await readFile(process.argv[2], 'utf8')));
}
