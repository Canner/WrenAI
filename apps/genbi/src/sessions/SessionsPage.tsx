import { Alert, Button, Spin, Tag } from 'antd';
import { ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getNativeSetupRecovery, stopNativeSession, type NativeSession, type NativeSetupRecovery } from '@/bff/client';
import { isBffEnabled } from '@/bff/env';
import { clearNativeSessionCapability, clearNativeSessionReturnSource, clearNativeSetupRecoveryCapability, nativeSessionCapability, nativeSessionReturnSource, nativeSetupRecoveryCapability } from './capability';
import { NativeTerminal } from './NativeTerminal';
import { deadNativeSessionActions } from './lifecycle';
import { purposeLabels, statusLabels, targetLabels } from './sessionLabels';
import { useNativeSessions } from './useNativeSessions';
import './sessions.css';

function terminalEligible(session: NativeSession): boolean { return session.status === 'running' || session.status === 'detached'; }

function useCompactSessionsLayout(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 640);
  useEffect(() => {
    const update = () => setCompact(window.innerWidth <= 640);
    window.addEventListener('resize', update);
    update();
    return () => window.removeEventListener('resize', update);
  }, []);
  return compact;
}

function EmptyWorkbench() {
  return <main className="sessions-empty" aria-labelledby="sessions-empty-title">
    <h1 id="sessions-empty-title">Sessions</h1>
    <p>Open an existing session or start a separate native agent session from the sidebar.</p>
  </main>;
}

