import { Select } from 'antd';
import styled from 'styled-components';
import testData from '@/testData';

const StyledSelect = styled(Select)`
  position: absolute;
  left: 32px;
  top: 32px;
  width: 250px;
  z-index: 999;
`;

export default function TestDataSelect({ value, onSelect }) {
  const options = Object.keys(testData).map((key) => ({
    label: key,
    value: key,
  }));
  return <StyledSelect value={value} options={options} onSelect={onSelect} />;
}
