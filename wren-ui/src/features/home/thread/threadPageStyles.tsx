import { Splitter, Typography } from 'antd';
import styled from 'styled-components';

const { Text } = Typography;

export const ThreadScene = styled.div<{ $withWorkbench?: boolean }>`
  width: 100%;
  max-width: ${(props) => (props.$withWorkbench ? 'none' : '940px')};
  margin: 0 auto;
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  height: ${(props) => (props.$withWorkbench ? 'calc(100vh - 48px)' : 'auto')};
  min-height: ${(props) => (props.$withWorkbench ? '0' : 'calc(100vh - 72px)')};
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: ${(props) => (props.$withWorkbench ? 'hidden' : 'visible')};
`;

export const ThreadSplitStage = styled(Splitter)`
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: transparent;
  overflow: hidden;

  .ant-splitter-panel {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .ant-splitter-bar {
    background: transparent;
  }

  .ant-splitter-bar-dragger {
    width: 10px !important;
    min-width: 10px !important;
    background: transparent !important;
  }

  .ant-splitter-bar-dragger::before {
    content: '';
    display: block;
    width: 3px;
    height: 100%;
    margin: 0 auto;
    border-radius: 999px;
    background: linear-gradient(
      180deg,
      rgba(148, 163, 184, 0.24) 0%,
      rgba(148, 163, 184, 0.5) 100%
    );
    transition:
      background 0.18s ease,
      transform 0.18s ease;
  }

  .ant-splitter-bar:hover .ant-splitter-bar-dragger::before,
  .ant-splitter-bar-active .ant-splitter-bar-dragger::before {
    background: linear-gradient(
      180deg,
      rgba(111, 71, 255, 0.24) 0%,
      rgba(111, 71, 255, 0.5) 100%
    );
    transform: scaleX(1.05);
  }
`;

export const ConversationPane = styled.section<{ $withWorkbench?: boolean }>`
  flex: 1;
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  height: 100%;
  position: relative;
  padding: 0 ${(props) => (props.$withWorkbench ? '16px' : '24px')} 0 24px;
  overflow: ${(props) => (props.$withWorkbench ? 'hidden' : 'visible')};
  box-sizing: border-box;

  @media (max-width: 1280px) {
    padding: 0 12px 0 16px;
  }
`;

export const ConversationBody = styled.div<{ $withWorkbench?: boolean }>`
  flex: 1;
  width: 100%;
  min-height: 0;
  max-width: 100%;
  overflow-x: hidden;
  overflow-y: ${(props) => (props.$withWorkbench ? 'auto' : 'visible')};
  padding: 0 0 24px;
  scrollbar-gutter: ${(props) => (props.$withWorkbench ? 'stable' : 'auto')};
`;

export const WorkbenchPane = styled.aside`
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  padding-left: 0;
`;

export const ComposerSelectedScopeRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
`;

export const ComposerSelectedKnowledgeChip = styled.div`
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

export const ComposerDock = styled.div`
  position: sticky;
  bottom: 0;
  z-index: 8;
  padding: 12px 0 20px;
  margin-top: auto;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.94) 28%,
    rgba(255, 255, 255, 0.98) 100%
  );
`;

export const ComposerFrame = styled.div`
  border-radius: 18px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
  padding: 12px 14px 12px;
`;

export const ComposerAssistRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 0 2px 10px;
`;

export const ComposerHintText = styled(Text)`
  &.ant-typography {
    margin-bottom: 0;
    color: #8b93a3;
    font-size: 12px;
  }
`;

export const ReferenceConversation = styled.div`
  padding: 22px 8px 36px 8px;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

export const SpeakerRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
`;

export const SpeakerBadge = styled.div<{ $tone: 'user' | 'assistant' }>`
  width: 34px;
  height: 34px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: ${(props) => (props.$tone === 'user' ? '#fff' : '#5a6174')};
  background: ${(props) =>
    props.$tone === 'user' ? '#db6b54' : 'rgba(15, 23, 42, 0.06)'};
`;

export const Bubble = styled.div<{ $muted?: boolean }>`
  flex: 1;
  border-radius: 18px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: ${(props) =>
    props.$muted ? 'rgba(251, 252, 255, 0.9)' : 'rgba(255, 255, 255, 0.96)'};
  padding: 16px 18px;
  box-shadow: 0 16px 28px rgba(15, 23, 42, 0.04);
`;

export const StatusLine = styled.div`
  color: #3d4353;
  font-size: 15px;
  font-weight: 600;
`;

export const ThinkingLine = styled.div`
  width: fit-content;
  color: #4f5668;
  font-size: 14px;
  font-weight: 600;
`;

export const InsightBlock = styled.div`
  padding-left: 46px;
  color: #2b3140;
  line-height: 1.7;
  font-size: 14px;
`;

export const InlinePreviewCard = styled.div`
  margin-left: 46px;
  border-radius: 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.96);
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  box-shadow: 0 16px 28px rgba(15, 23, 42, 0.04);
`;

export const InlineCardMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

export const SubtleBadge = styled.span`
  min-height: 30px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: #4a5263;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

export const SuggestionShell = styled.div`
  margin-top: 4px;
  border-radius: 20px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.96);
  padding: 16px;
  box-shadow: 0 18px 28px rgba(15, 23, 42, 0.04);
`;

export const SuggestionChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
`;

export const SuggestionChip = styled.button`
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: #fff;
  color: #3f4657;
  border-radius: 10px;
  height: 34px;
  padding: 0 12px;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;

  &:hover {
    border-color: rgba(141, 101, 225, 0.22);
    color: var(--nova-primary-strong);
    transform: translateY(-1px);
  }
`;
