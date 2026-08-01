import { useState } from 'react';
import { Button, Dropdown, Modal, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { CodeOutlined, CopyOutlined, DownOutlined } from '@ant-design/icons';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import { buildEditPrompt } from './editPrompt';
import { joinProjectPath } from './paths';
import type { ImpactNode } from './types';

interface EditDropdownProps {
  /** Project-relative path of the file being edited (see `ContextFileNode.path`). */
  filePath: string;
  /** The project's absolute filesystem root, joined with `filePath` for the deep links/prompt. */
  projectPath: string;
  projectName: string;
  downstream: ImpactNode[];
  verifiedPairCount: number;
}

/**
 * The single Edit control for a file: VS Code / Cursor open a deep link
 * directly; Claude Code CLI opens a Modal with a copy-ready prompt (built by
 * the pure `buildEditPrompt`). All in-app editing stays out of scope — see
 * the "Not available yet" panel on the Context page.
 *
 * `filePath` is project-relative; it's joined with `projectPath` (the
 * project's absolute root) via `joinProjectPath` so the IDE deep links and
 * CLI prompt use an absolute path VS Code/Cursor can actually resolve.
 */
export function EditDropdown({ filePath, projectPath, projectName, downstream, verifiedPairCount }: EditDropdownProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const absoluteFilePath = joinProjectPath(projectPath, filePath);
  const prompt = buildEditPrompt({ filePath: absoluteFilePath, projectName, downstream, verifiedPairCount });

  const items: MenuProps['items'] = [
    {
      key: 'vscode',
      label: (
        // `absoluteFilePath` already starts with `/`, so `vscode://file` +
        // the path (no separator inserted here) gives the single-slash form
        // VS Code expects: `vscode://file/Users/...`, not `vscode://file//Users/...`.
        <a href={`vscode://file${absoluteFilePath}`} rel="noreferrer">
          {t('context.editInVsCode')}
        </a>
      ),
    },
    {
      key: 'cursor',
      label: (
        <a href={`cursor://file${absoluteFilePath}`} rel="noreferrer">
          {t('context.editInCursor')}
        </a>
      ),
    },
    {
      key: 'claude-cli',
      label: t('context.editWithClaudeCli'),
      onClick: () => setModalOpen(true),
    },
  ];

  const handleCopy = async () => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(prompt);
    }
    setCopied(true);
  };

  return (
    <>
      <Dropdown menu={{ items }} trigger={['click']}>
        <Button icon={<CodeOutlined />}>
          {t('context.edit')} <DownOutlined />
        </Button>
      </Dropdown>
      <Modal
        title={t('context.editModalTitle')}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setCopied(false);
        }}
        footer={
          <Button
            type="primary"
            icon={<CopyOutlined />}
            onClick={handleCopy}
          >
            {copied ? t('context.promptCopied') : t('context.copyPrompt')}
          </Button>
        }
      >
        <Typography.Paragraph type="secondary">
          {t('context.editModalDescription')}
        </Typography.Paragraph>
        <pre
          style={{
            fontFamily: brand.fontFamilyCode,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            background: 'var(--ant-color-fill-secondary)',
            borderRadius: 8,
            padding: 12,
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          {prompt}
        </pre>
      </Modal>
    </>
  );
}
