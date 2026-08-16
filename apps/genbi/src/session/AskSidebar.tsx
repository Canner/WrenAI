import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { SidebarList } from '@/app/shell/SidebarList';
import { fixtureSessions } from '@/fixtures';
import type { SidebarItem } from '@/fixtures';
import { isBffEnabled } from '@/bff/env';
import { t } from '@/i18n/strings';
import { useSessionStore } from './useSessionStore';
import { structuredAskPath } from '@/sessions/structuredAsk';
import type { SessionSummary } from '@/bff/client';

function toSidebarItem(session: SessionSummary): SidebarItem {
  return { key: session.id, label: session.title, meta: session.updatedAt };
}

/**
 * Ask's contextual sidebar: a "New session" action, then the generic
 * `SidebarList`, wired so clicking a session navigates to the Sessions-owned
 * Structured Ask route
 * and the current route drives which item is highlighted (instead of
 * `SidebarList`'s local-only selection).
 *
 * Live mode lists real, persisted sessions from the BFF (`sessionList`,
 * refreshed on mount and again whenever a draft's first ask creates one);
 * fixture mode keeps the static `fixtureSessions` list, unchanged.
 */
export function AskSidebar() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const live = isBffEnabled();

  const sessionList = useSessionStore((s) => s.sessionList);
  const loadSessions = useSessionStore((s) => s.loadSessions);

  useEffect(() => {
    if (live) loadSessions();
  }, [live, loadSessions]);

  const items = live ? sessionList.map(toSidebarItem) : fixtureSessions;
  const selectedKey = live ? sessionId : (sessionId ?? fixtureSessions[0]?.key);

  return (
    <div>
      <div style={{ padding: '12px 8px 4px' }}>
        <Button block icon={<PlusOutlined />} onClick={() => navigate(structuredAskPath())}>
          {t('ask.newSession')}
        </Button>
      </div>
      <SidebarList
        header={t('ask.sessionsHeader')}
        items={items}
        emptyHint={live ? t('ask.noSessions') : undefined}
        selectedKey={selectedKey}
        onSelect={(key) => navigate(structuredAskPath(key))}
      />
    </div>
  );
}
