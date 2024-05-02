import { useRef, useContext, useMemo } from 'react';
import styled from 'styled-components';
import { compact } from 'lodash';
import FieldSelect, {
  FieldValue,
  FieldOption,
  getFieldValue,
} from './FieldSelect';
import { nextTick } from '@/utils/time';
import { makeIterable } from '@/utils/iteration';
import { NODE_TYPE } from '@/utils/enum';
import { compactObject, parseJson } from '@/utils/helper';
import {
  FormItemInputContext,
  FormItemStatusContextProps,
} from 'antd/lib/form/context';
import { DiagramModel } from '@/utils/data';
import { getNodeTypeIcon } from '@/utils/nodeType';

interface Props {
  sourceModel: DiagramModel;
  onChange?: (value: FieldValue[]) => void;
  onFetchOptions?: (value: any, index: number) => Promise<FieldOption[]>;
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

export default function LineageSelector(props: Props) {
  const wrapper = useRef<HTMLDivElement | null>(null);
  const { sourceModel, value = [], onChange, onFetchOptions } = props;

  const formItemContext =
    useContext<FormItemStatusContextProps>(FormItemInputContext);
  const { status } = formItemContext;

  // prepare value & options here
  const data = useMemo(() => {
    // always add model as the first item
    const selectedData = [
      {
        referenceName: sourceModel.referenceName,
        displayName: sourceModel.displayName,
        nodeType: NODE_TYPE.MODEL,
      },
      ...value,
    ];

    return selectedData;
  }, [sourceModel, value]);

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
      <SelectResult
        data={data}
        onChange={change}
        onFetchOptions={onFetchOptions}
      />
    </Wrapper>
  );
}

export const getLineageOptions = (
  model: DiagramModel,
  values: FieldValue[] = [],
) => {
  const hasPrimaryKey = model.fields.some((field) => field.isPrimaryKey);

  const convertor = (field) => {
    const value = compactObject(getFieldValue(field));
    const isRelationship = field.nodeType === NODE_TYPE.RELATION;

    // check if the relationship is in used
    const isInUsedRelationship =
      isRelationship &&
      values.some(
        (item) => item.relationId && item.relationId === value.relationId,
      );
    // The relationship options available only if the model has a primary key
    const isRelationshipWithoutPrimaryKey = isRelationship && !hasPrimaryKey;

    return {
      label: (
        <div className="d-flex align-center">
          {getNodeTypeIcon(
            { nodeType: field.nodeType, type: field.type },
            { className: 'mr-1 flex-shrink-0' },
          )}
          {field.displayName}
        </div>
      ),
      value,
      title: isRelationshipWithoutPrimaryKey
        ? 'Please set a primary key within this model to use it in a calculated field.'
        : isInUsedRelationship
          ? 'This relationship is in use.'
          : undefined,
      disabled: isRelationshipWithoutPrimaryKey || isInUsedRelationship,
    };
  };
  const fields = [...(model?.fields || [])].map(convertor);
  const calculatedFields = (model?.calculatedFields || []).map(convertor);
  const relationships = (model?.relationFields || []).map(convertor);
  return compact([
    ...fields,
    calculatedFields.length
      ? { label: 'Calculated fields', options: calculatedFields }
      : undefined,
    relationships.length
      ? { label: 'Relationships', options: relationships }
      : undefined,
  ]);
};
