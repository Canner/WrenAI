import { useRef, useContext, useMemo } from 'react';
import styled from 'styled-components';
import { compact } from 'lodash';
import FieldSelect, {
  FieldOption,
  FieldValue,
  getFieldValue,
} from './FieldSelect';
import { ExpressionName } from '@/types/calculatedField';
import { nextTick } from '@/utils/time';
import { makeIterable } from '@/utils/iteration';
import { NODE_TYPE } from '@/utils/enum';
import { parseJson } from '@/utils/helper';
import {
  FormItemInputContext,
  FormItemStatusContextProps,
} from 'antd/lib/form/context';
import { DiagramModel } from '@/utils/data';
import { getNodeTypeIcon } from '@/utils/nodeType';
import { aggregations } from '@/utils/expressionType';

import {
  checkStringFunctionAllowType,
  checkNumberFunctionAllowType,
} from '@/utils/validator';

interface Props {
  sourceModel: DiagramModel;
  onChange?: (value: FieldValue[]) => void;
  onFetchOptions?: (value: FieldValue, index: number) => Promise<FieldOption[]>;
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

  const change = async (selectValue: string, index: number) => {
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
      data-testid="common__lineage"
    >
      <SelectResult
        data={data}
        onChange={change}
        onFetchOptions={onFetchOptions}
      />
    </Wrapper>
  );
}

export const getLineageOptions = (data: {
  model: DiagramModel;
  sourceModel: DiagramModel;
  expression: ExpressionName;
  values: FieldValue[];
}) => {
  const isNonNullable = <T,>(value: T | null | undefined): value is T =>
    value != null;
  const { model, sourceModel, expression, values = [] } = data;
  const hasPrimaryKey = (model.fields || []).some(
    (field) => field?.isPrimaryKey,
  );
  const isSourceModel = model.modelId === sourceModel.modelId;

  const convertor = (field: FieldValue) => {
    const value = getFieldValue(field);
    const isRelationship = field.nodeType === NODE_TYPE.RELATION;
    // check if source model's calculated field
    const isSourceModelCalculatedField =
      isSourceModel && field.nodeType === NODE_TYPE.CALCULATED_FIELD;
    // check if user select aggregation functions, then the source model fields cannot be selected
    const isSourceModelFieldsWithAggregation =
      aggregations.includes(expression) && isSourceModel && !isRelationship;
    // check if the relationship is in used
    const isInUsedRelationship =
      isRelationship &&
      values.some(
        (item) => item.relationId && item.relationId === value.relationId,
      );
    // The relationship options available only if the model has a primary key
    const isRelationshipWithoutPrimaryKey = isRelationship && !hasPrimaryKey;

    // check if the field type is valid for the expression
    let isInvalidType = false;
    let invalidTypeMessage = '';
    if (!checkStringFunctionAllowType(expression, value)) {
      isInvalidType = true;
      invalidTypeMessage = '请选择字符串类型字段。';
    } else if (!checkNumberFunctionAllowType(expression, value)) {
      isInvalidType = true;
      invalidTypeMessage = '请选择数值类型字段。';
    }

    const disabled =
      isSourceModelFieldsWithAggregation ||
      isRelationshipWithoutPrimaryKey ||
      isSourceModelCalculatedField ||
      isInUsedRelationship ||
      isInvalidType;

    let title = undefined;
    if (isSourceModelFieldsWithAggregation) {
      title = '聚合函数不支持直接选择源模型字段，以避免产生不符合预期的结果。';
    } else if (isRelationshipWithoutPrimaryKey) {
      title = '请先为当前模型设置主键，才能在计算字段中使用这条关系。';
    } else if (isSourceModelCalculatedField) {
      title = '暂不支持直接使用源模型中的计算字段。';
    } else if (isInUsedRelationship) {
      title = '这条关系已经被使用。';
    } else if (isInvalidType) {
      title = invalidTypeMessage;
    }

    return {
      label: (
        <div className="d-flex align-center">
          {getNodeTypeIcon(
            { nodeType: field.nodeType, type: field.type },
            { className: 'mr-1 flex-shrink-0', title: field.type },
          )}
          <div
            // only show column full title when it's not disabled
            title={!disabled ? field.displayName || undefined : undefined}
            className="text-truncate"
          >
            {field.displayName}
          </div>
        </div>
      ),
      value,
      title,
      disabled,
    };
  };
  const fields = [...(model?.fields || [])]
    .filter(isNonNullable)
    .map((field) => convertor(field as FieldValue));
  const calculatedFields = (model?.calculatedFields || [])
    .filter(isNonNullable)
    .map((field) => convertor(field as FieldValue));
  const relationships = (model?.relationFields || [])
    .filter(isNonNullable)
    .map((field) => convertor(field as FieldValue));
  return compact([
    ...fields,
    calculatedFields.length
      ? { label: '计算字段', options: calculatedFields }
      : undefined,
    relationships.length
      ? { label: '关系', options: relationships }
      : undefined,
  ]);
};