export function SessionsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sessions = useNativeSessions((state) => state.sessions);
  const loading = useNativeSessions((state) => state.loading);
  const unavailable = useNativeSessions((state) => state.error);
  const load = useNativeSessions((state) => state.load);
  const refresh = useNativeSessions((state) => state.refresh);
  const replace = useNativeSessions((state) => state.replace);
  const actOnSetupRecovery = useNativeSessions((state) => state.actOnSetupRecovery);
  const resumeSession = useNativeSessions((state) => state.resumeSession);
  const restartSession = useNativeSessions((state) => state.restartSession);
  const session = sessions.find((item) => item.id === id);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [terminalDisconnected, setTerminalDisconnected] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string>();
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string>();
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string>();
  const [recovery, setRecovery] = useState<NativeSetupRecovery>();
  const [recoveryError, setRecoveryError] = useState<string>();
  const [recovering, setRecovering] = useState(false);
  const compact = useCompactSessionsLayout();

  const live = isBffEnabled();
  useEffect(() => { if (live && id && !session) void refresh(id); }, [live, id, session, refresh]);
  useEffect(() => { setTerminalDisconnected(false); setReconnecting(false); }, [id]);
  useEffect(() => {
    if (session?.purpose === 'setup' && session.status === 'stopped') clearNativeSetupRecoveryCapability(session.id);
  }, [session]);
  useEffect(() => {
    if (session && !terminalEligible(session)) clearNativeSessionCapability(session.id);
  }, [session]);
  useEffect(() => {
    if (!live || !session || session.purpose !== 'setup') { setRecovery(undefined); return; }
    let active = true;
    void getNativeSetupRecovery(session.id)
      .then(({ recovery: current }) => { if (active) setRecovery(current); })
      .catch(() => { if (active) setRecovery(undefined); });
    return () => { active = false; };
  }, [live, session]);
  const onExit = useCallback((exitCode: number) => {
    setReconnecting(false);
    if (!session) return;
    replace({ ...session, status: 'exited', exitCode, endedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }, [replace, session]);
  const onConnected = useCallback(() => { setTerminalDisconnected(false); setReconnecting(false); }, []);
  const onConnectionLost = useCallback(() => {
    setTerminalDisconnected(true);
    // Keep a user-initiated reconnect locked until its one authoritative
    // lifecycle read settles. Browsers often emit both error and close for a
    // failed WebSocket; `refresh` coalesces those callbacks, and clearing the
    // lock early would briefly revive a stale Detached + Reconnect action.
    if (id) void refresh(id).finally(() => setReconnecting(false));
    else setReconnecting(false);
  }, [id, refresh]);
  if (!id) return <EmptyWorkbench />;
  if (!live) return <main className="sessions-empty"><Alert type="info" title="Sessions require a local BFF connection" description="Connect this browser to a local GenBI BFF to create or attach native sessions." /></main>;
  if (unavailable) return <main className="sessions-empty"><Alert type="error" title="Sessions are unavailable" description={unavailable} action={<Button onClick={() => void load()}>Retry</Button>} /></main>;
  if (!session) return <main className="sessions-empty">{loading ? <Spin tip="Loading session…" /> : <Alert type="warning" title="Session not found" description="This session may have been removed or is unavailable." action={<Button onClick={() => navigate('/sessions')}>Back to Sessions</Button>} />}</main>;

  const capability = nativeSessionCapability(session.id);
  const returnSource = nativeSessionReturnSource(session.id);
  const canReconnect = terminalEligible(session) && Boolean(capability);
  const deadActions = deadNativeSessionActions(session);
  const resumeAction = deadActions.find((action) => action.kind === 'resume');
  const restartAction = deadActions.find((action) => action.kind === 'restart');
  const stop = async () => {
    if (!capability) return;
    setStopping(true); setStopError(undefined);
    try {
      await stopNativeSession(session.id, capability);
      clearNativeSessionCapability(session.id);
      clearNativeSetupRecoveryCapability(session.id);
      await refresh(session.id);
    } catch (reason) {
      setStopError(reason instanceof Error ? reason.message : 'The native session could not be stopped.');
    }
    finally { setStopping(false); }
  };
  const status = statusLabels[session.status];
  const returnToSource = () => {
    if (!returnSource) return;
    clearNativeSessionReturnSource(session.id);
    navigate(returnSource === 'setup' ? '/setup' : '/context', { state: { nativeSessionReturn: returnSource } });
  };
  const performRecovery = async (action: 'retry' | 'continue' | 'stop', expectedVersion: number) => {
    const recoveryCapability = nativeSetupRecoveryCapability(session.id);
    if (!recoveryCapability) {
      setRecoveryError('Recovery action capability is unavailable in this browser session. Open the original browser session to act.');
      return;
    }
    setRecovering(true); setRecoveryError(undefined);
    try {
      const next = await actOnSetupRecovery(session.id, recoveryCapability, expectedVersion, action);
      if (next) navigate(`/sessions/${next.id}`, { replace: true });
      else await refresh(session.id);
    } catch (reason) {
      setRecoveryError(reason instanceof Error ? reason.message : 'Native Setup recovery action could not be completed.');
      const latest = await getNativeSetupRecovery(session.id).then(({ recovery: current }) => current).catch(() => undefined);
      setRecovery(latest);
    } finally { setRecovering(false); }
  };
  const restart = async () => {
    if (!restartAction) return;
    setRestarting(true); setRestartError(undefined);
    try {
      const next = await restartSession(session, returnSource);
      clearNativeSessionCapability(session.id);
      clearNativeSetupRecoveryCapability(session.id);
      navigate(`/sessions/${next.id}`, { replace: true });
    } catch (reason) {
      setRestartError(reason instanceof Error ? reason.message : 'A new native session could not be started.');
    } finally { setRestarting(false); }
  };
  const resume = async () => {
    if (!resumeAction) return;
    setResuming(true); setResumeError(undefined);
    try {
      const next = await resumeSession(session, returnSource);
      clearNativeSessionCapability(session.id);
      clearNativeSetupRecoveryCapability(session.id);
      navigate(`/sessions/${next.id}`, { replace: true });
    } catch (reason) {
      setResumeError(reason instanceof Error ? reason.message : 'The retained conversation could not be resumed.');
    } finally { setResuming(false); }
  };
  const showTerminal = terminalEligible(session) && Boolean(capability) && !terminalDisconnected;
  const recoveryCanAct = session.status !== 'stopped' && !terminalEligible(session);
  const recoveryCanRetryWithoutReport = session.purpose === 'setup' && session.status === 'failed' && !recovery;
  return <main className={`sessions-workbench${compact ? ' is-compact' : ''}`} data-testid="sessions-workbench">
    <header className="sessions-toolbar">
      <div className="sessions-toolbar-title"><strong>{purposeLabels[session.purpose]}</strong><span>{session.dispatchProfile ?? session.agent} · {session.dispatchTarget ? targetLabels[session.vendor] : session.vendor}</span></div>
      <Tag variant="filled" color={session.status === 'running' ? 'processing' : session.status === 'failed' || session.status === 'stale' ? 'error' : 'default'}>{status}</Tag>
      <div className="sessions-toolbar-actions">
        {canReconnect ? <Button size="small" icon={<ReloadOutlined />} loading={reconnecting} disabled={reconnecting} onClick={() => { setReconnecting(true); setTerminalDisconnected(false); setReconnectNonce((value) => value + 1); }}>Reconnect</Button> : null}
        {session.status === 'running' || session.status === 'detached' ? <Button size="small" danger icon={<StopOutlined />} loading={stopping} onClick={() => void stop()}>Stop</Button> : null}
        {resumeAction ? <Button size="small" loading={resuming} disabled={restarting} onClick={() => void resume()}>{resumeAction.label}</Button> : null}
        {restartAction ? <Button size="small" loading={restarting} disabled={resuming} onClick={() => void restart()}>{restartAction.label}</Button> : null}
        {returnSource ? <Button size="small" onClick={returnToSource}>Return to {returnSource === 'setup' ? 'Setup' : 'Context'}</Button> : null}
      </div>
      {stopError ? <span className="sessions-toolbar-error" role="alert">Unable to stop this session. {stopError} Reconnect and try again.</span> : null}
      {restartError ? <span className="sessions-toolbar-error" role="alert">Unable to restart this session. {restartError}</span> : null}
      {resumeError ? <span className="sessions-toolbar-error" role="alert">Unable to resume this conversation. {resumeError} Restart remains available.</span> : null}
      {recovery || recoveryCanRetryWithoutReport ? <section className="sessions-recovery" aria-label="Setup recovery" aria-live="polite">
        {recovery ? <><strong>Setup recovery: {recovery.state.replaceAll('_', ' ')}</strong>
        <span>{recovery.phase} · update {recovery.sequence}</span>
        {recovery.state === 'reported_complete' ? <span>{recovery.completionValidated ? 'Canonical Setup artifacts validated.' : 'Completion was reported, but canonical Setup artifacts are not yet valid.'}</span> : null}</> : <><strong>Setup recovery: launch failed</strong><span>No producer recovery update was received.</span></>}
        {recoveryCanRetryWithoutReport ? <Button size="small" loading={recovering} onClick={() => void performRecovery('retry', 0)}>Retry in a new session</Button> : null}
        {recoveryCanAct && recovery?.state === 'retryable_failure' ? <Button size="small" loading={recovering} onClick={() => void performRecovery('retry', recovery.version)}>Retry in a new session</Button> : null}
        {recoveryCanAct && (recovery?.state === 'needs_input' || recovery?.state === 'needs_decision') ? <Button size="small" loading={recovering} onClick={() => void performRecovery('continue', recovery.version)}>Continue in a new session</Button> : null}
        {recoveryCanAct && recovery?.state === 'needs_decision' ? <Button size="small" danger loading={recovering} onClick={() => void performRecovery('stop', recovery.version)}>Stop</Button> : null}
        {recoveryError ? <span className="sessions-toolbar-error" role="alert">Recovery action failed. {recoveryError}</span> : null}
      </section> : null}
    </header>
    {showTerminal ? <NativeTerminal sessionId={session.id} reconnectNonce={reconnectNonce} onExit={onExit} onConnected={onConnected} onConnectionLost={onConnectionLost} /> : <section className="sessions-terminal-state" aria-live="polite">
      <Alert
        type={session.status === 'failed' || session.status === 'stale' || session.status === 'interrupted' ? 'error' : 'info'}
        title={terminalEligible(session) && !capability ? 'Terminal capability unavailable in this browser session' : `Session ${status.toLowerCase()}`}
        description={restartAction ? `${session.failure ? `${session.failure} ` : ''}${resumeAction ? `${resumeAction.reason} ${restartAction.reason}` : restartAction.reason}` : session.failure ?? (terminalEligible(session) && !capability ? 'Open or create this session in the browser session that owns it, then reconnect. Capabilities are never stored by the server.' : 'This native terminal is not available for attachment.')}
      />
    </section>}
  </main>;
}
