import { SqlPair, Instruction } from '@/types/knowledge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  SearchOutlined,
  TableOutlined,
} from '@ant-design/icons';
import {
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Typography,
  message,
} from 'antd';
import {
  AssetGalleryBody,
  AssetGalleryCard,
  AssetGalleryChips,
  AssetGalleryFooter,
  AssetGalleryFooterRight,
  AssetGalleryGrid,
  AssetGalleryHeader,
  AssetGalleryInfoGrid,
  AssetGalleryInfoLabel,
  AssetGalleryInfoRow,
  AssetGalleryInfoSplit,
  AssetGalleryInfoValue,
  AssetGalleryLabel,
  AssetGalleryRowMeta,
  AssetGalleryTitle,
  AssetIconBox,
  AssetsLoadingCard,
  AssetsLoadingGrid,
  AssetsLoadingIntro,
  AssetsLoadingLine,
  AssetsLoadingOverlay,
  AssetsLoadingStage,
  AssetsPanel,
  AssetsPanelBody,
  EmptyInner,
  EmptyStage,
  InfoRow,
  LightButton,
  MainStage,
  MetricPill,
  Pill,
  PrimaryBlackButton,
  SummaryActions,
  SummaryCard,
  SummaryDescription,
  SummaryHeader,
  SummaryIconAction,
  SummaryInfo,
  SummaryTopRow,
  WorkbenchCompactItem,
  WorkbenchCompactItemMeta,
  WorkbenchCompactItemTitle,
  WorkbenchCompactList,
  WorkbenchCompactPanel,
  WorkbenchCompactPanelTitle,
  WorkbenchCreateCard,
  WorkbenchCreateCardIcon,
  WorkbenchCreateCardMeta,
  WorkbenchCreateCardTitle,
  WorkbenchCreateCardTop,
  WorkbenchEmpty,
  WorkbenchEditorActions,
  WorkbenchEditorCardGrid,
  WorkbenchEditorCard,
  WorkbenchEditorCardHead,
  WorkbenchEditorCardMain,
  WorkbenchEditorDesc,
  WorkbenchEditorForm,
  WorkbenchEditorActionGroup,
  WorkbenchEditorMeta,
  WorkbenchEditorMetaText,
  WorkbenchEditorRail,
  WorkbenchEditorStatusChip,
  WorkbenchEditorTitle,
  WorkbenchFilterChip,
  WorkbenchFilterRow,
  WorkbenchListCount,
  WorkbenchMiniIconButton,
  WorkbenchRailTop,
  WorkbenchSectionPanel,
  WorkbenchSectionTab,
  WorkbenchSectionTabs,
  WorkbenchStatCard,
  WorkbenchStatLabel,
  WorkbenchStatsGrid,
  WorkbenchStatValue,
} from '@/features/knowledgePage/index.styles';
import {
  EMPTY_RULE_EDITOR_VALUES,
  EMPTY_SQL_TEMPLATE_VALUES,
  buildRuleDraftFromAsset,
  buildSqlTemplateDraftFromAsset,
  filterKnowledgeInstructions,
  filterKnowledgeSqlTemplates,
  formatKnowledgeWorkbenchTimestamp,
  hasRuleDraftChanges,
  hasSqlTemplateDraftChanges,
} from '@/utils/knowledgeWorkbenchEditor';
import {
  parseInstructionDraft,
  type RuleDetailFormValues,
  type SqlTemplateFormValues,
} from '@/hooks/useKnowledgeRuleSqlManager';
import type { KnowledgeDetailFieldFilter } from '@/hooks/useKnowledgeAssetDetail';
import AssetDetailContent from './assetDetailContent';
import ModelingWorkspace from '@/components/pages/modeling/ModelingWorkspace';

import type { AssetView } from '@/features/knowledgePage/types';

const { Text, Title } = Typography;
const ASSET_GALLERY_INITIAL_RENDER_COUNT = 24;
const ASSET_GALLERY_RENDER_BATCH = 24;
const WORKBENCH_EDITOR_DRAWER_WIDTH = 640;
const WORKBENCH_EDITOR_DRAWER_BODY_STYLE = {
  padding: 0,
  background: '#ffffff',
  display: 'flex',
  flexDirection: 'column' as const,
  height: '100%',
};
const WORKBENCH_EDITOR_DRAWER_CONTENT_STYLE = {
  flex: 1,
  overflowY: 'auto' as const,
  padding: '16px 16px 96px',
};
const WORKBENCH_EDITOR_DRAWER_FOOTER_STYLE = {
  position: 'sticky' as const,
  bottom: 0,
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '14px 16px',
  borderTop: '1px solid #eef2f7',
  background: '#ffffff',
};
const WORKBENCH_EDITOR_DRAWER_FOOTER_GROUP_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const resolveWorkbenchModeLabel = ({
  isReadonlyKnowledgeBase,
  isSnapshotReadonlyKnowledgeBase,
}: {
  isReadonlyKnowledgeBase: boolean;
  isSnapshotReadonlyKnowledgeBase: boolean;
}) => {
  if (isReadonlyKnowledgeBase) {
    return '系统样例只读';
  }

  if (isSnapshotReadonlyKnowledgeBase) {
    return '历史快照只读';
  }

  return '可编辑';
};

const buildRuleCardSummary = (instruction: Instruction) =>
  parseInstructionDraft(instruction);

const resolveSqlTemplateCardStatus = (sqlPair: SqlPair) =>
  sqlPair.updatedAt ? '已保存' : '新建后未同步';

const resolveRuleCardStatus = (instruction: Instruction) =>
  instruction.isDefault ? '默认规则' : '匹配问题';

const buildSqlTemplateEditorValues = ({
  sqlPair,
  draftValues,
}: {
  sqlPair?: SqlPair;
  draftValues?: Partial<SqlTemplateFormValues>;
}): SqlTemplateFormValues => ({
  ...EMPTY_SQL_TEMPLATE_VALUES,
  ...(sqlPair
    ? {
        sql: sqlPair.sql || '',
        description: sqlPair.question || '',
      }
    : null),
  ...(draftValues || null),
});

const buildRuleEditorValues = ({
  instruction,
  draftValues,
}: {
  instruction?: Instruction;
  draftValues?: Partial<RuleDetailFormValues>;
}): RuleDetailFormValues => ({
  ...EMPTY_RULE_EDITOR_VALUES,
  ...(instruction ? parseInstructionDraft(instruction) : null),
  ...(draftValues || null),
});

