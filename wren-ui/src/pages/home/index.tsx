import {
  ComponentRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from 'react';
import {
  Alert,
  Button,
  Input,
  Modal,
  Skeleton,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import type { CreateThreadInput, Thread } from '@/types/home';
import BookOutlined from '@ant-design/icons/BookOutlined';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import DatabaseOutlined from '@ant-design/icons/DatabaseOutlined';
import FundViewOutlined from '@ant-design/icons/FundViewOutlined';
import PaperClipOutlined from '@ant-design/icons/PaperClipOutlined';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import ToolOutlined from '@ant-design/icons/ToolOutlined';
import styled from 'styled-components';
import { Path } from '@/utils/enum';
import {
  buildRuntimeScopeUrl,
  ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import Prompt from '@/components/pages/home/prompt';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import useAskPrompt from '@/hooks/useAskPrompt';
import {
  createAskingTask,
  createThread,
  fetchSuggestedQuestions,
  type SuggestedQuestionsPayload,
} from '@/utils/homeRest';

import DolaAppShell from '@/components/reference/DolaAppShell';
import {
  usePersistentShellEmbedded,
  usePersistentShellHistoryRefetch,
} from '@/components/reference/PersistentShellContext';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useAuthSession from '@/hooks/useAuthSession';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import { buildNovaShellNavItems } from '@/components/reference/novaShellNavigation';
import {
  getReferenceDemoKnowledgeByName,
  getReferenceAssetCountByKnowledgeName,
  getReferenceDisplayKnowledgeName,
  getReferenceDisplayThreadTitle,
  REFERENCE_HOME_RECOMMENDATIONS,
} from '@/utils/referenceDemoKnowledge';
import {
  HISTORICAL_SNAPSHOT_READONLY_HINT,
  hasLatestExecutableSnapshot,
  isHistoricalSnapshotReadonly,
} from '@/utils/runtimeSnapshot';

const { Text, Title } = Typography;
const HOME_REFERENCE_PROMPT_PLACEHOLDER = '输入问题，@ 指定知识库';
const HOME_KNOWLEDGE_PICKER_VIRTUALIZATION_THRESHOLD = 36;
const HOME_KNOWLEDGE_PICKER_ITEM_ESTIMATED_HEIGHT = 62;
const HOME_KNOWLEDGE_PICKER_VIRTUAL_OVERSCAN = 5;

const reportHomeError = (_error: unknown, fallbackMessage: string) => {
  message.error(fallbackMessage);
};

type SkillDefinitionSummary = {
  id: string;
  name: string;
  runtimeKind?: string | null;
  sourceType?: string | null;
  connectorId?: string | null;
  kbSuggestionIds?: string[] | null;
};

type HomeSkillOption = {
  id: string;
  name: string;
  runtimeKind?: string | null;
  sourceType?: string | null;
  knowledgeBaseIds: string[];
  connectorCount: number;
};

const HOME_SKILL_OPTIONS_STORAGE_PREFIX = 'wren.homeSkillOptions';
const HOME_SKILL_OPTIONS_CACHE_TTL_MS = 2 * 60 * 1000;

type HomeRecommendationCard = {
  question: string;
  description: string;
  badge: string;
};

type HomeSkillOptionsCacheRecord = {
  value: HomeSkillOption[];
  updatedAt: number;
};

const getHomeSkillOptionsStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch (_error) {
    return null;
  }
};

const buildHomeSkillOptionsStorageKey = (workspaceId: string) =>
  `${HOME_SKILL_OPTIONS_STORAGE_PREFIX}:${workspaceId}`;

export const clearHomeSkillOptionsCacheForTests = () => {
  const storage = getHomeSkillOptionsStorage();
  if (!storage) {
    return;
  }

  const keysToRemove: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(HOME_SKILL_OPTIONS_STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => storage.removeItem(key));
};

export const normalizeHomeSkillOptions = (
  skills: SkillDefinitionSummary[],
): HomeSkillOption[] =>
  skills
    .map((skill) => {
      const knowledgeBaseIds = skill.kbSuggestionIds || [];
      return {
        id: skill.id,
        name: skill.name,
        runtimeKind: skill.runtimeKind,
        sourceType: skill.sourceType,
        knowledgeBaseIds,
        connectorCount: skill.connectorId ? 1 : 0,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));

const getCachedHomeSkillOptions = (workspaceId?: string | null) => {
  if (!workspaceId) {
    return null;
  }

  const storage = getHomeSkillOptionsStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(buildHomeSkillOptionsStorageKey(workspaceId));
    if (!raw) {
      return null;
    }

    const cached = JSON.parse(raw) as HomeSkillOptionsCacheRecord;
    if (Date.now() - cached.updatedAt > HOME_SKILL_OPTIONS_CACHE_TTL_MS) {
      storage.removeItem(buildHomeSkillOptionsStorageKey(workspaceId));
      return null;
    }

    return cached.value;
  } catch (_error) {
    storage.removeItem(buildHomeSkillOptionsStorageKey(workspaceId));
    return null;
  }
};

const cacheHomeSkillOptions = (
  workspaceId: string,
  options: HomeSkillOption[],
) => {
  const storage = getHomeSkillOptionsStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      buildHomeSkillOptionsStorageKey(workspaceId),
      JSON.stringify({
        value: options,
        updatedAt: Date.now(),
      } satisfies HomeSkillOptionsCacheRecord),
    );
  } catch (_error) {
    // ignore storage write failures in restricted browsers
  }
};

const fetchHomeSkillOptions = async (workspaceId: string) => {
  const cachedOptions = getCachedHomeSkillOptions(workspaceId);
  if (cachedOptions) {
    return cachedOptions;
  }

  const response = await fetch(
    buildRuntimeScopeUrl('/api/v1/skills/available', {}, { workspaceId }),
  );

  if (!response.ok) {
    throw new Error(`Failed to load skills (${response.status})`);
  }

  const skills = (await response.json()) as SkillDefinitionSummary[];
  const normalizedSkills = normalizeHomeSkillOptions(skills);
  cacheHomeSkillOptions(workspaceId, normalizedSkills);
  return normalizedSkills;
};

const Stage = styled.div`
  min-height: 100%;
  padding: clamp(116px, 17vh, 184px) 20px clamp(8px, 2vh, 16px);
  max-width: 920px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(22px, 3.6vh, 32px);
  background: transparent;
`;

const HeroPanel = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
`;

const HeroGreeting = styled(Title)`
  &.ant-typography {
    margin: 0 !important;
    font-size: 28px;
    line-height: 1.18;
    text-align: center;
    color: #111827;
    font-weight: 650;
  }
