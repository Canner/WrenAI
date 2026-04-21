import { type RefObject } from 'react';
import { Button, Input, Typography } from 'antd';
import styled from 'styled-components';
import {
  DolaShellHistoryItem,
  hasShellHistoryIntent,
  shouldPrefetchShellIntent,
} from './dolaShellUtils';

const { Text } = Typography;

type Props = {
  collapsed: boolean;
  historyLoading: boolean;
  historyTitle: string;
  historyEmptyText: string;
  searchPlaceholder: string;
  keyword: string;
  onHistoryIntent: () => void;
  onKeywordChange: (keyword: string) => void;
  historyScrollerRef: RefObject<HTMLDivElement | null>;
  filteredHistory: DolaShellHistoryItem[];
  visibleHistoryItems: DolaShellHistoryItem[];
  shouldVirtualizeHistory: boolean;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  onHistoryPrefetch: (item: DolaShellHistoryItem) => void;
  onHistorySelect: (item: DolaShellHistoryItem) => void;
};

const SearchInput = styled(Input)`
  && {
    border-radius: 10px;
    height: 34px;
    padding-inline: 10px;
    border-color: #e5e7eb;
    box-shadow: none;

    &:hover,
    &:focus,
    &.ant-input-affix-wrapper-focused {
      border-color: #cbd5e1;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.08);
    }

    .ant-input {
      font-size: 13px;
      background: transparent;
    }
  }
`;

const HistorySection = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px 0;
`;

const HistoryScroller = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const HistoryButton = styled(Button)<{ $active?: boolean }>`
  && {
    height: auto;
    border: 0;
    border-radius: 10px;
    padding: 8px 10px;
    text-align: left;
    justify-content: flex-start;
    background: ${(props) =>
      props.$active ? 'rgba(79, 70, 229, 0.1)' : 'transparent'};
    color: ${(props) => (props.$active ? '#312e81' : '#374151')};
    box-shadow: none;

    &:hover,
    &:focus {
      background: ${(props) =>
        props.$active
          ? 'rgba(79, 70, 229, 0.14)'
          : 'rgba(229, 231, 235, 0.55)'};
      color: ${(props) => (props.$active ? '#312e81' : '#111827')};
    }

    .ant-btn-icon {
      display: none;
    }
  }
`;

const HistoryTextStack = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const HistoryPrimaryText = styled.div`
  font-size: 13px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const HistorySecondaryText = styled.div`
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export default function DolaShellHistoryPane({
  collapsed,
  historyLoading,
  historyTitle,
  historyEmptyText,
  searchPlaceholder,
  keyword,
  onHistoryIntent,
  onKeywordChange,
  historyScrollerRef,
  filteredHistory,
  visibleHistoryItems,
  shouldVirtualizeHistory,
  topSpacerHeight,
  bottomSpacerHeight,
  onHistoryPrefetch,
  onHistorySelect,
}: Props) {
  if (collapsed) {
    return <div style={{ flex: 1 }} />;
  }

  return (
    <HistorySection onPointerDown={onHistoryIntent}>
      <div>
        <Text
          strong
          style={{ display: 'block', fontSize: 13, color: '#111827' }}
        >
          {historyTitle}
        </Text>
      </div>

      <SearchInput
        placeholder={searchPlaceholder}
        value={keyword}
        onFocus={onHistoryIntent}
        onChange={(event) => {
          onHistoryIntent();
          onKeywordChange(event.target.value);
        }}
      />

      <HistoryScroller
        ref={historyScrollerRef}
        data-testid="shell-history-scroller"
      >
        {filteredHistory.length === 0 && historyLoading ? (
          <Text type="secondary" style={{ fontSize: 13, padding: '8px 4px' }}>
            加载历史对话中...
          </Text>
        ) : filteredHistory.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 13, padding: '8px 4px' }}>
            {historyEmptyText}
          </Text>
        ) : (
          <>
            {shouldVirtualizeHistory && topSpacerHeight > 0 ? (
              <div style={{ height: topSpacerHeight }} aria-hidden />
            ) : null}
            {visibleHistoryItems.map((item) => (
              <HistoryButton
                key={item.id}
                type="text"
                block
                $active={item.active}
                onMouseEnter={() => onHistoryPrefetch(item)}
                onFocus={() => onHistoryPrefetch(item)}
                onClick={() => {
                  if (
                    shouldPrefetchShellIntent({
                      active: item.active,
                      hasAction: hasShellHistoryIntent(item),
                    })
                  ) {
                    void onHistoryPrefetch(item);
                  }
                  onHistorySelect(item);
                }}
              >
                <HistoryTextStack>
                  <HistoryPrimaryText title={item.title}>
                    {item.title}
                  </HistoryPrimaryText>
                  {item.subtitle ? (
                    <HistorySecondaryText title={item.subtitle}>
                      {item.subtitle}
                    </HistorySecondaryText>
                  ) : null}
                </HistoryTextStack>
              </HistoryButton>
            ))}
            {shouldVirtualizeHistory && bottomSpacerHeight > 0 ? (
              <div style={{ height: bottomSpacerHeight }} aria-hidden />
            ) : null}
          </>
        )}
      </HistoryScroller>
    </HistorySection>
  );
}