type KnowledgeMainStageProps = {
  activeWorkbenchSection:
    | 'overview'
    | 'modeling'
    | 'sqlTemplates'
    | 'instructions';
  onChangeWorkbenchSection: (
    nextSection: 'overview' | 'modeling' | 'sqlTemplates' | 'instructions',
  ) => void;
  previewFieldCount: number;
  isSnapshotReadonlyKnowledgeBase: boolean;
  isReadonlyKnowledgeBase: boolean;
  isKnowledgeMutationDisabled: boolean;
  knowledgeMutationHint?: string | null;
  knowledgeDescription?: string | null;
  showKnowledgeAssetsLoading: boolean;
  detailAssets: AssetView[];
  activeDetailAsset?: AssetView | null;
  detailTab: 'overview' | 'fields' | 'usage';
  detailFieldKeyword: string;
  detailFieldFilter: KnowledgeDetailFieldFilter;
  detailAssetFields: Array<{
    key?: string;
    fieldName: string;
    fieldType?: string | null;
    aiName?: string | null;
    example?: string | null;
    enumValue?: string | null;
    note?: string | null;
    sourceColumnName?: string | null;
    isPrimaryKey?: boolean;
    isCalculated?: boolean;
    aggregation?: string | null;
    lineage?: number[] | null;
    nestedFields?: AssetView['fields'][number]['nestedFields'];
  }>;
  onOpenAssetWizard: () => void;
  onOpenKnowledgeEditor: () => void;
  onOpenAssetDetail: (asset: AssetView) => void;
  onCloseAssetDetail: () => void;
  onCreateRuleDraftFromAsset?: (asset: AssetView) => void;
  onCreateSqlTemplateDraftFromAsset?: (asset: AssetView) => void;
  onChangeDetailTab: (tab: 'overview' | 'fields' | 'usage') => void;
  onChangeFieldKeyword: (keyword: string) => void;
  onChangeFieldFilter: (filter: KnowledgeDetailFieldFilter) => void;
  historicalSnapshotReadonlyHint: string;
  ruleList: Instruction[];
  sqlList: SqlPair[];
  ruleManageLoading: boolean;
  sqlManageLoading: boolean;
  onOpenRuleDetail: (instruction?: Instruction) => void;
  onOpenSqlTemplateDetail: (sqlPair?: SqlPair) => void;
  onDeleteRule: (instruction: Instruction) => Promise<void> | void;
  onDeleteSqlTemplate: (sqlPair: SqlPair) => Promise<void> | void;
  editingInstruction?: Instruction | null;
  editingSqlPair?: SqlPair | null;
  ruleForm: any;
  sqlTemplateForm: any;
  createInstructionLoading: boolean;
  updateInstructionLoading: boolean;
  createSqlPairLoading: boolean;
  updateSqlPairLoading: boolean;
  onSubmitRuleDetail: () => Promise<void> | void;
  onSubmitSqlTemplateDetail: () => Promise<void> | void;
  onResetRuleDetailEditor: () => void;
  onResetSqlTemplateEditor: () => void;
  modelingWorkspaceKey: string;
  modelingSummary?: {
    modelCount: number;
    viewCount: number;
    relationCount: number;
  };
  onOpenModeling: () => void;
};

