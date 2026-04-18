import { ReactNode, useEffect, useMemo, useRef } from 'react';
import { Skeleton, Typography } from 'antd';
import styled from 'styled-components';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { getReferenceDisplayThreadTitle } from '@/utils/referenceDemoKnowledge';
import DolaAppShell, {
  DolaShellBackAction,
  DolaShellNavItem,
} from './DolaAppShell';
import { usePersistentShellEmbedded } from './PersistentShellContext';
import { buildNovaShellNavItems, NovaShellNavKey } from './novaShellNavigation';

const { Paragraph, Title } = Typography;

export interface ConsoleSectionItem {
  key: string;
  label: string;
  onClick: () => void;
}

interface Props {
  activeNav?: NovaShellNavKey;
  title: ReactNode;
  description?: ReactNode;
  titleExtra?: ReactNode;
  eyebrow?: ReactNode;
  hideHeader?: boolean;
  contentBorderless?: boolean;
  loading?: boolean;
  children?: ReactNode;
  sections?: ConsoleSectionItem[];
  activeSectionKey?: string;
  navItems?: DolaShellNavItem[];
  activeHistoryId?: string | null;
  hideHistorySection?: boolean;
  sidebarBackAction?: DolaShellBackAction;
}

export const shouldRefetchConsoleHistory = ({
  activeHistoryId,
  embedded,
  threadIds,
  attemptedHistoryId,
}: {
  activeHistoryId?: string | null;
  embedded: boolean;
  threadIds: string[];
  attemptedHistoryId?: string | null;
}) => {
  if (!activeHistoryId || embedded) {
    return false;
  }

  if (threadIds.includes(activeHistoryId)) {
    return false;
  }

  if (attemptedHistoryId === activeHistoryId) {
    return false;
  }

  return true;
};

const PageRoot = styled.div`
  min-height: calc(100vh - 48px);
  padding: 0;
  background: transparent;
`;

const ShellStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const SegmentSurface = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px;
  border-radius: 20px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px);
`;

const SegmentButton = styled.button<{ $active?: boolean }>`
  height: 38px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: ${(props) => (props.$active ? '#fff' : 'transparent')};
  color: ${(props) =>
    props.$active ? 'var(--nova-primary)' : 'var(--nova-text-secondary)'};
  font-weight: ${(props) => (props.$active ? 600 : 500)};
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: ${(props) =>
    props.$active ? '0 2px 8px rgba(31, 35, 50, 0.06)' : 'none'};

  &:hover {
    color: var(--nova-primary-strong);
  }
`;

const HeaderCard = styled.div`
  position: relative;
  border-radius: 16px;
  border: 1px solid var(--nova-outline-soft);
  background: #fff;
  padding: 24px 28px;
`;

const HeaderRow = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
`;

const HeaderBody = styled.div`
  min-width: 0;
  max-width: 880px;
`;

const Eyebrow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(141, 101, 225, 0.08);
  color: var(--nova-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
`;

const ContentStage = styled.div<{ $borderless?: boolean }>`
  border-radius: ${(props) => (props.$borderless ? '0' : '16px')};
  border: ${(props) =>
    props.$borderless ? '0' : '1px solid var(--nova-outline-soft)'};
  background: ${(props) => (props.$borderless ? 'transparent' : '#fff')};
  padding: ${(props) => (props.$borderless ? '0' : '24px')};
  width: 100%;

  .console-grid {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 16px;
  }

  .console-panel {
    border-radius: var(--nova-radius-card);
    border: 1px solid var(--nova-outline-soft);
    background: rgba(255, 255, 255, 0.96);
    box-shadow: var(--nova-shadow-soft);
    padding: 20px 22px;
  }

  .console-panel + .console-panel {
    margin-top: 16px;
  }

  .console-panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }

  .console-panel-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--nova-text-primary);
  }

  .console-panel-subtitle {
    margin-top: 6px;
    font-size: 13px;
    color: var(--nova-text-secondary);
  }

  .console-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 14px;
  }

  .console-metric {
    border-radius: 22px;
    border: 1px solid var(--nova-outline-soft);
    background: linear-gradient(
      180deg,
      rgba(233, 238, 255, 0.96) 0%,
      rgba(255, 255, 255, 0.98) 100%
    );
    padding: 18px 18px 16px;
    min-height: 112px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
  }

  .console-metric-label {
    display: block;
    font-size: 12px;
    color: var(--nova-text-muted);
    margin-bottom: 8px;
  }

  .console-metric-value {
    display: block;
    font-size: 24px;
    line-height: 1.15;
    font-weight: 700;
    color: var(--nova-text-primary);
    margin-bottom: 6px;
  }

  .console-metric-meta {
    font-size: 13px;
    color: var(--nova-text-secondary);
  }

  .console-table.ant-table-wrapper {
    margin-top: 4px;
  }

  .console-table .ant-table {
    background: transparent;
  }

  .console-table .ant-table-container {
    border-radius: 18px;
    overflow: hidden;
    border: 1px solid var(--nova-outline-soft);
  }

  .console-table .ant-table-thead > tr > th {
    background: var(--nova-surface-soft);
    color: var(--nova-text-secondary);
    font-weight: 600;
    border-bottom: 1px solid var(--nova-outline-soft);
  }

  .console-table .ant-table-tbody > tr > td {
    background: rgba(255, 255, 255, 0.88);
    border-bottom: 1px solid var(--nova-outline-soft);
  }

  .console-table .ant-table-tbody > tr:hover > td {
    background: #fcfdff;
  }

  .console-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

  .console-alert.ant-alert {
    border-radius: 18px;
    border: 1px solid rgba(250, 173, 20, 0.24);
    background: #fffaf0;
  }
