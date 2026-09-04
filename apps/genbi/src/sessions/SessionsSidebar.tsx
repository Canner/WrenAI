import { Button, Popover, Radio, Space, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type NativeSessionReadiness, type NativeSessionPurpose } from '@/bff/client';
import { isBffEnabled } from '@/bff/env';
import { useSessionStore } from '@/session/useSessionStore';
import { relativeActivity, purposeLabels, statusLabels, vendorLabels } from './sessionLabels';
import { structuredAskPath } from './structuredAsk';
import { useNativeSessions } from './useNativeSessions';
import './sessions.css';

/** Setup stays in the typed onboarding wizard; native Sessions are post-setup tools. */
const newSessionPurposes = ['analysis', 'context_enrichment'] as const satisfies readonly NativeSessionPurpose[];

function NewSessionControl({ live, readiness }: { live: boolean; readiness?: NativeSessionReadiness }) {
  const navigate = useNavigate();
  const createSession = useNativeSessions((state) => state.createSession);
  const openSession = useNativeSessions((state) => state.openSession);
  const loadNativeSessions = useNativeSessions((state) => state.load);
  const startStructuredSession = useSessionStore((state) => state.startStructuredSession);
  const sessions = useNativeSessions((state) => state.sessions);
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState<NativeSessionPurpose>('analysis');
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [refreshingExisting, setRefreshingExisting] = useState(false);
  const purposeMap = readiness?.purposes ?? (readiness as unknown as Record<NativeSessionPurpose, NativeSessionReadiness['purposes'][NativeSessionPurpose]> | undefined);
  const purposeReadiness = purposeMap?.[purpose];
  const available = Boolean(purposeReadiness?.available);
  // Do not render a cached detached row as reopenable while the authoritative
  // BFF list is being refreshed. This is a one-shot popover-open check, not a
  // poll; an idle TTL must be able to remove the action immediately.
  const existing = refreshingExisting
    ? []
    : sessions.filter((session) => session.purpose === purpose && (session.status === 'running' || session.status === 'detached'));
  const create = async () => {
    const reason = !live
      ? 'Native terminal sessions require a local BFF connection.'
      : readiness === undefined
        ? 'Checking native terminal availability.'
        : purposeReadiness?.reason;
    if (reason) { setError(reason); return; }
    setCreating(true); setError(undefined);
    try {
      const session = await createSession(purpose, undefined, 'sessions-new');
      setOpen(false); navigate(`/sessions/${session.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'A native session could not be started.');
    } finally { setCreating(false); }
  };
  const openExisting = async (id: string) => {
    if (!live) { setError('Native terminal sessions require a local BFF connection.'); return; }
    setCreating(true); setError(undefined);
    try {
      const session = await openSession(purpose, id);
      setOpen(false); navigate(`/sessions/${session.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The selected native session could not be opened.');
    } finally { setCreating(false); }
  };
  const startStructuredAsk = async () => {
    setCreating(true); setError(undefined);
    try {
      const id = await startStructuredSession();
      setOpen(false); navigate(structuredAskPath(id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'A Structured Ask session could not be created.');
    } finally { setCreating(false); }
  };
  const content = <div className="sessions-new-menu" aria-label="New session options">
    <Typography.Text strong>New session</Typography.Text>
    <section aria-label="Structured Ask session">
      <Typography.Text strong>Structured Ask</Typography.Text>
      <Typography.Paragraph type="secondary">Chart-first answers, dashboards, and follow-up questions.</Typography.Paragraph>
      <Button type="primary" loading={creating} onClick={() => void startStructuredAsk()}>Start Structured Ask</Button>
    </section>
    <section aria-label="Native terminal session">
      <Typography.Text strong>Native terminal</Typography.Text>
      <Typography.Paragraph type="secondary">Open a running terminal or start a separate CLI session for analysis or context enrichment.</Typography.Paragraph>
      <Radio.Group name="native-session-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} aria-label="Native terminal purpose">
        <Space orientation="vertical">
          {newSessionPurposes.map((item) => <Radio key={item} value={item}>{purposeLabels[item]}</Radio>)}
        </Space>
      </Radio.Group>
      <Typography.Text type="secondary">Runtime target: {purposeReadiness?.targetLabel ?? 'not configured'} · {purposeReadiness?.profile ?? 'no dispatch profile'}</Typography.Text>
      {purposeReadiness?.reason ? <Typography.Text type="secondary">{purposeReadiness.reason}</Typography.Text> : null}
      {existing.length ? <section className="sessions-new-existing" aria-label="Open existing native sessions">
        <Typography.Text strong>Open existing</Typography.Text>
        {existing.map((session) => {
          const label = `Open existing ${purposeLabels[session.purpose]} session ${session.id.slice(-8)}`;
          return <Button key={session.id} aria-label={label} title={label} loading={creating} onClick={() => void openExisting(session.id)}>{label}</Button>;
        })}
      </section> : null}
      {error ? <Typography.Text type="danger" role="alert">{error}</Typography.Text> : null}
      <Button type="primary" disabled={!available} onClick={() => void create()} loading={creating}>Start separate native terminal</Button>
    </section>
  </div>;
  return <Popover content={content} overlayClassName="sessions-new-popover" trigger="click" open={open} onOpenChange={(next) => {
    setOpen(next);
    if (!next) { setError(undefined); setRefreshingExisting(false); return; }
    setRefreshingExisting(true);
    void loadNativeSessions().finally(() => setRefreshingExisting(false));
  }} placement="bottomLeft">
    <Button block icon={<PlusOutlined />}>New session</Button>
  </Popover>;
}

/** Running sessions precede recent history so the contextual list stays useful. */
export function SessionsSidebar() {
  const navigate = useNavigate();
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const sessions = useNativeSessions((state) => state.sessions);
  const load = useNativeSessions((state) => state.load);
  const loading = useNativeSessions((state) => state.loading);
  const error = useNativeSessions((state) => state.error);
  const readiness = useNativeSessions((state) => state.readiness);
  const readinessLoading = useNativeSessions((state) => state.readinessLoading);
  const readinessError = useNativeSessions((state) => state.readinessError);
  const refreshReadiness = useNativeSessions((state) => state.refreshReadiness);
  const structuredSessions = useSessionStore((state) => state.sessionList);
  const structuredSessionData = useSessionStore((state) => state.sessionsById);
  const loadStructuredSessions = useSessionStore((state) => state.loadSessions);
  const live = isBffEnabled();
  useEffect(() => { if (live) void load(); }, [live, load]);
  useEffect(() => { if (live) loadStructuredSessions(); }, [live, loadStructuredSessions]);
  useEffect(() => {
    if (live) void refreshReadiness();
  }, [live, refreshReadiness]);
  const running = sessions.filter((item) => item.status === 'running' || item.status === 'detached' || item.status === 'creating');
  const readinessPurposeMap = readiness?.purposes ?? (readiness as unknown as Record<NativeSessionPurpose, NativeSessionReadiness['purposes'][NativeSessionPurpose]> | undefined);
  const selectedRuntime = readiness?.runtimeHost?.selectedReadiness;
  const recent = sessions.filter((item) => !running.includes(item));
  const structured = live
    ? structuredSessions
    : Object.values(structuredSessionData).filter((session) => session.id !== 'draft').map((session) => ({ id: session.id, title: session.title, updatedAt: session.updatedAt }));
  const activeId = sessionId ?? id;
  const structuredList = structured.length ? <section className="sessions-sidebar-group" aria-label="Structured Ask sessions">
    <Typography.Text type="secondary" className="sessions-sidebar-heading">Structured Ask</Typography.Text>
    {structured.map((session) => <button type="button" key={session.id} onClick={() => navigate(structuredAskPath(session.id))} aria-current={session.id === activeId ? 'page' : undefined} className={`sessions-sidebar-item ${session.id === activeId ? 'is-selected' : ''}`}>
      <span className="sessions-sidebar-title sessions-sidebar-title-row">
        <span className="sessions-sidebar-purpose" title={session.title}>{session.title}</span>
        <span className="sessions-sidebar-id" title={session.id} aria-label={`Session ID ${session.id}`}>{session.id.slice(-8)}</span>
      </span>
      <span className="sessions-sidebar-meta"><span>{relativeActivity(session.updatedAt)}</span></span>
    </button>)}
  </section> : null;
  const list = (title: string, items: typeof sessions) => <section className="sessions-sidebar-group" aria-label={title}>
    <Typography.Text type="secondary" className="sessions-sidebar-heading">{title}</Typography.Text>
    {items.map((session) => <button type="button" key={session.id} onClick={() => navigate(`/sessions/${session.id}`)} aria-current={session.id === activeId ? 'page' : undefined} className={`sessions-sidebar-item ${session.id === activeId ? 'is-selected' : ''}`}>
      <span className="sessions-sidebar-title sessions-sidebar-title-row">
        <span className="sessions-sidebar-purpose">{purposeLabels[session.purpose]}</span>
        <span className="sessions-sidebar-id" title={session.id} aria-label={`Session ID ${session.id}`}>{session.id.slice(-8)}</span>
      </span>
      <span className="sessions-sidebar-meta">
        <span>Native terminal</span><span>{vendorLabels[session.vendor]}</span><span>{statusLabels[session.status]}</span><span>{relativeActivity(session.updatedAt)}</span>
      </span>
    </button>)}
  </section>;
  return <nav className="sessions-sidebar" aria-label="Sessions">
    <div className="sessions-sidebar-new"><NewSessionControl live={live} readiness={readiness} /></div>
    {!live ? <div className="sessions-sidebar-state" role="status">Native terminal sessions require a local BFF connection.</div> : null}
    {live && readinessError ? <div className="sessions-sidebar-state" role="alert">Native host is unavailable. {readinessError}</div> : null}
    {live && readinessLoading && !readiness && !readinessError ? <div className="sessions-sidebar-state" role="status">Checking native terminal availability…</div> : null}
    {live && selectedRuntime && selectedRuntime.state !== 'ready' ? <div className="sessions-sidebar-state" role="status">Runtime host: {selectedRuntime.message}</div> : null}
    {live && readinessPurposeMap && !newSessionPurposes.some((purpose) => readinessPurposeMap[purpose]?.available) ? <div className="sessions-sidebar-state" role="alert">No native terminal target is available on this host. Structured Ask remains available.</div> : null}
    {live && error ? <div className="sessions-sidebar-state" role="alert">Sessions are unavailable. {error}</div> : null}
    {structuredList}
    {live && !error && !loading && sessions.length === 0 ? <div className="sessions-sidebar-state">No native sessions yet. Start a native terminal session or a Structured Ask.</div> : null}
    {running.length ? list('Running', running) : null}
    {recent.length ? list('Recent', recent) : null}
  </nav>;
}