`;

const HeroTitle = styled(Title)`
  &.ant-typography {
    margin: 0 !important;
    font-size: 17px;
    line-height: 1.5;
    text-align: center;
    color: #6b7280;
    font-weight: 400;
    max-width: 28ch;
  }
`;

const ComposerCard = styled.div`
  border-radius: 20px;
  background: #ffffff;
  border: 1px solid #e7ecf3;
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.05);
  padding: 12px 16px;
`;

const ComposerShell = styled.div<{ $dropdownOpen?: boolean }>`
  width: min(100%, 680px);
  position: relative;
  margin-top: 10px;
`;

const SourceChip = styled.div`
  height: 28px;
  border-radius: 8px;
  background: #ffffff;
  color: #4b5563;
  border: 1px solid #e5e7eb;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
`;

const SourceChipRemove = styled.button`
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 4px;
  padding: 0;
  background: transparent;
  color: #9ca3af;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover {
    color: #6b7280;
    background: #f3f4f6;
  }
`;

const KnowledgePickerList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 18px;
  max-height: 420px;
  overflow: auto;
`;

const KnowledgePickerCard = styled.button<{ $active?: boolean }>`
  width: 100%;
  border-radius: 8px;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(141, 101, 225, 0.24)' : 'var(--nova-outline-soft)'};
  background: ${(props) =>
    props.$active ? 'rgba(123, 87, 232, 0.04)' : '#ffffff'};
  padding: 16px 18px;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease;

  &:hover {
    background: ${(props) =>
      props.$active ? 'rgba(123, 87, 232, 0.05)' : '#fafafa'};
    border-color: rgba(141, 101, 225, 0.2);
  }
`;

const RecommendationSection = styled.section`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const RecommendationRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 1180px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 860px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const RecommendationCard = styled.button<{ $accent: string }>`
  border: 1px solid #e7ecf3;
  background: #ffffff;
  border-radius: 16px;
  padding: 16px;
  text-align: left;
  cursor: pointer;
  min-height: 0;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    transform 0.2s ease;

  &:hover {
    background: #fcfdff;
    border-color: rgba(123, 87, 232, 0.18);
    transform: translateY(-1px);
  }
`;

const RecommendationIcon = styled.div<{ $accent: string }>`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: ${(props) => props.$accent};
  color: #6366f1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
`;

const ComposerScopeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
`;

const KnowledgeDropdownPanel = styled.div`
  position: absolute;
  top: calc(100% + 14px);
  left: 0;
  right: 0;
  z-index: 8;
  border: 1px solid #e7ecf3;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const KnowledgeDropdownSearchShell = styled.label`
  height: 30px;
  width: 100%;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px 8px;
  border-bottom: 1px solid #edf1f5;
`;

const KnowledgeDropdownSearch = styled.input`
  flex: 1;
  min-width: 0;
  height: auto;
  padding: 0;
  font-size: 12.5px;
  color: #4b5563;
  background: transparent;
  border: 0;
  box-shadow: none;
  outline: none;

  &::placeholder {
    color: #b8c1cf;
  }
`;

const ComposerScopeChip = styled.button`
  height: 28px;
  border-radius: 999px;
  border: 1px solid #e7ecf3;
  background: #f8fafc;
  color: #4b5563;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    color 0.2s ease;

  &:hover {
    border-color: rgba(123, 87, 232, 0.2);
    background: rgba(123, 87, 232, 0.06);
    color: #111827;
  }
`;

const ComposerPassiveChip = styled.div`
  height: 28px;
  border-radius: 999px;
  border: 1px solid #eef2f7;
  background: #fbfcfe;
  color: #6b7280;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