function KnowledgeMainStage({
  activeWorkbenchSection,
  onChangeWorkbenchSection,
  previewFieldCount,
  isSnapshotReadonlyKnowledgeBase,
  isReadonlyKnowledgeBase,
  isKnowledgeMutationDisabled,
  knowledgeMutationHint,
  knowledgeDescription,
  showKnowledgeAssetsLoading,
  detailAssets,
  activeDetailAsset,
  detailTab,
  detailFieldKeyword,
  detailFieldFilter,
  detailAssetFields,
  onOpenAssetWizard,
  onOpenKnowledgeEditor,
  onOpenAssetDetail,
  onCloseAssetDetail,
  onCreateRuleDraftFromAsset,
  onCreateSqlTemplateDraftFromAsset,
  onChangeDetailTab,
  onChangeFieldKeyword,
  onChangeFieldFilter,
  historicalSnapshotReadonlyHint,
  ruleList,
  sqlList,
  ruleManageLoading,
  sqlManageLoading,
  onOpenRuleDetail,
  onOpenSqlTemplateDetail,
  onDeleteRule: _onDeleteRule,
  onDeleteSqlTemplate: _onDeleteSqlTemplate,
  editingInstruction,
  editingSqlPair,
  ruleForm,
  sqlTemplateForm,
  createInstructionLoading,
  updateInstructionLoading,
  createSqlPairLoading,
  updateSqlPairLoading,
  onSubmitRuleDetail,
  onSubmitSqlTemplateDetail,
  onResetRuleDetailEditor,
  onResetSqlTemplateEditor,
  modelingWorkspaceKey,
  modelingSummary,
  onOpenModeling,
}: KnowledgeMainStageProps) {
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const [assetRenderLimit, setAssetRenderLimit] = useState(
    ASSET_GALLERY_INITIAL_RENDER_COUNT,
  );
  const [sqlSearchKeyword, setSqlSearchKeyword] = useState('');
  const [ruleSearchKeyword, setRuleSearchKeyword] = useState('');
  const [sqlListMode, setSqlListMode] = useState<'all' | 'recent'>('all');
  const [ruleListScope, setRuleListScope] = useState<
    'all' | 'default' | 'matched'
  >('all');
  const [sqlContextAssetId, setSqlContextAssetId] = useState<string>();
  const [ruleContextAssetId, setRuleContextAssetId] = useState<string>();
  const [sqlDraftBaseline, setSqlDraftBaseline] =
    useState<SqlTemplateFormValues>(EMPTY_SQL_TEMPLATE_VALUES);
  const [ruleDraftBaseline, setRuleDraftBaseline] =
    useState<RuleDetailFormValues>(EMPTY_RULE_EDITOR_VALUES);
  const [sqlTemplateDrawerOpen, setSqlTemplateDrawerOpen] = useState(false);
  const [ruleDrawerOpen, setRuleDrawerOpen] = useState(false);
  const watchedRuleSummary = Form.useWatch('summary', ruleForm);
  const watchedRuleScope = Form.useWatch('scope', ruleForm);
  const watchedRuleContent = Form.useWatch('content', ruleForm);
  const watchedSqlDescription = Form.useWatch('description', sqlTemplateForm);
  const watchedSqlContent = Form.useWatch('sql', sqlTemplateForm);

  useEffect(() => {
    setAssetRenderLimit(ASSET_GALLERY_INITIAL_RENDER_COUNT);
  }, [detailAssets.length]);

  useEffect(() => {
    if (!activeDetailAsset) {
      return;
    }

    const activeIndex = detailAssets.findIndex(
      (asset) => asset.id === activeDetailAsset.id,
    );
    if (activeIndex < 0) {
      return;
    }

    const requiredLimit = Math.min(
      detailAssets.length,
      activeIndex + ASSET_GALLERY_RENDER_BATCH,
    );
    setAssetRenderLimit((currentLimit) =>
      currentLimit >= requiredLimit ? currentLimit : requiredLimit,
    );
  }, [activeDetailAsset?.id, detailAssets]);

  useEffect(() => {
    if (activeDetailAsset && activeWorkbenchSection !== 'overview') {
      onCloseAssetDetail();
    }
  }, [activeDetailAsset, activeWorkbenchSection, onCloseAssetDetail]);

  const renderedDetailAssets = useMemo(
    () => detailAssets.slice(0, assetRenderLimit),
    [assetRenderLimit, detailAssets],
  );
  const hasMoreAssets = assetRenderLimit < detailAssets.length;
  const workbenchModeLabel = resolveWorkbenchModeLabel({
    isReadonlyKnowledgeBase,
    isSnapshotReadonlyKnowledgeBase,
  });
  const workbenchSections = [
    { key: 'overview', label: '概览' },
    { key: 'modeling', label: '建模' },
    { key: 'sqlTemplates', label: 'SQL 模板' },
    { key: 'instructions', label: '分析规则' },
  ] as const;
  const showAssetWorkbench = activeWorkbenchSection === 'overview';
  const sqlContextAsset =
    detailAssets.find((asset) => asset.id === sqlContextAssetId) || null;
  const ruleContextAsset =
    detailAssets.find((asset) => asset.id === ruleContextAssetId) || null;
  const readSqlDraftValues = useCallback(
    (): SqlTemplateFormValues => ({
      ...EMPTY_SQL_TEMPLATE_VALUES,
      ...sqlTemplateForm.getFieldsValue(['description', 'sql', 'scope']),
    }),
    [sqlTemplateForm],
  );
  const readRuleDraftValues = useCallback(
    (): RuleDetailFormValues => ({
      ...EMPTY_RULE_EDITOR_VALUES,
      ...ruleForm.getFieldsValue(['summary', 'scope', 'content']),
    }),
    [ruleForm],
  );
  const syncSqlDraftBaseline = useCallback(
    (nextValues?: Partial<SqlTemplateFormValues> | null) => {
      setSqlDraftBaseline({
        ...EMPTY_SQL_TEMPLATE_VALUES,
        ...(nextValues || readSqlDraftValues()),
      });
    },
    [readSqlDraftValues],
  );
  const syncRuleDraftBaseline = useCallback(
    (nextValues?: Partial<RuleDetailFormValues> | null) => {
      setRuleDraftBaseline({
        ...EMPTY_RULE_EDITOR_VALUES,
        ...(nextValues || readRuleDraftValues()),
      });
    },
    [readRuleDraftValues],
  );
  const visibleSqlList = useMemo(
    () =>
      filterKnowledgeSqlTemplates({
        sqlList,
        keyword: sqlSearchKeyword,
        mode: sqlListMode,
      }),
    [sqlList, sqlListMode, sqlSearchKeyword],
  );
  const visibleRuleList = useMemo(
    () =>
      filterKnowledgeInstructions({
        ruleList,
        keyword: ruleSearchKeyword,
        scope: ruleListScope,
      }),
    [ruleList, ruleListScope, ruleSearchKeyword],
  );
  const isRuleDraftDirty = useMemo(
    () =>
      hasRuleDraftChanges({
        currentValues: {
          summary: watchedRuleSummary,
          scope: watchedRuleScope,
          content: watchedRuleContent,
        },
        initialValues: ruleDraftBaseline,
      }),
    [
      ruleDraftBaseline,
      watchedRuleContent,
      watchedRuleScope,
      watchedRuleSummary,
    ],
  );
  const isSqlDraftDirty = useMemo(
    () =>
      hasSqlTemplateDraftChanges({
        currentValues: {
          description: watchedSqlDescription,
          sql: watchedSqlContent,
        },
        initialValues: sqlDraftBaseline,
      }),
    [sqlDraftBaseline, watchedSqlContent, watchedSqlDescription],
  );
  const sqlTemplateAssetOptions = useMemo(
    () =>
      detailAssets.map((asset) => ({
        label: asset.name,
        value: asset.id,
      })),
    [detailAssets],
  );

  useEffect(() => {
    if (!hasMoreAssets) {
      return;
    }

    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) {
          return;
        }

        setAssetRenderLimit((currentLimit) =>
          Math.min(
            detailAssets.length,
            currentLimit + ASSET_GALLERY_RENDER_BATCH,
          ),
        );
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [detailAssets.length, hasMoreAssets]);

  useEffect(() => {
    if (sqlContextAssetId && !sqlContextAsset) {
      setSqlContextAssetId(undefined);
    }
  }, [sqlContextAsset, sqlContextAssetId]);

  useEffect(() => {
    if (ruleContextAssetId && !ruleContextAsset) {
      setRuleContextAssetId(undefined);
    }
  }, [ruleContextAsset, ruleContextAssetId]);

  const confirmDiscardUnsavedChanges = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '当前编辑尚未保存',
          content: '继续切换会丢失本次改动，确定继续吗？',
          okText: '继续切换',
          cancelText: '留在当前',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      }),
    [],
  );

  const confirmDeleteEntry = useCallback(
    (entityLabel: string) =>
      new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `删除${entityLabel}`,
          content: `删除后不可恢复，确定要删除这条${entityLabel}吗？`,
          okText: '确认删除',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      }),
    [],
  );

  const runWithDirtyGuard = useCallback(
    async (dirty: boolean, action: () => void | Promise<void>) => {
      if (dirty) {
        const confirmed = await confirmDiscardUnsavedChanges();
        if (!confirmed) {
          return false;
        }
      }

      await action();
      return true;
    },
    [confirmDiscardUnsavedChanges],
  );

  const handleWorkbenchSectionChange = useCallback(
    async (
      nextSection: 'overview' | 'modeling' | 'sqlTemplates' | 'instructions',
    ) => {
      if (nextSection === activeWorkbenchSection) {
        return;
      }

      const dirty =
        activeWorkbenchSection === 'instructions'
          ? isRuleDraftDirty
          : activeWorkbenchSection === 'sqlTemplates'
            ? isSqlDraftDirty
            : false;

      await runWithDirtyGuard(dirty, () => {
        setSqlTemplateDrawerOpen(false);
        setRuleDrawerOpen(false);
        return onChangeWorkbenchSection(nextSection);
      });
    },
    [
      activeWorkbenchSection,
      isRuleDraftDirty,
      isSqlDraftDirty,
      onChangeWorkbenchSection,
      runWithDirtyGuard,
      setRuleDrawerOpen,
      setSqlTemplateDrawerOpen,
    ],
  );

  const openSqlTemplateEditor = useCallback(
    async ({
      sqlPair,
      draftValues,
      contextAssetId,
      switchSection = true,
    }: {
      sqlPair?: SqlPair;
      draftValues?: Partial<{
        sql: string;
        description: string;
      }>;
      contextAssetId?: string;
      switchSection?: boolean;
    }) => {
      const isSwitchingEditor =
        (sqlPair?.id || null) !== (editingSqlPair?.id || null) ||
        Boolean(draftValues) ||
        switchSection;
      const dirtyBeforeOpen =
        switchSection && activeWorkbenchSection !== 'sqlTemplates'
          ? activeWorkbenchSection === 'instructions'
            ? isRuleDraftDirty
            : false
          : isSwitchingEditor
            ? isSqlDraftDirty
            : false;

      if (!isSwitchingEditor && sqlTemplateDrawerOpen) {
        setSqlTemplateDrawerOpen(true);
        return true;
      }

      return runWithDirtyGuard(dirtyBeforeOpen, async () => {
        if (switchSection && activeWorkbenchSection !== 'sqlTemplates') {
          await onChangeWorkbenchSection('sqlTemplates');
        }
        const nextValues = buildSqlTemplateEditorValues({
          sqlPair,
          draftValues,
        });
        onOpenSqlTemplateDetail(sqlPair);
        sqlTemplateForm.setFieldsValue(nextValues);
        syncSqlDraftBaseline(nextValues);
        setSqlContextAssetId(contextAssetId);
        setSqlTemplateDrawerOpen(true);
      });
    },
    [
      activeWorkbenchSection,
      editingSqlPair?.id,
      isRuleDraftDirty,
      isSqlDraftDirty,
      onChangeWorkbenchSection,
      onOpenSqlTemplateDetail,
      runWithDirtyGuard,
      sqlTemplateForm,
      sqlTemplateDrawerOpen,
      setSqlContextAssetId,
      setSqlTemplateDrawerOpen,
      syncSqlDraftBaseline,
    ],
  );

  const openRuleEditor = useCallback(
    async ({
      instruction,
      draftValues,
      contextAssetId,
      switchSection = true,
    }: {
      instruction?: Instruction;
      draftValues?: Partial<{
        summary: string;
        scope: 'all' | 'matched';
        content: string;
      }>;
      contextAssetId?: string;
      switchSection?: boolean;
    }) => {
      const isSwitchingEditor =
        (instruction?.id || null) !== (editingInstruction?.id || null) ||
        Boolean(draftValues) ||
        switchSection;
      const dirtyBeforeOpen =
        switchSection && activeWorkbenchSection !== 'instructions'
          ? activeWorkbenchSection === 'sqlTemplates'
            ? isSqlDraftDirty
            : false
          : isSwitchingEditor
            ? isRuleDraftDirty
            : false;

      if (!isSwitchingEditor && ruleDrawerOpen) {
        setRuleDrawerOpen(true);
        return true;
      }

      return runWithDirtyGuard(dirtyBeforeOpen, async () => {
        if (switchSection && activeWorkbenchSection !== 'instructions') {
          await onChangeWorkbenchSection('instructions');
        }
        const nextValues = buildRuleEditorValues({
          instruction,
          draftValues,
        });
        onOpenRuleDetail(instruction);
        ruleForm.setFieldsValue(nextValues);
        syncRuleDraftBaseline(nextValues);
        setRuleContextAssetId(contextAssetId);
        setRuleDrawerOpen(true);
      });
    },
    [
      activeWorkbenchSection,
      editingInstruction?.id,
      isRuleDraftDirty,
      isSqlDraftDirty,
      onChangeWorkbenchSection,
      onOpenRuleDetail,
      ruleForm,
      ruleDrawerOpen,
      runWithDirtyGuard,
      setRuleContextAssetId,
      setRuleDrawerOpen,
      syncRuleDraftBaseline,
    ],
  );

  const handleCreateSqlTemplateFromAsset = useCallback(
    async (asset: AssetView) => {
      const draft = buildSqlTemplateDraftFromAsset(asset);
      const opened = await openSqlTemplateEditor({
        draftValues: draft,
        contextAssetId: asset.id,
      });
      if (!opened) {
        return;
      }
      message.success('已带入资产上下文，可继续完善 SQL 模板。');
      onCreateSqlTemplateDraftFromAsset?.(asset);
    },
    [onCreateSqlTemplateDraftFromAsset, openSqlTemplateEditor],
  );

  const handleCreateRuleFromAsset = useCallback(
    async (asset: AssetView) => {
      const draft = buildRuleDraftFromAsset(asset);
      const opened = await openRuleEditor({
        draftValues: draft,
        contextAssetId: asset.id,
      });
      if (!opened) {
        return;
      }
      message.success('已带入资产上下文，可继续完善分析规则。');
      onCreateRuleDraftFromAsset?.(asset);
    },
    [onCreateRuleDraftFromAsset, openRuleEditor],
  );

  const handleDuplicateSqlTemplate = useCallback(
    async (sqlPair: SqlPair) => {
      const opened = await openSqlTemplateEditor({
        draftValues: {
          description: `${sqlPair.question || 'SQL 模板'}（副本）`,
          sql: sqlPair.sql,
        },
      });
      if (!opened) {
        return;
      }
      message.success('已生成 SQL 模板草稿副本。');
    },
    [openSqlTemplateEditor],
  );

  const handleDuplicateRule = useCallback(
    async (instruction: Instruction) => {
      const draft = parseInstructionDraft(instruction);
      const opened = await openRuleEditor({
        draftValues: {
          summary: `${draft.summary || '分析规则'}（副本）`,
          scope: draft.scope,
          content: draft.content,
        },
      });
      if (!opened) {
        return;
      }
      message.success('已生成分析规则草稿副本。');
    },
    [openRuleEditor],
  );

  const handleDeleteSqlTemplate = useCallback(
    async (sqlPair: SqlPair) => {
      const confirmed = await confirmDeleteEntry('SQL 模板');
      if (!confirmed) {
        return;
      }
      const isDeletingActiveDraft = editingSqlPair?.id === sqlPair.id;
      await _onDeleteSqlTemplate(sqlPair);
      if (isDeletingActiveDraft) {
        onResetSqlTemplateEditor();
        syncSqlDraftBaseline(EMPTY_SQL_TEMPLATE_VALUES);
        setSqlContextAssetId(undefined);
        setSqlTemplateDrawerOpen(false);
      }
    },
    [
      _onDeleteSqlTemplate,
      confirmDeleteEntry,
      editingSqlPair?.id,
      onResetSqlTemplateEditor,
      setSqlContextAssetId,
      setSqlTemplateDrawerOpen,
      syncSqlDraftBaseline,
    ],
  );

  const handleDeleteRule = useCallback(
    async (instruction: Instruction) => {
      const confirmed = await confirmDeleteEntry('分析规则');
      if (!confirmed) {
        return;
      }
      const isDeletingActiveDraft = editingInstruction?.id === instruction.id;
      await _onDeleteRule(instruction);
      if (isDeletingActiveDraft) {
        onResetRuleDetailEditor();
        syncRuleDraftBaseline(EMPTY_RULE_EDITOR_VALUES);
        setRuleContextAssetId(undefined);
        setRuleDrawerOpen(false);
      }
    },
    [
      _onDeleteRule,
      confirmDeleteEntry,
      editingInstruction?.id,
      onResetRuleDetailEditor,
      setRuleContextAssetId,
      setRuleDrawerOpen,
      syncRuleDraftBaseline,
    ],
  );

  const handleResetSqlTemplateEditor = useCallback(() => {
    onResetSqlTemplateEditor();
    syncSqlDraftBaseline(EMPTY_SQL_TEMPLATE_VALUES);
  }, [onResetSqlTemplateEditor, syncSqlDraftBaseline]);

  const handleResetRuleDetailEditor = useCallback(() => {
    onResetRuleDetailEditor();
    syncRuleDraftBaseline(EMPTY_RULE_EDITOR_VALUES);
  }, [onResetRuleDetailEditor, syncRuleDraftBaseline]);

  const handleSubmitSqlTemplateDetail = useCallback(async () => {
    await onSubmitSqlTemplateDetail();
    syncSqlDraftBaseline();
  }, [onSubmitSqlTemplateDetail, syncSqlDraftBaseline]);

  const handleSubmitRuleDetail = useCallback(async () => {
    await onSubmitRuleDetail();
    syncRuleDraftBaseline();
  }, [onSubmitRuleDetail, syncRuleDraftBaseline]);

  const handleCloseSqlTemplateDrawer = useCallback(async () => {
    const closed = await runWithDirtyGuard(isSqlDraftDirty, () => {
      handleResetSqlTemplateEditor();
      setSqlContextAssetId(undefined);
      setSqlTemplateDrawerOpen(false);
    });

    return closed;
  }, [
    handleResetSqlTemplateEditor,
    isSqlDraftDirty,
    runWithDirtyGuard,
    setSqlContextAssetId,
    setSqlTemplateDrawerOpen,
  ]);

  const handleCloseRuleDrawer = useCallback(async () => {
    const closed = await runWithDirtyGuard(isRuleDraftDirty, () => {
      handleResetRuleDetailEditor();
      setRuleContextAssetId(undefined);
      setRuleDrawerOpen(false);
    });

    return closed;
  }, [
    handleResetRuleDetailEditor,
    isRuleDraftDirty,
    runWithDirtyGuard,
    setRuleContextAssetId,
    setRuleDrawerOpen,
  ]);

  const applySqlContextDraft = useCallback(() => {
    if (!sqlContextAsset) {
      return;
    }
    sqlTemplateForm.setFieldsValue(
      buildSqlTemplateDraftFromAsset(sqlContextAsset),
    );
    message.success('已将参考资产内容带入当前 SQL 模板。');
  }, [sqlContextAsset, sqlTemplateForm]);

  const applyRuleContextDraft = useCallback(() => {
    if (!ruleContextAsset) {
      return;
    }
    ruleForm.setFieldsValue(buildRuleDraftFromAsset(ruleContextAsset));
    message.success('已将参考资产内容带入当前分析规则。');
  }, [ruleContextAsset, ruleForm]);

  useEffect(() => {
    if (
      activeWorkbenchSection !== 'sqlTemplates' &&
      activeWorkbenchSection !== 'instructions'
    ) {
      return;
    }

    const handler = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 's'
      ) {
        return;
      }

      event.preventDefault();
      if (activeWorkbenchSection === 'sqlTemplates') {
        if (!sqlTemplateDrawerOpen) {
          return;
        }
        void handleSubmitSqlTemplateDetail();
        return;
      }

      if (!ruleDrawerOpen) {
        return;
      }
      void handleSubmitRuleDetail();
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [
    activeWorkbenchSection,
    handleSubmitRuleDetail,
    handleSubmitSqlTemplateDetail,
    ruleDrawerOpen,
    sqlTemplateDrawerOpen,
  ]);

  return (
    <MainStage>
      <SummaryCard>
        <SummaryHeader>
          <SummaryTopRow>
            <InfoRow>
              <Pill>字段数：{previewFieldCount}/800</Pill>
              {isSnapshotReadonlyKnowledgeBase ? <Pill>历史快照</Pill> : null}
              {isReadonlyKnowledgeBase ? <Pill>系统样例</Pill> : null}
            </InfoRow>

            <SummaryActions>
              {!isKnowledgeMutationDisabled ? (
                <SummaryIconAction
                  type="button"
                  onClick={onOpenKnowledgeEditor}
                  title="编辑知识库"
                  aria-label="编辑知识库"
                >
                  <EditOutlined />
                </SummaryIconAction>
              ) : null}
            </SummaryActions>
          </SummaryTopRow>

          <SummaryInfo>
            {knowledgeMutationHint ? (
              <SummaryDescription>{knowledgeMutationHint}</SummaryDescription>
            ) : null}
            {knowledgeDescription ? (
              <SummaryDescription>{knowledgeDescription}</SummaryDescription>
            ) : null}
          </SummaryInfo>
        </SummaryHeader>
      </SummaryCard>

      <WorkbenchSectionTabs>
        {workbenchSections.map((section) => (
          <WorkbenchSectionTab
            key={section.key}
            type="button"
            data-testid={`knowledge-workbench-tab-${section.key}`}
            $active={activeWorkbenchSection === section.key}
            onClick={() => void handleWorkbenchSectionChange(section.key)}
          >
            {section.label}
          </WorkbenchSectionTab>
        ))}
      </WorkbenchSectionTabs>

      {activeWorkbenchSection === 'overview' ? (
        <>
          <WorkbenchStatsGrid>
            <WorkbenchStatCard>
              <WorkbenchStatLabel>资产数</WorkbenchStatLabel>
              <WorkbenchStatValue>{detailAssets.length}</WorkbenchStatValue>
            </WorkbenchStatCard>
            <WorkbenchStatCard>
              <WorkbenchStatLabel>字段预算</WorkbenchStatLabel>
              <WorkbenchStatValue>{previewFieldCount}/800</WorkbenchStatValue>
            </WorkbenchStatCard>
            <WorkbenchStatCard>
              <WorkbenchStatLabel>SQL 模板</WorkbenchStatLabel>
              <WorkbenchStatValue>{sqlList.length}</WorkbenchStatValue>
            </WorkbenchStatCard>
            <WorkbenchStatCard>
              <WorkbenchStatLabel>分析规则</WorkbenchStatLabel>
              <WorkbenchStatValue>{ruleList.length}</WorkbenchStatValue>
            </WorkbenchStatCard>
            <WorkbenchStatCard>
              <WorkbenchStatLabel>模型</WorkbenchStatLabel>
              <WorkbenchStatValue>
                {modelingSummary?.modelCount || 0}
              </WorkbenchStatValue>
            </WorkbenchStatCard>
            <WorkbenchStatCard>
              <WorkbenchStatLabel>视图</WorkbenchStatLabel>
              <WorkbenchStatValue>
                {modelingSummary?.viewCount || 0}
              </WorkbenchStatValue>
            </WorkbenchStatCard>
          </WorkbenchStatsGrid>
        </>
      ) : null}

      {showAssetWorkbench ? (
        <>
          <AssetsPanel>
            <AssetsPanelBody>
              {detailAssets.length > 0 ? (
                <AssetGalleryGrid>
                  {activeWorkbenchSection === 'overview' &&
                  !isKnowledgeMutationDisabled ? (
                    <WorkbenchCreateCard
                      type="button"
                      onClick={onOpenAssetWizard}
                      data-testid="knowledge-add-asset-card"
                    >
                      <WorkbenchCreateCardTop>
                        <WorkbenchCreateCardIcon>
                          <PlusOutlined />
                        </WorkbenchCreateCardIcon>
                        <WorkbenchCreateCardTitle>
                          添加资产
                        </WorkbenchCreateCardTitle>
                      </WorkbenchCreateCardTop>
                      <WorkbenchCreateCardMeta>
                        通过完整向导选择连接、预览字段并完成知识配置。
                      </WorkbenchCreateCardMeta>
                    </WorkbenchCreateCard>
                  ) : null}
                  {renderedDetailAssets.map((asset) => (
                    <AssetGalleryCard
                      key={asset.id}
                      type="button"
                      data-testid="knowledge-asset-card"
                      data-asset-name={asset.name}
                      $active={asset.id === activeDetailAsset?.id}
                      onClick={() => onOpenAssetDetail(asset)}
                    >
                      <AssetGalleryHeader>
                        <AssetGalleryTitle>
                          <AssetIconBox $kind={asset.kind}>
                            {asset.kind === 'model' ? (
                              <DatabaseOutlined />
                            ) : (
                              <TableOutlined />
                            )}
                          </AssetIconBox>
                          <div style={{ minWidth: 0 }}>
                            <AssetGalleryLabel title={asset.name}>
                              {asset.name}
                            </AssetGalleryLabel>
                          </div>
                        </AssetGalleryTitle>
                      </AssetGalleryHeader>
                      <AssetGalleryBody>
                        <AssetGalleryInfoGrid>
                          <AssetGalleryInfoRow>
                            <AssetGalleryInfoLabel>表名</AssetGalleryInfoLabel>
                            <AssetGalleryInfoSplit>
                              <AssetGalleryInfoValue
                                title={asset.sourceTableName || asset.name}
                              >
                                {asset.sourceTableName || asset.name}
                              </AssetGalleryInfoValue>
                              <AssetGalleryRowMeta>
                                {asset.kind === 'model'
                                  ? '表资产'
                                  : '视图资产'}
                              </AssetGalleryRowMeta>
                            </AssetGalleryInfoSplit>
                          </AssetGalleryInfoRow>
                          <AssetGalleryInfoRow>
                            <AssetGalleryInfoLabel>描述</AssetGalleryInfoLabel>
                            <AssetGalleryInfoValue
                              $multiline
                              title={asset.description || '暂无资产说明'}
                            >
                              {asset.description || '暂无资产说明'}
                            </AssetGalleryInfoValue>
                          </AssetGalleryInfoRow>
                        </AssetGalleryInfoGrid>
                      </AssetGalleryBody>
                      <AssetGalleryFooter>
                        <AssetGalleryChips>
                          <MetricPill>{asset.fieldCount} 个字段</MetricPill>
                        </AssetGalleryChips>
                        <AssetGalleryFooterRight>
                          <MetricPill>
                            {asset.kind === 'model' ? '数据表' : '视图'}
                          </MetricPill>
                        </AssetGalleryFooterRight>
                      </AssetGalleryFooter>
                    </AssetGalleryCard>
                  ))}
                  {hasMoreAssets ? (
                    <div
                      ref={loadMoreSentinelRef}
                      style={{
                        width: '100%',
                        height: 1,
                        gridColumn: '1 / -1',
                      }}
                      aria-hidden
                    />
                  ) : null}
                </AssetGalleryGrid>
              ) : (
                <EmptyStage>
                  <EmptyInner>
                    <FolderOpenOutlined
                      style={{ fontSize: 48, color: '#c4c8d5' }}
                    />
                    <Title level={4} style={{ margin: 0 }}>
                      知识库为空
                    </Title>
                    <Text type="secondary">
                      {isReadonlyKnowledgeBase
                        ? '系统样例已预置结构与问答配置，可直接浏览体验。'
                        : isSnapshotReadonlyKnowledgeBase
                          ? historicalSnapshotReadonlyHint
                          : '先添加资产，后续这里会展示表、视图与字段概览。'}
                    </Text>
                    {!isKnowledgeMutationDisabled ? (
                      <PrimaryBlackButton
                        type="button"
                        onClick={onOpenAssetWizard}
                      >
                        <PlusOutlined />
                        <span>添加资产</span>
                      </PrimaryBlackButton>
                    ) : null}
                  </EmptyInner>
                </EmptyStage>
              )}

              {showKnowledgeAssetsLoading ? (
                <AssetsLoadingOverlay>
                  <AssetsLoadingStage>
                    <AssetsLoadingIntro>
                      <Text strong style={{ color: '#111827' }}>
                        正在同步知识库内容…
                      </Text>
                      <Text type="secondary">
                        当前知识库的表结构与字段信息正在加载，稍后会自动展示。
                      </Text>
                    </AssetsLoadingIntro>
                    <AssetsLoadingGrid>
                      {[0, 1].map((index) => (
                        <AssetsLoadingCard key={index}>
                          <AssetsLoadingLine $width="46%" $height={14} />
                          <AssetsLoadingLine $width="78%" $muted />
                          <AssetsLoadingLine $width="100%" $muted />
                          <AssetsLoadingLine $width="68%" $muted />
                          <AssetsLoadingLine $width="22%" $height={18} />
                        </AssetsLoadingCard>
                      ))}
                    </AssetsLoadingGrid>
                  </AssetsLoadingStage>
                </AssetsLoadingOverlay>
              ) : null}
            </AssetsPanelBody>
          </AssetsPanel>

          <Drawer
            destroyOnClose={false}
            placement="right"
            closable={false}
            title={null}
            visible={
              Boolean(activeDetailAsset) &&
              activeWorkbenchSection === 'overview'
            }
            onClose={onCloseAssetDetail}
            width="60vw"
            bodyStyle={{ padding: 20, background: '#ffffff' }}
            headerStyle={{ display: 'none' }}
          >
            {activeDetailAsset ? (
              <AssetDetailContent
                activeDetailAsset={activeDetailAsset}
                detailTab={detailTab}
                detailFieldKeyword={detailFieldKeyword}
                detailFieldFilter={detailFieldFilter}
                detailAssetFields={detailAssetFields}
                canCreateKnowledgeArtifacts={!isKnowledgeMutationDisabled}
                onClose={onCloseAssetDetail}
                onNavigateModeling={onOpenModeling}
                onCreateRuleDraft={handleCreateRuleFromAsset}
                onCreateSqlTemplateDraft={handleCreateSqlTemplateFromAsset}
                onChangeDetailTab={onChangeDetailTab}
                onChangeFieldKeyword={onChangeFieldKeyword}
                onChangeFieldFilter={onChangeFieldFilter}
              />
            ) : null}
          </Drawer>
        </>
      ) : null}

      {activeWorkbenchSection === 'modeling' ? (
        <>
          <WorkbenchStatsGrid>
            <WorkbenchStatCard>
              <WorkbenchStatLabel>模型</WorkbenchStatLabel>
              <WorkbenchStatValue>
                {modelingSummary?.modelCount || 0}
              </WorkbenchStatValue>
            </WorkbenchStatCard>
            <WorkbenchStatCard>
              <WorkbenchStatLabel>视图</WorkbenchStatLabel>
              <WorkbenchStatValue>
                {modelingSummary?.viewCount || 0}
              </WorkbenchStatValue>
            </WorkbenchStatCard>
            <WorkbenchStatCard>
              <WorkbenchStatLabel>关系</WorkbenchStatLabel>
              <WorkbenchStatValue>
                {modelingSummary?.relationCount || 0}
              </WorkbenchStatValue>
            </WorkbenchStatCard>
            <WorkbenchStatCard>
              <WorkbenchStatLabel>模式</WorkbenchStatLabel>
              <WorkbenchStatValue>{workbenchModeLabel}</WorkbenchStatValue>
            </WorkbenchStatCard>
          </WorkbenchStatsGrid>
          <ModelingWorkspace key={modelingWorkspaceKey} embedded />
        </>
      ) : null}

      {activeWorkbenchSection === 'sqlTemplates' ? (
        <WorkbenchSectionPanel>
          {sqlManageLoading ? (
            <Text type="secondary">正在加载 SQL 模板…</Text>
          ) : (
            <>
              <WorkbenchEditorRail>
                <WorkbenchRailTop>
                  <Input
                    allowClear
                    value={sqlSearchKeyword}
                    placeholder="搜索模板名称、问法或 SQL 片段"
                    prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
                    onChange={(event) =>
                      setSqlSearchKeyword(event.target.value)
                    }
                  />
                  <WorkbenchFilterRow>
                    <WorkbenchFilterChip
                      type="button"
                      $active={sqlListMode === 'all'}
                      onClick={() => setSqlListMode('all')}
                    >
                      全部
                    </WorkbenchFilterChip>
                    <WorkbenchFilterChip
                      type="button"
                      $active={sqlListMode === 'recent'}
                      onClick={() => setSqlListMode('recent')}
                    >
                      最近更新
                    </WorkbenchFilterChip>
                  </WorkbenchFilterRow>
                  <WorkbenchListCount>
                    当前显示 {visibleSqlList.length} / {sqlList.length} 条
                  </WorkbenchListCount>
                </WorkbenchRailTop>
                {visibleSqlList.length > 0 || !isKnowledgeMutationDisabled ? (
                  <WorkbenchEditorCardGrid>
                    {!isKnowledgeMutationDisabled ? (
                      <WorkbenchCreateCard
                        type="button"
                        onClick={() => void openSqlTemplateEditor({})}
                      >
                        <WorkbenchCreateCardTop>
                          <WorkbenchCreateCardIcon>
                            <PlusOutlined />
                          </WorkbenchCreateCardIcon>
                          <WorkbenchCreateCardTitle>
                            新建 SQL 模板
                          </WorkbenchCreateCardTitle>
                        </WorkbenchCreateCardTop>
                        <WorkbenchCreateCardMeta>
                          新增一条稳定口径模板，用于后续问答复用与团队沉淀。
                        </WorkbenchCreateCardMeta>
                      </WorkbenchCreateCard>
                    ) : null}
                    {visibleSqlList.map((sqlPair) => (
                      <WorkbenchEditorCard
                        key={sqlPair.id}
                        type="button"
                        $active={
                          sqlTemplateDrawerOpen &&
                          editingSqlPair?.id === sqlPair.id
                        }
                        onClick={() =>
                          void openSqlTemplateEditor({
                            sqlPair,
                            switchSection: false,
                          })
                        }
                      >
                        <WorkbenchEditorCardHead>
                          <WorkbenchEditorCardMain>
                            <WorkbenchEditorTitle>
                              {sqlPair.question || '未命名 SQL 模板'}
                            </WorkbenchEditorTitle>
                            <WorkbenchEditorMeta>
                              <WorkbenchEditorStatusChip $tone="accent">
                                {resolveSqlTemplateCardStatus(sqlPair)}
                              </WorkbenchEditorStatusChip>
                              <WorkbenchEditorMetaText>
                                更新于{' '}
                                {formatKnowledgeWorkbenchTimestamp(
                                  sqlPair.updatedAt || sqlPair.createdAt,
                                )}
                              </WorkbenchEditorMetaText>
                            </WorkbenchEditorMeta>
                          </WorkbenchEditorCardMain>
                          {!isKnowledgeMutationDisabled ? (
                            <WorkbenchEditorActionGroup>
                              <WorkbenchMiniIconButton
                                type="button"
                                title="复制为新草稿"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleDuplicateSqlTemplate(sqlPair);
                                }}
                              >
                                <CopyOutlined />
                              </WorkbenchMiniIconButton>
                              <WorkbenchMiniIconButton
                                type="button"
                                $danger
                                title="删除 SQL 模板"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleDeleteSqlTemplate(sqlPair);
                                }}
                              >
                                <DeleteOutlined />
                              </WorkbenchMiniIconButton>
                            </WorkbenchEditorActionGroup>
                          ) : null}
                        </WorkbenchEditorCardHead>
                        <WorkbenchEditorDesc>
                          {sqlPair.sql || '暂无 SQL 内容'}
                        </WorkbenchEditorDesc>
                      </WorkbenchEditorCard>
                    ))}
                  </WorkbenchEditorCardGrid>
                ) : (
                  <WorkbenchEmpty style={{ minHeight: 200 }}>
                    <Text strong>
                      {sqlList.length > 0
                        ? '没有匹配的 SQL 模板'
                        : '先创建第一条 SQL 模板'}
                    </Text>
                    <Text type="secondary">
                      {sqlList.length > 0
                        ? '试试更换关键字，或切换到“全部 / 最近更新”查看其它模板。'
                        : '先新增一条模板，再在右侧抽屉里填写典型问法与 SQL 内容。'}
                    </Text>
                  </WorkbenchEmpty>
                )}
              </WorkbenchEditorRail>

              <Drawer
                destroyOnClose={false}
                onClose={() => void handleCloseSqlTemplateDrawer()}
                visible={sqlTemplateDrawerOpen}
                width={WORKBENCH_EDITOR_DRAWER_WIDTH}
                closable={false}
                title={null}
                bodyStyle={WORKBENCH_EDITOR_DRAWER_BODY_STYLE}
                headerStyle={{ display: 'none' }}
              >
                <div style={WORKBENCH_EDITOR_DRAWER_CONTENT_STYLE}>
                  <WorkbenchCompactPanel>
                    <WorkbenchCompactPanelTitle>
                      参考资产
                    </WorkbenchCompactPanelTitle>
                    <Select
                      allowClear
                      style={{ width: '100%' }}
                      placeholder="选择一个资产，把典型问法和 SQL 草稿带进来"
                      options={sqlTemplateAssetOptions}
                      value={sqlContextAssetId}
                      onChange={(value) => setSqlContextAssetId(value)}
                    />
                    {sqlContextAsset ? (
                      <>
                        <WorkbenchCompactList style={{ marginTop: 10 }}>
                          <WorkbenchCompactItem>
                            <WorkbenchCompactItemTitle>
                              {sqlContextAsset.name}
                            </WorkbenchCompactItemTitle>
                            <WorkbenchCompactItemMeta>
                              {sqlContextAsset.sourceTableName ||
                                '未暴露源表名'}{' '}
                              · {sqlContextAsset.fieldCount} 个字段
                            </WorkbenchCompactItemMeta>
                          </WorkbenchCompactItem>
                        </WorkbenchCompactList>
                        {(sqlContextAsset.suggestedQuestions || []).length ? (
                          <WorkbenchFilterRow style={{ marginTop: 10 }}>
                            {(sqlContextAsset.suggestedQuestions || [])
                              .slice(0, 3)
                              .map((question) => (
                                <WorkbenchFilterChip
                                  key={question}
                                  type="button"
                                  onClick={() =>
                                    sqlTemplateForm.setFieldsValue({
                                      description: question,
                                    })
                                  }
                                >
                                  {question}
                                </WorkbenchFilterChip>
                              ))}
                          </WorkbenchFilterRow>
                        ) : null}
                        {!isKnowledgeMutationDisabled ? (
                          <WorkbenchEditorActions>
                            <LightButton onClick={applySqlContextDraft}>
                              带入示例 SQL
                            </LightButton>
                            <LightButton
                              onClick={() =>
                                void handleCreateRuleFromAsset(sqlContextAsset)
                              }
                            >
                              去沉淀分析规则
                            </LightButton>
                          </WorkbenchEditorActions>
                        ) : null}
                      </>
                    ) : null}
                  </WorkbenchCompactPanel>
                  <WorkbenchEditorForm form={sqlTemplateForm} layout="vertical">
                    <Form.Item
                      label="模板名称 / 典型问法"
                      name="description"
                      rules={[
                        { required: true, message: '请输入模板名称或典型问法' },
                      ]}
                    >
                      <Input
                        disabled={isKnowledgeMutationDisabled}
                        placeholder="例如：最近 30 天 GMV 趋势"
                      />
                    </Form.Item>
                    <Form.Item
                      label="SQL 代码"
                      name="sql"
                      rules={[{ required: true, message: '请输入 SQL 语句' }]}
                    >
                      <Input.TextArea
                        disabled={isKnowledgeMutationDisabled}
                        rows={14}
                        placeholder="请输入可复用的 SQL 示例，建议优先沉淀稳定口径。"
                      />
                    </Form.Item>
                  </WorkbenchEditorForm>
                </div>
                <div style={WORKBENCH_EDITOR_DRAWER_FOOTER_STYLE}>
                  <div style={WORKBENCH_EDITOR_DRAWER_FOOTER_GROUP_STYLE}>
                    {!isKnowledgeMutationDisabled ? (
                      <Button onClick={handleResetSqlTemplateEditor}>
                        重置
                      </Button>
                    ) : null}
                  </div>
                  <div style={WORKBENCH_EDITOR_DRAWER_FOOTER_GROUP_STYLE}>
                    <Button onClick={() => void handleCloseSqlTemplateDrawer()}>
                      {isKnowledgeMutationDisabled ? '关闭' : '取消'}
                    </Button>
                    {!isKnowledgeMutationDisabled ? (
                      <Button
                        type="primary"
                        loading={createSqlPairLoading || updateSqlPairLoading}
                        onClick={() => void handleSubmitSqlTemplateDetail()}
                      >
                        保存 SQL 模板
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Drawer>
            </>
          )}
        </WorkbenchSectionPanel>
      ) : null}

      {activeWorkbenchSection === 'instructions' ? (
        <WorkbenchSectionPanel>
          {ruleManageLoading ? (
            <Text type="secondary">正在加载分析规则…</Text>
          ) : (
            <>
              <WorkbenchEditorRail>
                <WorkbenchRailTop>
                  <Input
                    allowClear
                    value={ruleSearchKeyword}
                    placeholder="搜索规则名称、首条问法或规则内容"
                    prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
                    onChange={(event) =>
                      setRuleSearchKeyword(event.target.value)
                    }
                  />
                  <WorkbenchFilterRow>
                    <WorkbenchFilterChip
                      type="button"
                      $active={ruleListScope === 'all'}
                      onClick={() => setRuleListScope('all')}
                    >
                      全部
                    </WorkbenchFilterChip>
                    <WorkbenchFilterChip
                      type="button"
                      $active={ruleListScope === 'default'}
                      onClick={() => setRuleListScope('default')}
                    >
                      默认规则
                    </WorkbenchFilterChip>
                    <WorkbenchFilterChip
                      type="button"
                      $active={ruleListScope === 'matched'}
                      onClick={() => setRuleListScope('matched')}
                    >
                      匹配问题
                    </WorkbenchFilterChip>
                  </WorkbenchFilterRow>
                  <WorkbenchListCount>
                    当前显示 {visibleRuleList.length} / {ruleList.length} 条
                  </WorkbenchListCount>
                </WorkbenchRailTop>
                {visibleRuleList.length > 0 || !isKnowledgeMutationDisabled ? (
                  <WorkbenchEditorCardGrid>
                    {!isKnowledgeMutationDisabled ? (
                      <WorkbenchCreateCard
                        type="button"
                        onClick={() => void openRuleEditor({})}
                      >
                        <WorkbenchCreateCardTop>
                          <WorkbenchCreateCardIcon>
                            <PlusOutlined />
                          </WorkbenchCreateCardIcon>
                          <WorkbenchCreateCardTitle>
                            新建分析规则
                          </WorkbenchCreateCardTitle>
                        </WorkbenchCreateCardTop>
                        <WorkbenchCreateCardMeta>
                          补一条业务口径或匹配问法规则，让知识库回答更稳定。
                        </WorkbenchCreateCardMeta>
                      </WorkbenchCreateCard>
                    ) : null}
                    {visibleRuleList.map((instruction) => {
                      const draft = buildRuleCardSummary(instruction);
                      return (
                        <WorkbenchEditorCard
                          key={instruction.id}
                          type="button"
                          $active={
                            ruleDrawerOpen &&
                            editingInstruction?.id === instruction.id
                          }
                          onClick={() =>
                            void openRuleEditor({
                              instruction,
                              switchSection: false,
                            })
                          }
                        >
                          <WorkbenchEditorCardHead>
                            <WorkbenchEditorCardMain>
                              <WorkbenchEditorTitle>
                                {draft.summary || '未命名规则'}
                              </WorkbenchEditorTitle>
                              <WorkbenchEditorMeta>
                                <WorkbenchEditorStatusChip
                                  $tone={
                                    instruction.isDefault ? 'accent' : 'default'
                                  }
                                >
                                  {resolveRuleCardStatus(instruction)}
                                </WorkbenchEditorStatusChip>
                                <WorkbenchEditorMetaText>
                                  更新于{' '}
                                  {formatKnowledgeWorkbenchTimestamp(
                                    instruction.updatedAt ||
                                      instruction.createdAt,
                                  )}
                                </WorkbenchEditorMetaText>
                              </WorkbenchEditorMeta>
                            </WorkbenchEditorCardMain>
                            {!isKnowledgeMutationDisabled ? (
                              <WorkbenchEditorActionGroup>
                                <WorkbenchMiniIconButton
                                  type="button"
                                  title="复制为新草稿"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDuplicateRule(instruction);
                                  }}
                                >
                                  <CopyOutlined />
                                </WorkbenchMiniIconButton>
                                <WorkbenchMiniIconButton
                                  type="button"
                                  $danger
                                  title="删除分析规则"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteRule(instruction);
                                  }}
                                >
                                  <DeleteOutlined />
                                </WorkbenchMiniIconButton>
                              </WorkbenchEditorActionGroup>
                            ) : null}
                          </WorkbenchEditorCardHead>
                          <WorkbenchEditorDesc>
                            {draft.content || '暂无规则内容'}
                          </WorkbenchEditorDesc>
                        </WorkbenchEditorCard>
                      );
                    })}
                  </WorkbenchEditorCardGrid>
                ) : (
                  <WorkbenchEmpty style={{ minHeight: 200 }}>
                    <Text strong>
                      {ruleList.length > 0
                        ? '没有匹配的分析规则'
                        : '先创建第一条分析规则'}
                    </Text>
                    <Text type="secondary">
                      {ruleList.length > 0
                        ? '试试更换关键字，或切换“默认规则 / 匹配问题”过滤条件。'
                        : '先新增规则，再在右侧抽屉里补充业务口径与适用方式。'}
                    </Text>
                  </WorkbenchEmpty>
                )}
              </WorkbenchEditorRail>

              <Drawer
                destroyOnClose={false}
                onClose={() => void handleCloseRuleDrawer()}
                visible={ruleDrawerOpen}
                width={WORKBENCH_EDITOR_DRAWER_WIDTH}
                closable={false}
                title={null}
                bodyStyle={WORKBENCH_EDITOR_DRAWER_BODY_STYLE}
                headerStyle={{ display: 'none' }}
              >
                <div style={WORKBENCH_EDITOR_DRAWER_CONTENT_STYLE}>
                  <WorkbenchCompactPanel>
                    <WorkbenchCompactPanelTitle>
                      参考资产
                    </WorkbenchCompactPanelTitle>
                    <Select
                      allowClear
                      style={{ width: '100%' }}
                      placeholder="选择一个资产，把推荐问法和治理提示带进来"
                      options={sqlTemplateAssetOptions}
                      value={ruleContextAssetId}
                      onChange={(value) => setRuleContextAssetId(value)}
                    />
                    {ruleContextAsset ? (
                      <>
                        <WorkbenchCompactList style={{ marginTop: 10 }}>
                          <WorkbenchCompactItem>
                            <WorkbenchCompactItemTitle>
                              {ruleContextAsset.name}
                            </WorkbenchCompactItemTitle>
                            <WorkbenchCompactItemMeta>
                              主键 {ruleContextAsset.primaryKey || '未声明'} ·{' '}
                              {ruleContextAsset.fieldCount} 个字段
                            </WorkbenchCompactItemMeta>
                          </WorkbenchCompactItem>
                        </WorkbenchCompactList>
                        {(ruleContextAsset.suggestedQuestions || []).length ? (
                          <WorkbenchFilterRow style={{ marginTop: 10 }}>
                            {(ruleContextAsset.suggestedQuestions || [])
                              .slice(0, 3)
                              .map((question) => (
                                <WorkbenchFilterChip
                                  key={question}
                                  type="button"
                                  onClick={() =>
                                    ruleForm.setFieldsValue({
                                      summary: question,
                                    })
                                  }
                                >
                                  {question}
                                </WorkbenchFilterChip>
                              ))}
                          </WorkbenchFilterRow>
                        ) : null}
                        {!isKnowledgeMutationDisabled ? (
                          <WorkbenchEditorActions>
                            <LightButton onClick={applyRuleContextDraft}>
                              带入规则草稿
                            </LightButton>
                            <LightButton
                              onClick={() =>
                                void handleCreateSqlTemplateFromAsset(
                                  ruleContextAsset,
                                )
                              }
                            >
                              去沉淀 SQL 模板
                            </LightButton>
                          </WorkbenchEditorActions>
                        ) : null}
                      </>
                    ) : null}
                  </WorkbenchCompactPanel>
                  <WorkbenchEditorForm form={ruleForm} layout="vertical">
                    <Form.Item
                      label="规则名称 / 首条问法"
                      name="summary"
                      rules={[
                        { required: true, message: '请输入分析规则描述' },
                      ]}
                    >
                      <Input
                        disabled={isKnowledgeMutationDisabled}
                        placeholder="例如：GMV 统计口径"
                      />
                    </Form.Item>
                    <Form.Item
                      label="规则适用方式"
                      name="scope"
                      initialValue="all"
                      rules={[
                        { required: true, message: '请选择规则适用方式' },
                      ]}
                    >
                      <Select
                        disabled={isKnowledgeMutationDisabled}
                        options={[
                          { label: '默认规则（全局生效）', value: 'all' },
                          {
                            label: '匹配问题（仅命中特定问法）',
                            value: 'matched',
                          },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      label="分析规则内容"
                      name="content"
                      rules={[
                        { required: true, message: '请输入分析规则内容' },
                      ]}
                    >
                      <Input.TextArea
                        disabled={isKnowledgeMutationDisabled}
                        rows={12}
                        placeholder="请描述口径定义、字段约束、过滤条件和特殊说明。"
                      />
                    </Form.Item>
                  </WorkbenchEditorForm>
                </div>
                <div style={WORKBENCH_EDITOR_DRAWER_FOOTER_STYLE}>
                  <div style={WORKBENCH_EDITOR_DRAWER_FOOTER_GROUP_STYLE}>
                    {!isKnowledgeMutationDisabled ? (
                      <Button onClick={handleResetRuleDetailEditor}>
                        重置
                      </Button>
                    ) : null}
                  </div>
                  <div style={WORKBENCH_EDITOR_DRAWER_FOOTER_GROUP_STYLE}>
                    <Button onClick={() => void handleCloseRuleDrawer()}>
                      {isKnowledgeMutationDisabled ? '关闭' : '取消'}
                    </Button>
                    {!isKnowledgeMutationDisabled ? (
                      <Button
                        type="primary"
                        loading={
                          createInstructionLoading || updateInstructionLoading
                        }
                        onClick={() => void handleSubmitRuleDetail()}
                      >
                        保存分析规则
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Drawer>
            </>
          )}
        </WorkbenchSectionPanel>
      ) : null}
    </MainStage>
  );
}

export default KnowledgeMainStage;
