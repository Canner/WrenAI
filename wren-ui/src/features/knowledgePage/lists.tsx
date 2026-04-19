import { SqlPair, Instruction } from '@/types/knowledge';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from 'react';
import { Space } from 'antd';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';

import { resolveKnowledgeNavBadgeCount } from '@/hooks/useKnowledgePageHelpers';
import type { KnowledgeSidebarItem } from '@/hooks/useKnowledgeSidebarData';
import {
  isDemoKnowledgeSidebarEntry,
  resolveKnowledgeSidebarFallbackAssetCount,
  resolveRuleDraftDisplay,
} from '@/hooks/useKnowledgeRenderHelpers';
import {
  CountBadge,
  KbItem,
  KbItemMeta,
  KbItemName,
  LightButton,
  ManageEntryCard,
  ManageEntryDesc,
  ManageEntryMain,
  ManageEntryTitle,
} from './index.styles';
import { VirtualizedManageEntryList } from './virtualizedManageEntryList';
import type { KnowledgeBaseRecord } from './types';

type SwitchKnowledgeBaseHandler<TKnowledgeBase> = (
  knowledgeBase: TKnowledgeBase,
  targetUrl: string,
) => Promise<unknown> | unknown;

export type SidebarKnowledgeListProps = {
  visibleKnowledgeItems: KnowledgeSidebarItem<KnowledgeBaseRecord>[];
  visibleKnowledgeBaseId?: string | null;
  activeKnowledgeBaseId?: string | null;
  activeAssetCount: number;
  switchKnowledgeBase: SwitchKnowledgeBaseHandler<KnowledgeBaseRecord>;
  buildKnowledgeSwitchUrl: (knowledgeBase: KnowledgeBaseRecord) => string;
};

const SIDEBAR_KB_VIRTUALIZATION_THRESHOLD = 36;
const SIDEBAR_KB_ITEM_ESTIMATED_HEIGHT = 34;
const SIDEBAR_KB_VIRTUAL_OVERSCAN = 6;
const SIDEBAR_KB_ITEMS_CONTAINER_STYLE = {
  display: 'grid',
  gap: 3,
};
const areSidebarKnowledgeItemsEqual = (
  previous: KnowledgeSidebarItem<KnowledgeBaseRecord>[],
  next: KnowledgeSidebarItem<KnowledgeBaseRecord>[],
) => {
  if (previous === next) {
    return true;
  }

  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index += 1) {
    const prevItem = previous[index];
    const nextItem = next[index];
    if (
      prevItem.id !== nextItem.id ||
      prevItem.name !== nextItem.name ||
      prevItem.assetCount !== nextItem.assetCount ||
      prevItem.demo !== nextItem.demo ||
      prevItem.record?.id !== nextItem.record?.id
    ) {
      return false;
    }
  }

  return true;
};

const areSidebarKnowledgeListPropsEqual = (
  previous: SidebarKnowledgeListProps,
  next: SidebarKnowledgeListProps,
) =>
  previous.visibleKnowledgeBaseId === next.visibleKnowledgeBaseId &&
  previous.activeKnowledgeBaseId === next.activeKnowledgeBaseId &&
  previous.activeAssetCount === next.activeAssetCount &&
  previous.switchKnowledgeBase === next.switchKnowledgeBase &&
  previous.buildKnowledgeSwitchUrl === next.buildKnowledgeSwitchUrl &&
  areSidebarKnowledgeItemsEqual(
    previous.visibleKnowledgeItems,
    next.visibleKnowledgeItems,
  );

