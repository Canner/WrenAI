import { useEffect, useState, type ReactNode } from 'react';
import {
  TableOutlined,
  ApartmentOutlined,
  FunctionOutlined,
  BookOutlined,
  EyeOutlined,
  FolderOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { t } from '@/i18n/strings';
import { isBffEnabled } from '@/bff/env';
import { useContextStore } from './useContextStore';
import { fixtureContextFileTree } from './fixtures';
import type { ContextFileKind, ContextFileNode } from './types';
import './contextSidebar.css';

const KIND_ICON: Record<ContextFileKind, ReactNode> = {
  model: <TableOutlined />,
  relationship: <ApartmentOutlined />,
  cube: <FunctionOutlined />,
  knowledge: <BookOutlined />,
  view: <EyeOutlined />,
};

/** Every directory key in the tree, used to seed the "expand all" default. */
function collectDirKeys(nodes: ContextFileNode[], out: Set<string> = new Set()): Set<string> {
  for (const node of nodes) {
    if (node.children) {
      out.add(node.key);
      collectDirKeys(node.children, out);
    }
  }
  return out;
}

interface FileTreeRowsProps {
  nodes: ContextFileNode[];
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  selectedFileKey: string | undefined;
  onSelectFile: (key: string) => void;
}

/** Recursive rows for one level of the tree — directories toggle, files select. */
function FileTreeRows({
  nodes,
  depth,
  expanded,
  onToggle,
  selectedFileKey,
  onSelectFile,
}: FileTreeRowsProps) {
  return (
    <>
      {nodes.map((node) => {
        const indent = 12 + depth * 16;

        if (node.children) {
          const isExpanded = expanded.has(node.key);
          return (
            <li key={node.key} className="genbi-tdir">
              <button
                type="button"
                className="genbi-trow genbi-tdirhdr"
                style={{ paddingLeft: indent }}
                aria-expanded={isExpanded}
                onClick={() => onToggle(node.key)}
              >
                <span className={`genbi-chev${isExpanded ? ' is-open' : ''}`} aria-hidden="true">
                  <RightOutlined />
                </span>
                <span className="genbi-fi" aria-hidden="true">
                  <FolderOutlined />
                </span>
                <span className="genbi-tname">{node.title}</span>
              </button>
              {isExpanded && (
                <ul className="genbi-tchildren">
                  <FileTreeRows
                    nodes={node.children}
                    depth={depth + 1}
                    expanded={expanded}
                    onToggle={onToggle}
                    selectedFileKey={selectedFileKey}
                    onSelectFile={onSelectFile}
                  />
                </ul>
              )}
            </li>
          );
        }

        const selected = node.key === selectedFileKey;
        return (
          <li key={node.key}>
            <button
              type="button"
              className={`genbi-trow genbi-tfile${selected ? ' is-sel' : ''}`}
              style={{ paddingLeft: indent + 16 }}
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelectFile(node.key)}
            >
              <span className="genbi-fi" aria-hidden="true">
                {node.kind ? KIND_ICON[node.kind] : null}
              </span>
              <span className="genbi-tname">{node.title}</span>
            </button>
          </li>
        );
      })}
    </>
  );
}

/**
 * Context page's contextual sidebar: the `wren_project` file tree. Custom
 * built rather than AntD `Tree` — its node-title flex chain has no
 * `min-width: 0`, so a long filename wraps the type icon above a clipped
 * name instead of eliding on one line; see `contextSidebar.css` for the fix.
 * Selecting a leaf file shows its read-only content in the canvas via
 * `useContextStore.selectFile` — directories just expand/collapse and are
 * fully keyboard operable (native `<button>`s, `aria-expanded`/`aria-current`).
 */
export function ContextSidebar() {
  const selectedFileKey = useContextStore((s) => s.selectedFileKey);
  const selectFile = useContextStore((s) => s.selectFile);
  const liveFiles = useContextStore((s) => s.liveFiles);

  const live = isBffEnabled();
  const tree = live ? (liveFiles ?? []) : fixtureContextFileTree;
  // The fixture tree wraps everything under one `wren_project` root node; the
  // live DTO's top level is already the flat list of category folders (see
  // `getContextFiles`) — so only treat a single node as a wrapping root when
  // it actually has children. Only the fixture tree is ever wrapped — the live
  // DTO's top level is always the flat category list — so scope the unwrap to
  // fixture mode, never inferring "wrapped" from a live tree that happens to
  // have a single top-level category.
  const hasWrappingRoot = !live && tree.length === 1 && !!tree[0]?.children;
  const root = hasWrappingRoot ? tree[0] : undefined;
  const topNodes = root?.children ?? tree;

  const [expanded, setExpanded] = useState<Set<string>>(() => collectDirKeys(topNodes));

  // Live file tree arrives asynchronously after mount (see `ContextPage`'s
  // `loadFiles` effect) — re-seed the "expand all" default once it lands, so
  // directories aren't stuck collapsed from the initial (empty) render.
  useEffect(() => {
    if (live && liveFiles) {
      setExpanded(collectDirKeys(topNodes));
    }
  }, [live, liveFiles, topNodes]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <nav aria-label={t('context.filesHeader')} className="genbi-filetree">
      {root && (
        <div className="genbi-rail-proj">
          <FolderOutlined aria-hidden="true" />
          <span className="genbi-tname">{root.title}</span>
        </div>
      )}
      <ul className="genbi-ttree">
        <FileTreeRows
          nodes={topNodes}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          selectedFileKey={selectedFileKey}
          onSelectFile={selectFile}
        />
      </ul>
    </nav>
  );
}