`;

const ComposerAtMark = styled.span`
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: rgba(123, 87, 232, 0.1);
  color: var(--nova-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
`;

const ComposerPrompt = styled(Prompt)`
  width: 100%;

  .ant-input {
    min-height: 72px !important;
    color: #111827;
  }

  .ant-input::placeholder {
    color: #b2bac8;
  }

  .prompt-send-button.ant-btn {
    width: 34px;
    height: 34px;
    border-radius: 999px;
  }
`;

const ComposerToolButton = styled.button<{ $active?: boolean }>`
  height: 28px;
  border-radius: 999px;
  border: 1px solid
    ${(props) => (props.$active ? 'rgba(123, 87, 232, 0.22)' : '#eef2f7')};
  background: ${(props) =>
    props.$active ? 'rgba(123, 87, 232, 0.08)' : '#fbfcfe'};
  color: ${(props) => (props.$active ? 'var(--nova-primary)' : '#6b7280')};
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    color 0.2s ease;

  &:hover:not(:disabled) {
    border-color: rgba(123, 87, 232, 0.16);
    background: rgba(123, 87, 232, 0.05);
    color: #111827;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }
`;

const ComposerKnowledgeAction = styled(ComposerScopeChip)`
  background: #ffffff;
`;

const ExploreHeaderBar = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  flex-wrap: wrap;
  padding-left: 4px;
`;

const ExploreTitle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
`;

const ExploreSegmented = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  background: #f5f7fb;
  border: 1px solid #edf1f6;
`;

const ExploreSegmentButton = styled.button<{
  $active?: boolean;
  $disabled?: boolean;
}>`
  height: 28px;
  border: 0;
  border-radius: 999px;
  padding: 0 14px;
  background: ${(props) => (props.$active ? '#ffffff' : 'transparent')};
  color: ${(props) =>
    props.$disabled ? '#b8c1cf' : props.$active ? '#111827' : '#6b7280'};
  box-shadow: ${(props) =>
    props.$active ? '0 1px 2px rgba(15, 23, 42, 0.08)' : 'none'};
  font-size: 12px;
  font-weight: 600;
  cursor: ${(props) => (props.$disabled ? 'not-allowed' : 'pointer')};
`;

const ExploreSourceHint = styled.div`
  width: 100%;
  padding-left: 2px;
  color: #8b93a3;
  font-size: 12px;
  line-height: 1.5;
`;

const ExploreEmpty = styled.div`
  padding: 18px 16px;
  color: #8b93a3;
  font-size: 13px;
`;

const KnowledgeOptionList = styled.div`
  display: block;
  max-height: min(380px, 44vh);
  min-height: 0;
  overflow-y: auto;
`;

const KnowledgeOptionItems = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const KnowledgeOptionRow = styled.button<{ $active?: boolean }>`
  width: 100%;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(123, 87, 232, 0.18)' : 'rgba(15, 23, 42, 0.06)'};
  background: ${(props) =>
    props.$active ? 'rgba(123, 87, 232, 0.04)' : '#ffffff'};
  border-radius: 14px;
  padding: 11px 14px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease;

  &:hover {
    background: ${(props) =>
      props.$active ? 'rgba(123, 87, 232, 0.06)' : '#fbfcfe'};
    border-color: rgba(123, 87, 232, 0.14);
  }
`;

const KnowledgeOptionMain = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const KnowledgeOptionCopy = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const KnowledgeOptionMeta = styled.div<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  color: ${(props) => (props.$active ? 'var(--nova-primary)' : '#8b93a3')};
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
`;

export const shouldLoadHomeSkillOptions = ({
  workspaceId,
  hasExecutableRuntime,
  skillPickerOpen,
  selectedSkillCount,
}: {
  workspaceId?: string | null;
  hasExecutableRuntime: boolean;
  skillPickerOpen: boolean;
  selectedSkillCount: number;
}) =>
  Boolean(
    workspaceId &&
      hasExecutableRuntime &&
      (skillPickerOpen || selectedSkillCount > 0),
  );

export const resolveAskRuntimeSelector = ({
  currentSelector,
  selectedKnowledgeBaseIds,
  workspaceId,
}: {
  currentSelector: ClientRuntimeScopeSelector;
  selectedKnowledgeBaseIds: string[];
  workspaceId?: string | null;
}): ClientRuntimeScopeSelector => {
  const primaryKnowledgeBaseId = selectedKnowledgeBaseIds[0];

  if (!primaryKnowledgeBaseId) {
    return currentSelector;
  }

  if (primaryKnowledgeBaseId === currentSelector.knowledgeBaseId) {
    return currentSelector;
  }

  return {
    ...(workspaceId || currentSelector.workspaceId
      ? { workspaceId: workspaceId || currentSelector.workspaceId }
      : {}),
    knowledgeBaseId: primaryKnowledgeBaseId,
  };
};

export const resolveCreatedThreadRuntimeSelector = ({
  fallbackSelector,
  thread,
}: {
  fallbackSelector: ClientRuntimeScopeSelector;
  thread?: Partial<Thread> | null;
}): ClientRuntimeScopeSelector => {
  const workspaceId = thread?.workspaceId || fallbackSelector.workspaceId;
  const knowledgeBaseId =
    thread?.knowledgeBaseId || fallbackSelector.knowledgeBaseId;
  const kbSnapshotId = thread?.kbSnapshotId || fallbackSelector.kbSnapshotId;
  const deployHash = thread?.deployHash || fallbackSelector.deployHash;

  return {
    ...(workspaceId ? { workspaceId } : {}),
    ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    ...(kbSnapshotId ? { kbSnapshotId } : {}),
    ...(deployHash ? { deployHash } : {}),
  };
};

type AskRuntimeKnowledgeBase = {
  id: string;
  defaultKbSnapshotId?: string | null;
};

export const resolveAskRuntimeAvailability = ({
  currentSelector,
  selectedKnowledgeBaseIds,
  knowledgeBases,
  currentKnowledgeBase,
  currentKbSnapshot,
}: {
  currentSelector: ClientRuntimeScopeSelector;
  selectedKnowledgeBaseIds: string[];
  knowledgeBases: AskRuntimeKnowledgeBase[];
  currentKnowledgeBase?: AskRuntimeKnowledgeBase | null;
  currentKbSnapshot?: { id?: string | null; deployHash?: string | null } | null;
}) => {
  const primaryKnowledgeBaseId = selectedKnowledgeBaseIds[0];
  const selectedKnowledgeBase =
    (primaryKnowledgeBaseId
      ? knowledgeBases.find(
          (knowledgeBase) => knowledgeBase.id === primaryKnowledgeBaseId,
        )
      : null) ||
    currentKnowledgeBase ||
    null;
  const switchingKnowledgeBase = Boolean(
    primaryKnowledgeBaseId &&
      primaryKnowledgeBaseId !== currentSelector.knowledgeBaseId,
  );

  if (switchingKnowledgeBase) {
    return {
      hasExecutableRuntime: Boolean(selectedKnowledgeBase?.defaultKbSnapshotId),
      isHistoricalRuntimeReadonly: false,
    };
  }

  const selectorHasRuntime = Boolean(
    currentSelector.deployHash ||
      currentSelector.kbSnapshotId ||
      currentKbSnapshot?.deployHash ||
      currentKbSnapshot?.id,
  );

  return {
    hasExecutableRuntime: hasLatestExecutableSnapshot({
      selectorHasRuntime,
      currentKbSnapshotId: currentKbSnapshot?.id,
      defaultKbSnapshotId: selectedKnowledgeBase?.defaultKbSnapshotId,
    }),
    isHistoricalRuntimeReadonly: isHistoricalSnapshotReadonly({
      selectorHasRuntime,
      currentKbSnapshotId: currentKbSnapshot?.id,
      defaultKbSnapshotId: selectedKnowledgeBase?.defaultKbSnapshotId,
    }),
  };
};

export default function Home() {
  const $prompt = useRef<ComponentRef<typeof Prompt>>(null);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const knowledgeListViewportRef = useRef<HTMLDivElement | null>(null);
  const promptSubmitInFlightRef = useRef(false);
  const skillOptionsRequestRef = useRef<Promise<HomeSkillOption[]> | null>(
    null,
  );
  const skillOptionsRequestWorkspaceRef = useRef<string | null>(null);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const authSession = useAuthSession({ includeWorkspaceQuery: false });
  const persistentShellEmbedded = usePersistentShellEmbedded();
  const refetchPersistentShellHistory = usePersistentShellHistoryRefetch();
  const homeSidebar = useHomeSidebar({
    deferInitialLoad: false,
    loadOnIntent: false,
    disabled: persistentShellEmbedded,
  });
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false);
  const [knowledgeKeyword, setKnowledgeKeyword] = useState('');
  const [selectedKnowledgeBaseIds, setSelectedKnowledgeBaseIds] = useState<
    string[]
  >([]);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillKeyword, setSkillKeyword] = useState('');
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [draftSelectedSkillIds, setDraftSelectedSkillIds] = useState<string[]>(
    [],
  );
  const [skillOptionSource, setSkillOptionSource] = useState<HomeSkillOption[]>(
    [],
  );
  const [suggestedQuestionsData, setSuggestedQuestionsData] =
    useState<SuggestedQuestionsPayload | null>(null);
  const [skillOptionsLoading, setSkillOptionsLoading] = useState(false);
  const [skillOptionsError, setSkillOptionsError] = useState<string | null>(
    null,
  );
  const [knowledgeListScrollTop, setKnowledgeListScrollTop] = useState(0);
  const [knowledgeListViewportHeight, setKnowledgeListViewportHeight] =
    useState(0);

  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;
  const currentKnowledgeBases = runtimeSelectorState?.knowledgeBases || [];
  const {
    hasExecutableRuntime: hasExecutableAskRuntime,
    isHistoricalRuntimeReadonly: isAskRuntimeHistoricalReadonly,
  } = useMemo(
    () =>
      resolveAskRuntimeAvailability({
        currentSelector: runtimeScopeNavigation.selector,
        selectedKnowledgeBaseIds,
        knowledgeBases: currentKnowledgeBases,
        currentKnowledgeBase: runtimeSelectorState?.currentKnowledgeBase,
        currentKbSnapshot: runtimeSelectorState?.currentKbSnapshot,
      }),
    [
      currentKnowledgeBases,
      runtimeScopeNavigation.selector,
      runtimeSelectorState?.currentKbSnapshot,
      runtimeSelectorState?.currentKnowledgeBase,
      selectedKnowledgeBaseIds,
    ],
  );
  const skillOptions = useMemo(
    () =>
      skillOptionSource
        .map((option) => ({
          ...option,
          recommendationScore: option.knowledgeBaseIds.filter(
            (knowledgeBaseId) =>
              selectedKnowledgeBaseIds.includes(knowledgeBaseId),
          ).length,
        }))
        .sort((left, right) => {
          const scoreDiff =
            right.recommendationScore - left.recommendationScore;
          if (scoreDiff !== 0) {
            return scoreDiff;
          }

          return left.name.localeCompare(right.name, 'zh-CN');
        })
        .map(
          ({ recommendationScore: _recommendationScore, ...option }) => option,
        ),
    [selectedKnowledgeBaseIds, skillOptionSource],
  );
  const askRuntimeSelector = useMemo(
    () =>
      resolveAskRuntimeSelector({
        currentSelector: runtimeScopeNavigation.selector,
        selectedKnowledgeBaseIds,
        workspaceId: runtimeSelectorState?.currentWorkspace?.id,
      }),
    [
      runtimeScopeNavigation.selector,
      runtimeSelectorState?.currentWorkspace?.id,
      selectedKnowledgeBaseIds,
    ],
  );
  const askPrompt = useAskPrompt(
    undefined,
    {
      knowledgeBaseIds:
        selectedKnowledgeBaseIds.length > 0
          ? selectedKnowledgeBaseIds
          : undefined,
      selectedSkillIds:
        selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
    },
    undefined,
    askRuntimeSelector,
  );

  useEffect(() => {
    let cancelled = false;

    if (!runtimeScopePage.hasRuntimeScope || !hasExecutableAskRuntime) {
      setSuggestedQuestionsData(null);
      return () => {
        cancelled = true;
      };
    }

    void fetchSuggestedQuestions(askRuntimeSelector)
      .then((payload) => {
        if (!cancelled) {
          setSuggestedQuestionsData(payload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestedQuestionsData(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    askRuntimeSelector,
    hasExecutableAskRuntime,
    runtimeScopePage.hasRuntimeScope,
  ]);

  useEffect(() => {
    let cancelled = false;
    const workspaceId = runtimeScopeNavigation.selector.workspaceId;
    const cachedSkillOptions = getCachedHomeSkillOptions(workspaceId);

    if (!workspaceId || !hasExecutableAskRuntime) {
      setSkillOptionSource([]);
      setSelectedSkillIds([]);
      setSkillOptionsLoading(false);
      setSkillOptionsError(null);
      return () => {
        cancelled = true;
      };
    }

    if (cachedSkillOptions) {
      setSkillOptionSource(cachedSkillOptions);
      setSkillOptionsError(null);
    }

    if (
      !shouldLoadHomeSkillOptions({
        workspaceId,
        hasExecutableRuntime: hasExecutableAskRuntime,
        skillPickerOpen,
        selectedSkillCount: selectedSkillIds.length,
      })
    ) {
      setSkillOptionsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (cachedSkillOptions) {
      return () => {
        cancelled = true;
      };
    }

    const loadSkillOptions = async () => {
      setSkillOptionsLoading(true);
      setSkillOptionsError(null);
      let request: Promise<HomeSkillOption[]> | null = null;

      try {
        request =
          skillOptionsRequestWorkspaceRef.current === workspaceId
            ? skillOptionsRequestRef.current
            : null;
        if (!request) {
          request = fetchHomeSkillOptions(workspaceId);
          skillOptionsRequestRef.current = request;
          skillOptionsRequestWorkspaceRef.current = workspaceId;
        }
        skillOptionsRequestRef.current = request;
        const skills = await request;

        if (cancelled) {
          return;
        }

        setSkillOptionSource(skills);
      } catch (_error) {
        if (!cancelled) {
          setSkillOptionSource([]);
          setSkillOptionsError('加载技能列表失败，请稍后重试。');
          message.error('加载技能列表失败，请稍后重试。');
        }
      } finally {
        if (skillOptionsRequestRef.current === request) {
          skillOptionsRequestRef.current = null;
          skillOptionsRequestWorkspaceRef.current = null;
        }
        if (!cancelled) {
          setSkillOptionsLoading(false);
        }
      }
    };

    void loadSkillOptions();

    return () => {
      cancelled = true;
    };
  }, [
    hasExecutableAskRuntime,
    selectedSkillIds.length,
    skillPickerOpen,
    runtimeScopeNavigation.selector.workspaceId,
  ]);

  useEffect(() => {
    setSelectedSkillIds((previous) =>
      previous.filter((skillId) =>
        skillOptions.some((option) => option.id === skillId),
      ),
    );
  }, [skillOptions]);

  useEffect(() => {
    if (!knowledgePickerOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        composerShellRef.current &&
        !composerShellRef.current.contains(event.target as Node)
      ) {
        setKnowledgePickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [knowledgePickerOpen]);

  useEffect(() => {
    if (!knowledgePickerOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setKnowledgePickerOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [knowledgePickerOpen]);

  const recommendationKnowledgeBaseName = useMemo(() => {
    if (selectedKnowledgeBaseIds.length > 0) {
      const selectedKnowledgeBase = currentKnowledgeBases.find(
        (knowledgeBase) => knowledgeBase.id === selectedKnowledgeBaseIds[0],
      );
      if (selectedKnowledgeBase?.name) {
        return selectedKnowledgeBase.name;
      }
    }

    return runtimeSelectorState?.currentKnowledgeBase?.name || '';
  }, [
    currentKnowledgeBases,
    runtimeSelectorState?.currentKnowledgeBase?.name,
    selectedKnowledgeBaseIds,
  ]);

  const matchedDemoKnowledge = useMemo(
    () => getReferenceDemoKnowledgeByName(recommendationKnowledgeBaseName),
    [recommendationKnowledgeBaseName],
  );

  const sampleQuestions = useMemo(
    () => suggestedQuestionsData?.questions || [],
    [suggestedQuestionsData],
  );

  const recommendationCards = useMemo<HomeRecommendationCard[]>(() => {
    if (matchedDemoKnowledge) {
      const primaryQuestions = matchedDemoKnowledge.suggestedQuestions;
      const fallbackQuestion =
        REFERENCE_HOME_RECOMMENDATIONS[1]?.question ||
        REFERENCE_HOME_RECOMMENDATIONS[0]?.question;

      return [
        {
          question:
            primaryQuestions[0] || REFERENCE_HOME_RECOMMENDATIONS[0].question,
          description: '从当前知识库里快速切入最值得先看的核心指标与排行。',
          badge: '热门',
        },
        {
          question: primaryQuestions[1] || fallbackQuestion,
          description: '继续深挖结构化明细，直接衔接下一轮分析或图表生成。',
          badge: '最新',
        },
        {
          question:
            primaryQuestions[2] || REFERENCE_HOME_RECOMMENDATIONS[2].question,
          description: '把多张表串起来做综合诊断，快速验证业务假设。',
          badge: '热门',
        },
      ];
    }

    if (sampleQuestions.length === 0) {
      return REFERENCE_HOME_RECOMMENDATIONS;
    }

    return sampleQuestions
      .filter(
        (item): item is NonNullable<(typeof sampleQuestions)[number]> =>
          item !== null,
      )
      .slice(0, 3)
      .map(
        (
          item: NonNullable<(typeof sampleQuestions)[number]>,
          index: number,
        ) => ({
          question: item.question,
          description:
            index === 0
              ? '快速查看关键指标、变化原因与接下来的建议追问。'
              : index === 1
                ? '围绕当前知识库中的重点数据表，生成可直接发起的分析问题。'
                : '把复杂问题拆成可执行的问题入口，降低首次提问门槛。',
          badge: index === 1 ? '最新' : '热门',
        }),
      );
  }, [matchedDemoKnowledge, sampleQuestions]);

  const recommendationSourceHint = useMemo(() => {
    if (matchedDemoKnowledge) {
      const displayName = getReferenceDisplayKnowledgeName(
        recommendationKnowledgeBaseName || matchedDemoKnowledge.name,
      );
      return `问题来自「${displayName}」知识库的示例问题，可直接点击提问。`;
    }

    if (sampleQuestions.length > 0) {
      return '问题来自当前运行时的样例题库，可直接点击提问。';
    }

    return '问题来自系统默认模板，可作为提问起点。';
  }, [
    matchedDemoKnowledge,
    recommendationKnowledgeBaseName,
    sampleQuestions.length,
  ]);

  const historyItems = useMemo(
    () =>
      (homeSidebar.data?.threads || []).map((thread) => ({
        id: thread.id,
        title: getReferenceDisplayThreadTitle(thread.name),
        active: false,
        selector: thread.selector,
      })),
    [homeSidebar.data?.threads],
  );

  const selectedKnowledgeBases = useMemo(() => {
    return selectedKnowledgeBaseIds
      .map((id) => currentKnowledgeBases.find((item) => item.id === id))
      .filter(
        (item): item is NonNullable<(typeof currentKnowledgeBases)[number]> =>
          Boolean(item),
      );
  }, [currentKnowledgeBases, selectedKnowledgeBaseIds]);
  const filteredKnowledgeBases = useMemo(() => {
    const query = knowledgeKeyword.trim().toLowerCase();
    const knowledgeBases = currentKnowledgeBases;
    if (!query) {
      return knowledgeBases;
    }

    return knowledgeBases.filter((item) => {
      const displayName = getReferenceDisplayKnowledgeName(item.name);
      return (
        item.name?.toLowerCase().includes(query) ||
        displayName.toLowerCase().includes(query)
      );
    });
  }, [currentKnowledgeBases, knowledgeKeyword]);
  const shouldVirtualizeKnowledgeList =
    filteredKnowledgeBases.length >=
    HOME_KNOWLEDGE_PICKER_VIRTUALIZATION_THRESHOLD;
  const knowledgeVirtualWindow = useMemo(() => {
    if (!shouldVirtualizeKnowledgeList) {
      return {
        startIndex: 0,
        endIndex: filteredKnowledgeBases.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const viewportHeight = Math.max(
      knowledgeListViewportHeight,
      HOME_KNOWLEDGE_PICKER_ITEM_ESTIMATED_HEIGHT,
    );
    const visibleCount = Math.max(
      1,
      Math.ceil(viewportHeight / HOME_KNOWLEDGE_PICKER_ITEM_ESTIMATED_HEIGHT),
    );
    const startIndex = Math.max(
      0,
      Math.floor(
        knowledgeListScrollTop / HOME_KNOWLEDGE_PICKER_ITEM_ESTIMATED_HEIGHT,
      ) - HOME_KNOWLEDGE_PICKER_VIRTUAL_OVERSCAN,
    );
    const endIndex = Math.min(
      filteredKnowledgeBases.length,
      startIndex + visibleCount + HOME_KNOWLEDGE_PICKER_VIRTUAL_OVERSCAN * 2,
    );

    return {
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * HOME_KNOWLEDGE_PICKER_ITEM_ESTIMATED_HEIGHT,
      bottomSpacerHeight:
        (filteredKnowledgeBases.length - endIndex) *
        HOME_KNOWLEDGE_PICKER_ITEM_ESTIMATED_HEIGHT,
    };
  }, [
    filteredKnowledgeBases.length,
    knowledgeListScrollTop,
    knowledgeListViewportHeight,
    shouldVirtualizeKnowledgeList,
  ]);
  const visibleKnowledgeBases = useMemo(
    () =>
      filteredKnowledgeBases.slice(
        knowledgeVirtualWindow.startIndex,
        knowledgeVirtualWindow.endIndex,
      ),
    [
      filteredKnowledgeBases,
      knowledgeVirtualWindow.endIndex,
      knowledgeVirtualWindow.startIndex,
    ],
  );
  const filteredSkillOptions = useMemo(() => {
    const query = skillKeyword.trim().toLowerCase();
    if (!query) {
      return skillOptions;
    }

    return skillOptions.filter((option) => {
      const knowledgeNames = option.knowledgeBaseIds
        .map((knowledgeBaseId) => {
          const matched = currentKnowledgeBases.find(
            (item) => item.id === knowledgeBaseId,
          );
          return getReferenceDisplayKnowledgeName(
            matched?.name || knowledgeBaseId,
          );
        })
        .join(' ');

      return (
        option.name.toLowerCase().includes(query) ||
        `${option.runtimeKind || ''} ${option.sourceType || ''} ${knowledgeNames}`
          .toLowerCase()
          .includes(query)
      );
    });
  }, [currentKnowledgeBases, skillKeyword, skillOptions]);

  useEffect(() => {
    if (!knowledgePickerOpen || !shouldVirtualizeKnowledgeList) {
      setKnowledgeListScrollTop(0);
      return;
    }

    const viewport = knowledgeListViewportRef.current;
    if (!viewport) {
      return;
    }

    const measureViewport = () => {
      setKnowledgeListViewportHeight(viewport.clientHeight);
    };

    viewport.scrollTop = 0;
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
  }, [
    filteredKnowledgeBases.length,
    knowledgePickerOpen,
    shouldVirtualizeKnowledgeList,
  ]);
  useEffect(() => {
    if (!knowledgePickerOpen) {
      return;
    }

    setKnowledgeListScrollTop(0);
    if (knowledgeListViewportRef.current) {
      knowledgeListViewportRef.current.scrollTop = 0;
    }
  }, [knowledgeKeyword, knowledgePickerOpen]);

  const handleKnowledgeListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!shouldVirtualizeKnowledgeList) {
        return;
      }
      setKnowledgeListScrollTop(event.currentTarget.scrollTop);
    },
    [shouldVirtualizeKnowledgeList],
  );
  const openKnowledgePicker = () => {
    setKnowledgeKeyword('');
    setKnowledgeListScrollTop(0);
    setKnowledgePickerOpen(true);
  };

  const toggleKnowledgePicker = () => {
    if (knowledgePickerOpen) {
      setKnowledgePickerOpen(false);
      return;
    }

    openKnowledgePicker();
  };

  const openSkillPicker = () => {
    setDraftSelectedSkillIds(selectedSkillIds);
    setSkillKeyword('');
    setSkillPickerOpen(true);
  };

  const toggleDraftSkill = (skillId: string) => {
    setDraftSelectedSkillIds((previous) =>
      previous.includes(skillId)
        ? previous.filter((item) => item !== skillId)
        : [...previous, skillId],
    );
  };

  const applyKnowledgeSelection = (knowledgeBaseId: string) => {
    if (!knowledgeBaseId) {
      return;
    }

    setSelectedKnowledgeBaseIds((previous) =>
      previous.includes(knowledgeBaseId)
        ? previous.filter((item) => item !== knowledgeBaseId)
        : [...previous, knowledgeBaseId],
    );
  };

  const removeKnowledgeSelection = (knowledgeBaseId: string) => {
    if (!knowledgeBaseId) {
      return;
    }

    setSelectedKnowledgeBaseIds((previous) =>
      previous.filter((item) => item !== knowledgeBaseId),
    );
  };

  const applySkillSelection = () => {
    setSelectedSkillIds(draftSelectedSkillIds);
    setSkillPickerOpen(false);
  };

  const handlePromptSubmit = async (value: string) => {
    if (promptSubmitInFlightRef.current) {
      return;
    }

    if (!hasExecutableAskRuntime) {
      message.warning(
        isAskRuntimeHistoricalReadonly
          ? HISTORICAL_SNAPSHOT_READONLY_HINT
          : '当前没有可用的知识库运行范围。',
      );
      return;
    }

    promptSubmitInFlightRef.current = true;
    try {
      const normalizedQuestion = value.trim();
      if (!normalizedQuestion) {
        return;
      }

      askPrompt.onStopPolling();

      const askingTaskResponse = await createAskingTask(askRuntimeSelector, {
        question: normalizedQuestion,
        ...(selectedKnowledgeBaseIds.length > 0
          ? { knowledgeBaseIds: selectedKnowledgeBaseIds }
          : {}),
        ...(selectedSkillIds.length > 0 ? { selectedSkillIds } : {}),
      });
      const taskId = askingTaskResponse.id;

      if (!taskId) {
        throw new Error('创建问答任务失败');
      }

      const response = await createThread(askRuntimeSelector, {
        question: normalizedQuestion,
        taskId,
        ...(selectedKnowledgeBaseIds.length > 0
          ? { knowledgeBaseIds: selectedKnowledgeBaseIds }
          : {}),
        ...(selectedSkillIds.length > 0 ? { selectedSkillIds } : {}),
      });
      const threadId = response.id;
      const threadRuntimeSelector = resolveCreatedThreadRuntimeSelector({
        fallbackSelector: askRuntimeSelector,
        thread: response,
      });

      if (!threadId) {
        throw new Error('创建对话失败');
      }

      if (persistentShellEmbedded) {
        void refetchPersistentShellHistory();
      } else {
        void homeSidebar.refetch();
      }

      await runtimeScopeNavigation.push(
        `${Path.Home}/${threadId}`,
        {
          ...(selectedKnowledgeBaseIds.length > 0
            ? { knowledgeBaseIds: selectedKnowledgeBaseIds.join(',') }
            : {}),
        },
        threadRuntimeSelector,
      );
    } catch (error) {
      reportHomeError(error, '创建对话失败，请稍后重试');
    } finally {
      promptSubmitInFlightRef.current = false;
    }
  };

  const onCreateResponse = async (payload: CreateThreadInput) => {
    try {
      askPrompt.onStopPolling();
      const response = await createThread(askRuntimeSelector, {
        ...payload,
        ...(selectedKnowledgeBaseIds.length > 0
          ? { knowledgeBaseIds: selectedKnowledgeBaseIds }
          : {}),
        ...(selectedSkillIds.length > 0 ? { selectedSkillIds } : {}),
      });
      const threadId = response.id;
      const threadRuntimeSelector = resolveCreatedThreadRuntimeSelector({
        fallbackSelector: askRuntimeSelector,
        thread: response,
      });
      if (!threadId) {
        throw new Error('创建对话失败');
      }
      if (persistentShellEmbedded) {
        void refetchPersistentShellHistory();
      } else {
        void homeSidebar.refetch();
      }
      await runtimeScopeNavigation.push(
        `${Path.Home}/${threadId}`,
        {
          ...(selectedKnowledgeBaseIds.length > 0
            ? { knowledgeBaseIds: selectedKnowledgeBaseIds.join(',') }
            : {}),
        },
        threadRuntimeSelector,
      );
    } catch (error) {
      reportHomeError(error, '创建对话失败，请稍后重试');
    }
  };

  const selectedSkillLabel =
    selectedSkillIds.length > 0
      ? `已选 ${selectedSkillIds.length} 个技能`
      : null;
  const homePromptPlaceholder = HOME_REFERENCE_PROMPT_PLACEHOLDER;
  const heroUserName = useMemo(() => {
    const displayName = authSession.data?.user?.displayName?.trim();
    if (displayName) {
      return displayName;
    }

    const email = authSession.data?.user?.email?.trim();
    if (!email) {
      return null;
    }

    return email.split('@')[0]?.trim() || email;
  }, [authSession.data?.user?.displayName, authSession.data?.user?.email]);

  const homePageLoading = runtimeScopePage.guarding;

  if (homePageLoading) {
    const loadingContent = (
      <Stage>
        <Space
          direction="vertical"
          size={20}
          style={{ width: '100%', maxWidth: 720 }}
        >
          <Skeleton active title={{ width: '38%' }} paragraph={{ rows: 5 }} />
          <Skeleton.Button
            active
            block
            style={{ height: 148, width: '100%' }}
          />
        </Space>
      </Stage>
    );

    if (persistentShellEmbedded) {
      return loadingContent;
    }

    return (
      <DolaAppShell
        navItems={buildNovaShellNavItems({
          activeKey: 'home',
          onNavigate: runtimeScopeNavigation.pushWorkspace,
        })}
        historyItems={historyItems}
        historyLoading={homeSidebar.loading && historyItems.length === 0}
        onHistoryIntent={homeSidebar.ensureLoaded}
      >
        {loadingContent}
      </DolaAppShell>
    );
  }

  const pageContent = (
    <Stage>
      <HeroPanel>
        <HeroGreeting level={1}>
          {heroUserName ? `你好，${heroUserName}` : '你好'}
        </HeroGreeting>
        <HeroTitle level={2}>我是你的数据AI助手，我能为你做什么？</HeroTitle>

        <ComposerShell
          ref={composerShellRef}
          $dropdownOpen={knowledgePickerOpen}
        >
          <ComposerCard>
            <ComposerScopeRow>
              {selectedKnowledgeBases.map((knowledgeBase) => (
                <SourceChip key={knowledgeBase.id}>
                  <BookOutlined />
                  <span>
                    {getReferenceDisplayKnowledgeName(knowledgeBase.name)}
                  </span>
                  <SourceChipRemove
                    type="button"
                    aria-label={`移除知识库 ${getReferenceDisplayKnowledgeName(
                      knowledgeBase.name,
                    )}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      removeKnowledgeSelection(knowledgeBase.id);
                    }}
                  >
                    <CloseOutlined />
                  </SourceChipRemove>
                </SourceChip>
              ))}
              <ComposerKnowledgeAction
                type="button"
                onClick={toggleKnowledgePicker}
              >
                <ComposerAtMark>@</ComposerAtMark>
                <span>指定知识库</span>
              </ComposerKnowledgeAction>
              {selectedSkillLabel ? (
                <ComposerPassiveChip>
                  <ToolOutlined />
                  <span>{selectedSkillLabel}</span>
                </ComposerPassiveChip>
              ) : null}
            </ComposerScopeRow>

            <ComposerPrompt
              ref={$prompt}
              {...askPrompt}
              onSubmit={handlePromptSubmit}
              onCreateResponse={onCreateResponse}
              showInlineResult={false}
              inputProps={{
                ...askPrompt.inputProps,
                placeholder: homePromptPlaceholder,
              }}
              variant="embedded"
              buttonMode="icon"
              inputLayout="stacked"
              onAtTrigger={openKnowledgePicker}
              footerContent={
                <>
                  <ComposerToolButton type="button" disabled>
                    <FundViewOutlined />
                    <span>模式</span>
                  </ComposerToolButton>
                  <ComposerToolButton
                    type="button"
                    onClick={openSkillPicker}
                    disabled={skillOptionsLoading}
                  >
                    <ToolOutlined />
                    <span>技能</span>
                  </ComposerToolButton>
                  <ComposerToolButton type="button" disabled>
                    <PaperClipOutlined />
                    <span>文件</span>
                  </ComposerToolButton>
                </>
              }
            />
          </ComposerCard>

          {knowledgePickerOpen ? (
            <KnowledgeDropdownPanel>
              <KnowledgeDropdownSearchShell>
                <SearchOutlined style={{ color: '#98a2b3', fontSize: 13 }} />
                <KnowledgeDropdownSearch
                  placeholder="输入关键词搜索知识库"
                  value={knowledgeKeyword}
                  onChange={(event) => setKnowledgeKeyword(event.target.value)}
                />
              </KnowledgeDropdownSearchShell>

              {filteredKnowledgeBases.length === 0 ? (
                <ExploreEmpty>没有匹配的知识库，换个关键词试试。</ExploreEmpty>
              ) : (
                <KnowledgeOptionList
                  ref={knowledgeListViewportRef}
                  onScroll={handleKnowledgeListScroll}
                >
                  {shouldVirtualizeKnowledgeList &&
                  knowledgeVirtualWindow.topSpacerHeight > 0 ? (
                    <div
                      style={{ height: knowledgeVirtualWindow.topSpacerHeight }}
                      aria-hidden
                    />
                  ) : null}
                  <KnowledgeOptionItems>
                    {visibleKnowledgeBases.map((knowledgeBase) => {
                      const displayName = getReferenceDisplayKnowledgeName(
                        knowledgeBase.name,
                      );
                      const active = selectedKnowledgeBaseIds.includes(
                        knowledgeBase.id,
                      );
                      const tableCount = getReferenceAssetCountByKnowledgeName(
                        knowledgeBase.name,
                      );

                      return (
                        <KnowledgeOptionRow
                          key={knowledgeBase.id}
                          type="button"
                          $active={active}
                          onClick={() =>
                            applyKnowledgeSelection(knowledgeBase.id)
                          }
                        >
                          <KnowledgeOptionMain>
                            <KnowledgeOptionCopy>
                              <Text
                                strong
                                style={{ fontSize: 14, color: '#111827' }}
                              >
                                {displayName}
                              </Text>
                            </KnowledgeOptionCopy>
                          </KnowledgeOptionMain>
                          <KnowledgeOptionMeta $active={active}>
                            {(tableCount || 0).toString()} 张表
                          </KnowledgeOptionMeta>
                        </KnowledgeOptionRow>
                      );
                    })}
                  </KnowledgeOptionItems>
                  {shouldVirtualizeKnowledgeList &&
                  knowledgeVirtualWindow.bottomSpacerHeight > 0 ? (
                    <div
                      style={{
                        height: knowledgeVirtualWindow.bottomSpacerHeight,
                      }}
                      aria-hidden
                    />
                  ) : null}
                </KnowledgeOptionList>
              )}
            </KnowledgeDropdownPanel>
          ) : null}
        </ComposerShell>
      </HeroPanel>

      <RecommendationSection>
        <ExploreHeaderBar>
          <ExploreTitle>探索</ExploreTitle>
          <ExploreSegmented>
            <ExploreSegmentButton type="button" $active>
              案例广场
            </ExploreSegmentButton>
            <ExploreSegmentButton type="button" $disabled disabled>
              推荐模板
            </ExploreSegmentButton>
          </ExploreSegmented>
          <ExploreSourceHint>{recommendationSourceHint}</ExploreSourceHint>
        </ExploreHeaderBar>
        <RecommendationRow>
          {recommendationCards.map((card, index) => {
            const iconAccent = '#f3f4f6';

            return (
              <RecommendationCard
                key={card.question}
                type="button"
                $accent={iconAccent}
                onClick={() => $prompt.current?.submit(card.question)}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 14,
                  }}
                >
                  <RecommendationIcon $accent={iconAccent}>
                    {index === 0 ? (
                      <FundViewOutlined />
                    ) : index === 1 ? (
                      <DatabaseOutlined />
                    ) : (
                      <BookOutlined />
                    )}
                  </RecommendationIcon>
                  <Tag
                    style={{
                      marginInlineEnd: 0,
                      borderRadius: 999,
                      borderColor: 'transparent',
                      color:
                        card.badge === '最新'
                          ? 'var(--nova-primary)'
                          : '#8a6b54',
                      background:
                        card.badge === '最新'
                          ? 'rgba(141, 101, 225, 0.08)'
                          : 'rgba(239, 225, 209, 0.56)',
                    }}
                  >
                    {card.badge}
                  </Tag>
                </div>
                <Text
                  strong
                  style={{
                    display: 'block',
                    fontSize: 16,
                    color: '#1d2435',
                    lineHeight: 1.6,
                  }}
                >
                  {card.question}
                </Text>
              </RecommendationCard>
            );
          })}
        </RecommendationRow>
      </RecommendationSection>

      <Modal
        visible={skillPickerOpen}
        title="选择本次对话要启用的技能"
        okText="确认技能范围"
        cancelText="取消"
        onOk={applySkillSelection}
        onCancel={() => setSkillPickerOpen(false)}
        width={720}
      >
        <Text type="secondary" style={{ display: 'block', lineHeight: 1.8 }}>
          技能只会在当前 thread 内生效。你可以按需选择一个或多个技能，
          让这次问答直接带上对应的分析能力。
        </Text>
        <Input
          style={{ marginTop: 16 }}
          prefix={<SearchOutlined style={{ color: '#98a2b3' }} />}
          placeholder="搜索技能名称、类型或关联知识库"
          value={skillKeyword}
          onChange={(event) => setSkillKeyword(event.target.value)}
        />
        <KnowledgePickerList>
          {skillOptionsError ? (
            <Alert
              style={{ marginBottom: 12 }}
              type="error"
              showIcon
              message={skillOptionsError}
            />
          ) : null}
          {skillOptionsLoading ? (
            <Text type="secondary">正在加载技能列表…</Text>
          ) : filteredSkillOptions.length === 0 ? (
            <Space
              direction="vertical"
              size={12}
              style={{ width: '100%', paddingTop: 8 }}
            >
              <Text type="secondary">
                当前工作区还没有可用技能。你可以先去技能管理页安装或创建 runtime
                skill。
              </Text>
              <Button
                type="default"
                onClick={() => {
                  setSkillPickerOpen(false);
                  runtimeScopeNavigation.pushWorkspace(Path.SettingsSkills);
                }}
              >
                去配置技能
              </Button>
            </Space>
          ) : (
            filteredSkillOptions.map((skillOption) => {
              const active = draftSelectedSkillIds.includes(skillOption.id);
              const knowledgeSummary = skillOption.knowledgeBaseIds
                .map((knowledgeBaseId) => {
                  const matchedKnowledgeBase = currentKnowledgeBases.find(
                    (item) => item.id === knowledgeBaseId,
                  );
                  return getReferenceDisplayKnowledgeName(
                    matchedKnowledgeBase?.name || knowledgeBaseId,
                  );
                })
                .join(' · ');

              return (
                <KnowledgePickerCard
                  key={skillOption.id}
                  type="button"
                  $active={active}
                  onClick={() => toggleDraftSkill(skillOption.id)}
                >
                  <Space
                    direction="vertical"
                    size={6}
                    style={{ width: '100%' }}
                  >
                    <Space align="center" size={10} wrap>
                      <Text strong style={{ fontSize: 15 }}>
                        {skillOption.name}
                      </Text>
                      <Tag
                        style={{
                          marginInlineEnd: 0,
                          borderRadius: 999,
                          borderColor: 'transparent',
                          background: 'rgba(141, 101, 225, 0.08)',
                          color: 'var(--nova-primary)',
                        }}
                      >
                        {skillOption.runtimeKind || 'skill'}
                      </Tag>
                      {active ? (
                        <Tag
                          style={{
                            marginInlineEnd: 0,
                            borderRadius: 999,
                            borderColor: 'transparent',
                            background: 'rgba(15, 23, 42, 0.06)',
                            color: '#4a5263',
                          }}
                        >
                          已选
                        </Tag>
                      ) : null}
                    </Space>
                    <Text type="secondary">
                      推荐知识库：{knowledgeSummary || '全工作区可用'}
                      {skillOption.connectorCount > 0
                        ? ` · ${skillOption.connectorCount} 个连接器`
                        : ''}
                    </Text>
                  </Space>
                </KnowledgePickerCard>
              );
            })
          )}
        </KnowledgePickerList>
      </Modal>
    </Stage>
  );

  if (persistentShellEmbedded) {
    return pageContent;
  }

  return (
    <DolaAppShell
      navItems={buildNovaShellNavItems({
        activeKey: 'home',
        onNavigate: runtimeScopeNavigation.pushWorkspace,
      })}
      historyItems={historyItems}
      historyLoading={homeSidebar.loading && historyItems.length === 0}
      onHistoryIntent={homeSidebar.ensureLoaded}
    >
      {pageContent}
    </DolaAppShell>
  );
}