export const SidebarKnowledgeList = memo(function SidebarKnowledgeList({
  visibleKnowledgeItems,
  visibleKnowledgeBaseId,
  activeKnowledgeBaseId,
  activeAssetCount,
  switchKnowledgeBase,
  buildKnowledgeSwitchUrl,
}: SidebarKnowledgeListProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const shouldVirtualize =
    visibleKnowledgeItems.length >= SIDEBAR_KB_VIRTUALIZATION_THRESHOLD;

  useEffect(() => {
    if (!shouldVirtualize) {
      setScrollTop(0);
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const measureViewport = () => {
      setViewportHeight(viewport.clientHeight);
    };

    measureViewport();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      measureViewport();
    });
    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, [shouldVirtualize, visibleKnowledgeItems.length]);

  const virtualWindow = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        startIndex: 0,
        endIndex: visibleKnowledgeItems.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const effectiveViewportHeight = Math.max(
      viewportHeight,
      SIDEBAR_KB_ITEM_ESTIMATED_HEIGHT,
    );
    const visibleCount = Math.max(
      1,
      Math.ceil(effectiveViewportHeight / SIDEBAR_KB_ITEM_ESTIMATED_HEIGHT),
    );
    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / SIDEBAR_KB_ITEM_ESTIMATED_HEIGHT) -
        SIDEBAR_KB_VIRTUAL_OVERSCAN,
    );
    const endIndex = Math.min(
      visibleKnowledgeItems.length,
      startIndex + visibleCount + SIDEBAR_KB_VIRTUAL_OVERSCAN * 2,
    );

    return {
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * SIDEBAR_KB_ITEM_ESTIMATED_HEIGHT,
      bottomSpacerHeight:
        (visibleKnowledgeItems.length - endIndex) *
        SIDEBAR_KB_ITEM_ESTIMATED_HEIGHT,
    };
  }, [
    scrollTop,
    shouldVirtualize,
    viewportHeight,
    visibleKnowledgeItems.length,
  ]);

  const renderedKnowledgeItems = useMemo(
    () =>
      visibleKnowledgeItems.slice(
        virtualWindow.startIndex,
        virtualWindow.endIndex,
      ),
    [visibleKnowledgeItems, virtualWindow.endIndex, virtualWindow.startIndex],
  );

  const handleViewportScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!shouldVirtualize) {
        return;
      }
      setScrollTop(event.currentTarget.scrollTop);
    },
    [shouldVirtualize],
  );

  const renderKnowledgeItem = useCallback(
    (kb: KnowledgeSidebarItem<KnowledgeBaseRecord>) => {
      const isDemoEntry = isDemoKnowledgeSidebarEntry(kb);
      const badgeCount = resolveKnowledgeNavBadgeCount({
        navKnowledgeBaseId: kb.id,
        activeKnowledgeBaseId,
        activeAssetCount,
        fallbackCount: resolveKnowledgeSidebarFallbackAssetCount(kb),
      });

      return (
        <KbItem
          key={kb.id}
          type="button"
          $active={kb.id === visibleKnowledgeBaseId}
          $disabled={isDemoEntry}
          disabled={isDemoEntry}
          aria-disabled={isDemoEntry}
          onClick={() => {
            if (isDemoEntry || !kb.record) {
              return;
            }

            void switchKnowledgeBase(
              kb.record,
              buildKnowledgeSwitchUrl(kb.record),
            );
          }}
        >
          <KbItemMeta>
            <KbItemName title={kb.name}>{kb.name}</KbItemName>
          </KbItemMeta>
          <Space align="center" size={8}>
            <CountBadge>{badgeCount}</CountBadge>
          </Space>
        </KbItem>
      );
    },
    [
      activeAssetCount,
      activeKnowledgeBaseId,
      buildKnowledgeSwitchUrl,
      switchKnowledgeBase,
      visibleKnowledgeBaseId,
    ],
  );

  return (
    <div
      ref={viewportRef}
      onScroll={handleViewportScroll}
      data-testid="knowledge-sidebar-list"
      style={{
        flex: '0 1 auto',
        minWidth: 0,
        minHeight: 0,
        maxHeight: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarGutter: 'stable',
      }}
    >
      {virtualWindow.topSpacerHeight > 0 ? (
        <div style={{ height: virtualWindow.topSpacerHeight }} aria-hidden />
      ) : null}
      <div style={SIDEBAR_KB_ITEMS_CONTAINER_STYLE}>
        {renderedKnowledgeItems.map(renderKnowledgeItem)}
      </div>
      {virtualWindow.bottomSpacerHeight > 0 ? (
        <div style={{ height: virtualWindow.bottomSpacerHeight }} aria-hidden />
      ) : null}
    </div>
  );
}, areSidebarKnowledgeListPropsEqual);

export type RuleManageEntryListProps = {
  ruleList: Instruction[];
  onEdit: (instruction?: Instruction) => void;
  onDelete: (instruction: Instruction) => Promise<void> | void;
};

