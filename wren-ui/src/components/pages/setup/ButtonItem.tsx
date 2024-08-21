import Image from 'next/image';
import { Button } from 'antd';
import styled from 'styled-components';
import Icon from '@ant-design/icons';
import { IterableComponent } from '@/utils/iteration';
import { ButtonOption } from './utils';
import { SampleDatasetName } from '@/apollo/client/graphql/__types__';

const StyledButton = styled(Button)`
  border: 2px var(--gray-4) solid;
  background-color: var(--gray-2);
  border-radius: 4px;
  width: 100%;
  height: auto;

  &:focus {
    border: 2px var(--gray-4) solid;
    background-color: var(--gray-2);
  }

  &:hover {
    border-color: var(--geekblue-6);
    background-color: var(--gray-2);
  }

  &.is-active {
    border-color: var(--geekblue-6) !important;
    background-color: var(--gray-2) !important;
  }

  &:disabled {
    opacity: 0.5;
  }

  // loading of button
  .ant-btn-loading-icon .anticon {
    font-size: 24px;
  }
`;

const StyledIcon = styled(Icon)`
  width: 40px;
  height: 40px;
  font-size: 32px;
  display: inline-flex;
  justify-content: center;
  align-items: center;
`;

const PlainImage = styled.div`
  border: 1px var(--gray-4) solid;
  background-color: white;
  width: 40px;
  height: 40px;
`;

const ComingSoon = styled.div`
  border: 1px var(--gray-7) solid;
  color: var(--gray-7);
  font-size: 8px;
  padding: 2px 6px;
  border-radius: 999px;
  &:before {
    content: 'COMING SOON';
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
  } = props;

  const isSelected = selectedTemplate === value;
  const loading = isSelected && submitting;

  return (
    <StyledButton
      className={[
        'px-4 py-2 gray-8 d-flex align-center',
        loading ? 'flex-start' : 'justify-space-between',
        isSelected ? 'is-active' : '',
      ].join(' ')}
      disabled={disabled || submitting}
      loading={loading}
      onClick={() => onSelect(value)}
    >
      <div className="d-flex align-center" style={{ width: '100%' }}>
        {logo ? (
          <Image
            className="mr-2"
            src={logo}
            alt={label}
            width="40"
            height="40"
          />
        ) : IconComponent ? (
          <StyledIcon component={IconComponent} className="mr-2" />
        ) : (
          <PlainImage className="mr-2" />
        )}
        {label}
      </div>
      {disabled && <ComingSoon />}
    </StyledButton>
  );
}
