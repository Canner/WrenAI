import type { RefObject, UIEvent } from 'react';
import { Typography } from 'antd';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import {
  ExploreEmpty,
  KnowledgeDropdownPanel,
  KnowledgeDropdownSearch,
  KnowledgeDropdownSearchShell,
  KnowledgeOptionCopy,
  KnowledgeOptionItems,
  KnowledgeOptionList,
  KnowledgeOptionMain,
  KnowledgeOptionMeta,
  KnowledgeOptionRow,
} from '../homePageStyles';
import {
  getReferenceAssetCountByKnowledgeName,
  getReferenceDisplayKnowledgeName,
} from '@/utils/referenceDemoKnowledge';

const { Text } = Typography;

type KnowledgeBaseOption = {
  id: string;
  name?: string | null;
  assetCount?: number | null;
};

type HomeKnowledgePickerDropdownProps = {
  keyword: string;
  filteredKnowledgeBases: KnowledgeBaseOption[];
  selectedKnowledgeBaseIds: string[];
  visibleKnowledgeBases: KnowledgeBaseOption[];
  shouldVirtualize: boolean;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  viewportRef: RefObject<HTMLDivElement | null>;
  onKeywordChange: (value: string) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  onToggleKnowledgeBase: (knowledgeBaseId: string) => void;
};

export default function HomeKnowledgePickerDropdown({
  keyword,
  filteredKnowledgeBases,
  selectedKnowledgeBaseIds,
  visibleKnowledgeBases,
  shouldVirtualize,
  topSpacerHeight,
  bottomSpacerHeight,
  viewportRef,
  onKeywordChange,
  onScroll,
  onToggleKnowledgeBase,
}: HomeKnowledgePickerDropdownProps) {
  return (
    <KnowledgeDropdownPanel>
      <KnowledgeDropdownSearchShell>
        <SearchOutlined style={{ color: '#98a2b3', fontSize: 13 }} />
        <KnowledgeDropdownSearch
          placeholder="输入关键词搜索知识库"
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
        />
      </KnowledgeDropdownSearchShell>

      {filteredKnowledgeBases.length === 0 ? (
        <ExploreEmpty>没有匹配的知识库，换个关键词试试。</ExploreEmpty>
      ) : (
        <KnowledgeOptionList ref={viewportRef} onScroll={onScroll}>
          {shouldVirtualize && topSpacerHeight > 0 ? (
            <div style={{ height: topSpacerHeight }} aria-hidden />
          ) : null}
          <KnowledgeOptionItems>
            {visibleKnowledgeBases.map((knowledgeBase) => {
              const displayName = getReferenceDisplayKnowledgeName(
                knowledgeBase.name,
              );
              const active = selectedKnowledgeBaseIds.includes(
                knowledgeBase.id,
              );
              const tableCount =
                getReferenceAssetCountByKnowledgeName(knowledgeBase.name) ??
                knowledgeBase.assetCount ??
                0;

              return (
                <KnowledgeOptionRow
                  key={knowledgeBase.id}
                  type="button"
                  $active={active}
                  onClick={() => onToggleKnowledgeBase(knowledgeBase.id)}
                >
                  <KnowledgeOptionMain>
                    <KnowledgeOptionCopy>
                      <Text strong style={{ fontSize: 14, color: '#111827' }}>
                        {displayName}
                      </Text>
                    </KnowledgeOptionCopy>
                  </KnowledgeOptionMain>
                  <KnowledgeOptionMeta $active={active}>
                    {tableCount.toString()} 张表
                  </KnowledgeOptionMeta>
                </KnowledgeOptionRow>
              );
            })}
          </KnowledgeOptionItems>
          {shouldVirtualize && bottomSpacerHeight > 0 ? (
            <div style={{ height: bottomSpacerHeight }} aria-hidden />
          ) : null}
        </KnowledgeOptionList>
      )}
    </KnowledgeDropdownPanel>
  );
}
