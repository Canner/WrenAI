import Image from 'next/image';
import { Button, Typography } from 'antd';
import styled from 'styled-components';
import Icon from '@/import/icon';
import { IterableComponent } from '@/utils/iteration';
import { ButtonOption } from './utils';
import { SampleDatasetName } from '@/types/api';

const { Text } = Typography;

const StyledButton = styled(Button)`
  &.ant-btn {
    width: 100%;
    height: 100%;
    min-height: 148px;
    border-radius: 24px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.98) 0%,
      rgba(249, 249, 255, 0.98) 100%
    );
    box-shadow: 0 18px 38px rgba(15, 23, 42, 0.05);
    padding: 20px 18px;
    text-align: left;
    display: flex;
    align-items: stretch;
    justify-content: stretch;
  }

  &.ant-btn:hover,
  &.ant-btn:focus {
    border-color: rgba(111, 71, 255, 0.24);
    background: linear-gradient(
      180deg,
      rgba(248, 244, 255, 0.98) 0%,
      rgba(243, 239, 255, 0.98) 100%
    );
  }

  &.is-active {
    border-color: rgba(111, 71, 255, 0.28) !important;
    background: linear-gradient(
      180deg,
      rgba(247, 242, 255, 0.98) 0%,
      rgba(239, 232, 255, 0.98) 100%
    ) !important;
    box-shadow: 0 22px 46px rgba(111, 71, 255, 0.12);
  }

  &.ant-btn[disabled] {
    opacity: 0.6;
    box-shadow: none;
  }

  .ant-btn-loading-icon .anticon {
    font-size: 22px;
  }
`;

const ButtonInner = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const ButtonHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const IconShell = styled.div`
  width: 48px;
  height: 48px;
  border-radius: 16px;
  background: rgba(111, 71, 255, 0.08);
  color: #6f47ff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
`;

const StyledIcon = styled(Icon)`
  width: 26px;
  height: 26px;
  font-size: 26px;
  display: inline-flex;
  justify-content: center;
  align-items: center;
`;

const Meta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ComingSoon = styled.div`
  border: 1px solid rgba(15, 23, 42, 0.08);
  color: #7b8194;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 9px;
  border-radius: 999px;
  background: #fff;

  &:before {
    content: '即将支持';
  }
`;

type Props = ButtonOption & {
  selectedTemplate: SampleDatasetName;
  onSelect: (value: string) => void;
};

export default function ButtonItem(props: IterableComponent<Props>) {
  const {
    value,
    disabled,
    submitting,
    logo,
    IconComponent,
    label,
    onSelect,
    selectedTemplate,
    guide,
  } = props;

  const isSelected = selectedTemplate === value;
  const loading = isSelected && submitting;
  const buttonValue = value || '';

  return (
    <StyledButton
      className={isSelected ? 'is-active' : ''}
      disabled={disabled || submitting}
      loading={loading}
      onClick={() => onSelect(buttonValue)}
    >
      <ButtonInner>
        <ButtonHeader>
          <IconShell>
            {logo ? (
              <Image src={logo} alt={label} width="48" height="48" />
            ) : IconComponent ? (
              <StyledIcon component={IconComponent} />
            ) : null}
          </IconShell>
          {disabled ? <ComingSoon /> : null}
        </ButtonHeader>
        <Meta>
          <Text strong style={{ fontSize: 16, color: '#1f2435' }}>
            {label}
          </Text>
          <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.7 }}>
            {guide
              ? '支持快速接入并在后续步骤完成资产选择与语义建模。'
              : '点击后会直接开始当前方式的接入流程。'}
          </Text>
        </Meta>
      </ButtonInner>
    </StyledButton>
  );
}