`;

export default function ConsoleShellLayout({
  activeNav = 'knowledge',
  title,
  description,
  titleExtra,
  eyebrow = '工作台',
  hideHeader,
  contentBorderless,
  loading,
  children,
  sections,
  activeSectionKey,
  navItems,
  activeHistoryId,
  hideHistorySection,
  sidebarBackAction,
}: Props) {
  const embedded = usePersistentShellEmbedded();
  const homeSidebar = useHomeSidebar({
    deferInitialLoad: false,
    loadOnIntent: false,
    disabled: embedded,
  });
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const attemptedActiveHistoryRefetchRef = useRef<string | null>(null);

  const historyItems = useMemo(
    () =>
      (homeSidebar.data?.threads || []).map((thread) => ({
        id: thread.id,
        title: getReferenceDisplayThreadTitle(thread.name),
        active: activeHistoryId ? thread.id === activeHistoryId : false,
        selector: thread.selector,
      })),
    [activeHistoryId, homeSidebar.data?.threads],
  );

  useEffect(() => {
    const threadIds = (homeSidebar.data?.threads || []).map(
      (thread) => thread.id,
    );

    if (!activeHistoryId || embedded || threadIds.includes(activeHistoryId)) {
      attemptedActiveHistoryRefetchRef.current = activeHistoryId || null;
      return;
    }

    if (
      !shouldRefetchConsoleHistory({
        activeHistoryId,
        embedded,
        threadIds,
        attemptedHistoryId: attemptedActiveHistoryRefetchRef.current,
      })
    ) {
      return;
    }

    attemptedActiveHistoryRefetchRef.current = activeHistoryId;
    void homeSidebar.refetch();
  }, [activeHistoryId, embedded, homeSidebar]);

  const resolvedNavItems = useMemo<DolaShellNavItem[]>(
    () =>
      navItems ||
      buildNovaShellNavItems({
        activeKey: activeNav,
        onNavigate: runtimeScopeNavigation.pushWorkspace,
      }),
    [activeNav, navItems, runtimeScopeNavigation.pushWorkspace],
  );

  const content = (
    <PageRoot>
      <ShellStack>
        {sections?.length ? (
          <SegmentSurface>
            {sections.map((section) => (
              <SegmentButton
                key={section.key}
                type="button"
                $active={section.key === activeSectionKey}
                onClick={section.onClick}
              >
                {section.label}
              </SegmentButton>
            ))}
          </SegmentSurface>
        ) : null}

        {!hideHeader ? (
          <HeaderCard>
            <HeaderRow>
              <HeaderBody>
                {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
                <Title
                  level={2}
                  style={{
                    margin: `${eyebrow ? 16 : 0}px 0 8px`,
                    fontSize: 30,
                    lineHeight: 1.2,
                  }}
                >
                  {title}
                </Title>
                {description ? (
                  <Paragraph
                    style={{
                      marginBottom: 0,
                      maxWidth: 760,
                      fontSize: 15,
                      color: '#667085',
                    }}
                  >
                    {description}
                  </Paragraph>
                ) : null}
              </HeaderBody>
              {titleExtra ? (
                <div className="console-toolbar">{titleExtra}</div>
              ) : null}
            </HeaderRow>
          </HeaderCard>
        ) : null}

        <ContentStage $borderless={contentBorderless}>
          {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : children}
        </ContentStage>
      </ShellStack>
    </PageRoot>
  );

  if (embedded) {
    return content;
  }

  return (
    <DolaAppShell
      navItems={resolvedNavItems}
      historyItems={historyItems}
      historyLoading={homeSidebar.loading && historyItems.length === 0}
      onHistoryIntent={homeSidebar.ensureLoaded}
      hideHistorySection={hideHistorySection}
      sidebarBackAction={sidebarBackAction}
    >
      {content}
    </DolaAppShell>
  );
}