const areRuleItemsEqual = (previous: Instruction[], next: Instruction[]) => {
  if (previous === next) {
    return true;
  }

  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index += 1) {
    const prevItem = previous[index];
    const nextItem = next[index];
    if (
      prevItem.id !== nextItem.id ||
      prevItem.updatedAt !== nextItem.updatedAt ||
      prevItem.instruction !== nextItem.instruction ||
      prevItem.isDefault !== nextItem.isDefault
    ) {
      return false;
    }
  }

  return true;
};

const areRuleManageEntryListPropsEqual = (
  previous: RuleManageEntryListProps,
  next: RuleManageEntryListProps,
) =>
  previous.onEdit === next.onEdit &&
  previous.onDelete === next.onDelete &&
  areRuleItemsEqual(previous.ruleList, next.ruleList);

export const RuleManageEntryList = memo(function RuleManageEntryList({
  ruleList,
  onEdit,
  onDelete,
}: RuleManageEntryListProps) {
  const renderRuleItem = useCallback(
    (instruction: Instruction) => {
      const draftDisplay = resolveRuleDraftDisplay(instruction);
      return (
        <ManageEntryCard>
          <ManageEntryMain>
            <ManageEntryTitle>
              {draftDisplay.summary || '未命名规则'}
            </ManageEntryTitle>
            <ManageEntryDesc>
              {draftDisplay.content || '暂无规则内容'}
            </ManageEntryDesc>
          </ManageEntryMain>
          <Space size={8}>
            <LightButton
              type="default"
              size="small"
              onClick={() => onEdit(instruction)}
            >
              编辑
            </LightButton>
            <LightButton
              danger
              type="default"
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => void onDelete(instruction)}
            >
              删除
            </LightButton>
          </Space>
        </ManageEntryCard>
      );
    },
    [onDelete, onEdit],
  );
  const getRuleItemKey = useCallback(
    (instruction: Instruction) => instruction.id,
    [],
  );

  return (
    <VirtualizedManageEntryList
      items={ruleList}
      itemKey={getRuleItemKey}
      renderItem={renderRuleItem}
    />
  );
}, areRuleManageEntryListPropsEqual);

export type SqlManageEntryListProps = {
  sqlList: SqlPair[];
  onEdit: (sqlPair?: SqlPair) => void;
  onDelete: (sqlPair: SqlPair) => Promise<void> | void;
};

const areSqlItemsEqual = (previous: SqlPair[], next: SqlPair[]) => {
  if (previous === next) {
    return true;
  }

  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index += 1) {
    const prevItem = previous[index];
    const nextItem = next[index];
    if (
      prevItem.id !== nextItem.id ||
      prevItem.updatedAt !== nextItem.updatedAt ||
      prevItem.question !== nextItem.question ||
      prevItem.sql !== nextItem.sql
    ) {
      return false;
    }
  }

  return true;
};

const areSqlManageEntryListPropsEqual = (
  previous: SqlManageEntryListProps,
  next: SqlManageEntryListProps,
) =>
  previous.onEdit === next.onEdit &&
  previous.onDelete === next.onDelete &&
  areSqlItemsEqual(previous.sqlList, next.sqlList);

export const SqlManageEntryList = memo(function SqlManageEntryList({
  sqlList,
  onEdit,
  onDelete,
}: SqlManageEntryListProps) {
  const renderSqlItem = useCallback(
    (sqlPair: SqlPair) => (
      <ManageEntryCard>
        <ManageEntryMain>
          <ManageEntryTitle>
            {sqlPair.question || '未命名 SQL 模板'}
          </ManageEntryTitle>
          <ManageEntryDesc>{sqlPair.sql || '暂无 SQL 内容'}</ManageEntryDesc>
        </ManageEntryMain>
        <Space size={8}>
          <LightButton
            type="default"
            size="small"
            onClick={() => onEdit(sqlPair)}
          >
            编辑
          </LightButton>
          <LightButton
            danger
            type="default"
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => void onDelete(sqlPair)}
          >
            删除
          </LightButton>
        </Space>
      </ManageEntryCard>
    ),
    [onDelete, onEdit],
  );
  const getSqlItemKey = useCallback((sqlPair: SqlPair) => sqlPair.id, []);

  return (
    <VirtualizedManageEntryList
      items={sqlList}
      itemKey={getSqlItemKey}
      renderItem={renderSqlItem}
    />
  );
}, areSqlManageEntryListPropsEqual);
