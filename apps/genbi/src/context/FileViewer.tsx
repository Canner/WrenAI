import { useMemo } from 'react';
import { Button, Space } from 'antd';
import { ArrowLeftOutlined, ApartmentOutlined } from '@ant-design/icons';
import { Panel, PageState } from '@/ui';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import { isBffEnabled } from '@/bff/env';
import { EditDropdown } from './EditDropdown';
import { useContextStore } from './useContextStore';
import {
  blastRadiusByKey,
  contextFileByKey,
  fixtureKnowledgeStatus,
  fixtureProjectName,
  fixtureProjectPath,
} from './fixtures';
import type { ContextFileNode } from './types';

function flattenFileTree(nodes: ContextFileNode[], out: Record<string, ContextFileNode>) {
  for (const node of nodes) {
    out[node.key] = node;
    if (node.children) flattenFileTree(node.children, out);
  }
}

/**
 * Read-only viewer for a file selected in the contextual sidebar's tree. Shows
 * raw content in a monospace `<pre>` — no in-app editing (that stays out of
 * scope; see the Edit dropdown for external-IDE / CLI hand-off). Live mode
 * looks up the selected file in the fetched `wren_project` tree (flattened the
 * same way as the fixture's `contextFileByKey`); per-file blast radius isn't
 * eagerly fetched live, so "View impact" and the Edit dropdown fall back to an
 * empty downstream list — `buildEditPrompt` degrades that to "none known".
 */
export function FileViewer() {
  const selectedFileKey = useContextStore((s) => s.selectedFileKey);
  const showOverview = useContextStore((s) => s.showOverview);
  const showImpact = useContextStore((s) => s.showImpact);
  const liveFiles = useContextStore((s) => s.liveFiles);
  const filesLoading = useContextStore((s) => s.filesLoading);
  const filesError = useContextStore((s) => s.filesError);
  const loadFiles = useContextStore((s) => s.loadFiles);
  const liveOverview = useContextStore((s) => s.liveOverview);

  const live = isBffEnabled();

  const liveFileByKey = useMemo(() => {
    if (!liveFiles) return undefined;
    const out: Record<string, ContextFileNode> = {};
    flattenFileTree(liveFiles, out);
    return out;
  }, [liveFiles]);

  if (live && filesLoading && !liveFiles) {
    return <PageState status="loading" />;
  }
  if (live && filesError && !liveFiles) {
    return (
      <PageState
        status="error"
        title={t('context.filesErrorTitle')}
        description={filesError}
        onRetry={loadFiles}
      />
    );
  }

  const file = selectedFileKey
    ? live
      ? liveFileByKey?.[selectedFileKey]
      : contextFileByKey[selectedFileKey]
    : undefined;

  if (!file || !file.content) {
    return (
      <PageState
        status="empty"
        title={t('context.fileEmptyTitle')}
        description={t('context.fileEmptyDescription')}
      />
    );
  }

  const blastRadius = !live && file.entityKey ? blastRadiusByKey[file.entityKey] : undefined;
  const verifiedPairCount = live
    ? (liveOverview?.knowledge.verifiedPairCount ?? 0)
    : fixtureKnowledgeStatus.verifiedPairCount;

  return (
    <Panel
      title={file.title}
      extra={
        <Space>
          {(blastRadius || (live && file.entityKey)) && (
            <Button
              icon={<ApartmentOutlined />}
              onClick={() => showImpact(file.entityKey!)}
            >
              {t('context.viewImpact')}
            </Button>
          )}
          {file.path && (
            <EditDropdown
              filePath={file.path}
              projectPath={live ? (liveOverview?.projectPath ?? '') : fixtureProjectPath}
              projectName={live ? (liveOverview?.projectName ?? fixtureProjectName) : fixtureProjectName}
              downstream={blastRadius?.downstream ?? []}
              verifiedPairCount={verifiedPairCount}
            />
          )}
        </Space>
      }
    >
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        onClick={showOverview}
        style={{ paddingLeft: 0, marginBottom: 8 }}
      >
        {t('context.backToOverview')}
      </Button>
      <pre
        style={{
          fontFamily: brand.fontFamilyCode,
          fontSize: 13,
          lineHeight: 1.5,
          background: 'var(--ant-color-fill-secondary)',
          borderRadius: 8,
          padding: 16,
          overflow: 'auto',
          margin: 0,
          // Knowledge files are markdown prose — wrap long lines instead of
          // forcing horizontal scroll. YAML files keep `pre` (no wrap): their
          // indentation is significant, so they scroll instead.
          whiteSpace: file.kind === 'knowledge' ? 'pre-wrap' : 'pre',
          wordBreak: file.kind === 'knowledge' ? 'break-word' : 'normal',
        }}
      >
        {file.content}
      </pre>
    </Panel>
  );
}
