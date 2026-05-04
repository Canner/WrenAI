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
import { aggregations } from '@/utils/expressionType';
import { ExpressionName } from '@/apollo/client/graphql/__types__';
import {
  checkStringFunctionAllowType,
  checkNumberFunctionAllowType,
} from '@/utils/validator';

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
  const { model, sourceModel, expression, values = [] } = data;
  const hasPrimaryKey = model.fields.some((field) => field.isPrimaryKey);
  const isSourceModel = model.modelId === sourceModel.modelId;

  const convertor = (field) => {
    const value = compactObject(getFieldValue(field));
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
      invalidTypeMessage = 'Please select a string type field.';
    } else if (!checkNumberFunctionAllowType(expression, value)) {
      isInvalidType = true;
      invalidTypeMessage = 'Please select a number type field.';
    }

    const disabled =
      isSourceModelFieldsWithAggregation ||
      isRelationshipWithoutPrimaryKey ||
      isSourceModelCalculatedField ||
      isInUsedRelationship ||
      isInvalidType;

    let title = undefined;
    if (isSourceModelFieldsWithAggregation) {
      title =
        "Aggregation functions don't allow selecting from source model fields to prevent unexpected outcomes.";
    } else if (isRelationshipWithoutPrimaryKey) {
      title =
        'Please set a primary key within this model to use it in a calculated field.';
    } else if (isSourceModelCalculatedField) {
      title = 'Calculated field from the source model is not supported.';
    } else if (isInUsedRelationship) {
      title = 'This relationship is in use.';
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
            title={!disabled ? field.displayName : null}
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
