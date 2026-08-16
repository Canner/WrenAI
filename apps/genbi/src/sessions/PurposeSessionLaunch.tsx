import { Button, Space, Typography } from 'antd';
import { CodeOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NativeSessionPurpose, NativeSessionReadiness } from '@/bff/client';
import { isBffEnabled } from '@/bff/env';
import { useNativeSessions } from './useNativeSessions';
import type { NativeSessionReturnSource } from './capability';

interface PurposeSessionLaunchProps {
  purpose: NativeSessionPurpose;
  title: string;
  lead: string;
  returnSource: NativeSessionReturnSource;
}

/** A feature entry can select a purpose, but only Sessions owns terminal transport and lifecycle. */
export function PurposeSessionLaunch({ purpose, title, lead, returnSource }: PurposeSessionLaunchProps) {
  const navigate = useNavigate();
  const createSession = useNativeSessions((state) => state.createSession);
  const readiness = useNativeSessions((state) => state.readiness);
  const readinessLoading = useNativeSessions((state) => state.readinessLoading);
  const readinessError = useNativeSessions((state) => state.readinessError);
  const refreshReadiness = useNativeSessions((state) => state.refreshReadiness);
  const live = isBffEnabled();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  // Older BFFs may return the pre-registry flat shape during a rolling local
  // upgrade; it cannot submit a vendor and is display-only until refreshed.
  const available = readiness?.purposes?.[purpose] ?? (readiness as unknown as Record<NativeSessionPurpose, NativeSessionReadiness['purposes'][NativeSessionPurpose]> | undefined)?.[purpose];

  useEffect(() => {
    if (live) void refreshReadiness();
  }, [live, refreshReadiness]);

  const open = async () => {
    if (!available?.available) return;
    setLoading(true); setError(undefined);
    try {
      const session = await createSession(purpose, returnSource, returnSource);
      navigate(`/sessions/${session.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'A native session could not be started.');
    } finally { setLoading(false); }
  };

  return <section aria-label={`${title} native session`}>
    <Typography.Title level={4}>{title}</Typography.Title>
    <Typography.Paragraph>{lead}</Typography.Paragraph>
    {!live ? <Typography.Text type="secondary">A local BFF connection is required to start a native session.</Typography.Text> : null}
    {live && readinessLoading && !readiness && !error ? <Typography.Text type="secondary">Checking native session availability…</Typography.Text> : null}
    {available?.reason ? <Typography.Text type="secondary">{available.reason}</Typography.Text> : null}
    {error || readinessError ? <Typography.Text type="danger" role="alert">{error ?? readinessError}</Typography.Text> : null}
    <Space style={{ display: 'flex', marginTop: 12 }} wrap>
      <Button aria-label={`Start separate ${available?.targetLabel ?? 'interactive CLI'} session`} type="primary" icon={<CodeOutlined />} loading={loading}
        disabled={!live || !available?.available} onClick={() => void open()}>
        Start separate {available?.targetLabel ?? 'interactive CLI'} session · {available?.profile ?? 'runtime binding required'}
      </Button>
    </Space>
  </section>;
}
