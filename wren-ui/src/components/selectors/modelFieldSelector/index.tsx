import { useRef, useContext, useMemo } from 'react';
import styled from 'styled-components';
import FieldSelect, { FieldValue, FieldOption } from './FieldSelect';
import { nextTick } from '@/utils/time';
import { makeIterable } from '@/utils/iteration';
import { NODE_TYPE } from '@/utils/enum';
import { parseJson } from '@/utils/helper';
import {
  FormItemInputContext,
  FormItemStatusContextProps,
} from 'antd/lib/form/context';

interface Props {
  model: string;
  options: FieldOption[];
  onChange?: (value: FieldValue[]) => void;
  value?: FieldValue[];
}

const Wrapper = styled.div`
  border: 1px var(--gray-5) solid;
  border-radius: 4px;
  overflow-x: auto;

  &.adm-error {
    border-color: var(--red-5);
  }
`;

const SelectResult = makeIterable(FieldSelect);

export default function ModelFieldSelector(props: Props) {
  const wrapper = useRef<HTMLDivElement | null>(null);
  const { model, value = [], onChange, options } = props;

  const formItemContext =
    useContext<FormItemStatusContextProps>(FormItemInputContext);
  const { status } = formItemContext;

  const data = useMemo(() => {
    const modelValue = [{ name: model, nodeType: NODE_TYPE.MODEL }];
    return [modelValue, value].flat();
  }, [model, value]);

  const change = async (selectValue, index) => {
    const parsePayload = parseJson(selectValue) as FieldValue;

    const prevValue = value.slice(0, index);
    const nextValue = [...prevValue, parsePayload];
    onChange && onChange(nextValue);

    await nextTick();
    wrapper.current?.scrollTo({ left: wrapper.current?.scrollWidth });
  };

  return (
    <Wrapper
      ref={wrapper}
      className={`d-flex align-center bg-gray-3 px-8 py-12${
        status ? ` adm-${status}` : ''
      }`}
    >
      <SelectResult data={data} options={options} onChange={change} />
    </Wrapper>
  );
}
