import { Typography } from 'antd';
import styled from 'styled-components';
import Prompt from '@/components/pages/home/prompt';

const { Title } = Typography;

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

export {
  Stage,
  HeroPanel,
  HeroGreeting,
  HeroTitle,
  ComposerCard,
  ComposerShell,
  SourceChip,
  SourceChipRemove,
  KnowledgePickerList,
  KnowledgePickerCard,
  RecommendationSection,
  RecommendationRow,
  RecommendationCard,
  RecommendationIcon,
  ComposerScopeRow,
  KnowledgeDropdownPanel,
  KnowledgeDropdownSearchShell,
  KnowledgeDropdownSearch,
  ComposerScopeChip,
  ComposerPassiveChip,
  ComposerAtMark,
  ComposerPrompt,
  ComposerToolButton,
  ComposerKnowledgeAction,
  ExploreHeaderBar,
  ExploreTitle,
  ExploreSegmented,
  ExploreSegmentButton,
  ExploreSourceHint,
  ExploreEmpty,
  KnowledgeOptionList,
  KnowledgeOptionItems,
  KnowledgeOptionRow,
  KnowledgeOptionMain,
  KnowledgeOptionCopy,
  KnowledgeOptionMeta,
};
