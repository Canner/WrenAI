import { useMemo } from 'react';
import { capitalize } from 'lodash';
import { useDiagramQuery } from '@/apollo/client/graphql/diagram.generated';
import { getNodeTypeIcon } from '@/utils/nodeType';
import {
  DiagramModel,
  DiagramView,
  DiagramModelField,
  DiagramViewField,
} from '@/apollo/client/graphql/__types__';

type Model = DiagramModel | DiagramView;
type Field = DiagramModelField | DiagramViewField;
type Convertor<T> = (item: (Model | Field) & { parent?: Model }) => T;

interface Props<T> {
  skip?: boolean;
  includeColumns?: boolean;
  convertor?: Convertor<T>;
}

const getDocHTML = (item: (Model | Field) & { parent?: Model }) => {
  return [
    '<div style="max-width: 380px;">',
    `<b style="display: block;color: var(--gray-8); padding: 0 4px 4px;">${item.referenceName}</b>`,
    item.description
      ? `<div style="color: var(--gray-7); padding: 4px 4px 0; border-top: 1px var(--gray-4) solid;">${item.description}</div>`
      : null,
    '</div>',
  ]
    .filter(Boolean)
    .join('');
};

const shouldQuoteIdentifier = (word: string) => {
  return /[^a-z0-9_]/.test(word) || /^\d/.test(word);
};

// For mention usage
export const convertMention = (item: (Model | Field) & { parent?: Model }) => {
  return {
    id: `${item.id}-${item.referenceName}`,
    label: item.displayName,
    value: item.referenceName,
    nodeType: capitalize(item.nodeType),
    meta: item.parent ? `${item.displayName}.${item.displayName}` : undefined,
    icon: getNodeTypeIcon(
      { nodeType: item.nodeType, type: (item as Field).type },
      { className: 'gray-8 mr-2' },
    ),
  };
};

// For ace completer usage
export const convertCompleter = (
  item: (Model | Field) & { parent?: Model },
) => {
  return {
    caption: item.parent
      ? `${item.parent.displayName}.${item.displayName}`
      : item.displayName,
    value: shouldQuoteIdentifier(item.referenceName)
      ? `"${item.referenceName}"`
      : item.referenceName,
    meta: item.nodeType.toLowerCase(),
    // Higher score for models, views
    score: item.parent ? 1 : 10,
    docHTML: getDocHTML(item),
  };
};

export type Mention = ReturnType<typeof convertMention>;
export type Completer = ReturnType<typeof convertCompleter>;

export default function useAutoComplete<T = Completer>(props: Props<T>) {
  const { includeColumns, skip } = props;
  const { data } = useDiagramQuery({ skip });

  // Defined convertor
  const convertor = (props.convertor || convertCompleter) as Convertor<T>;

  return useMemo(() => {
    const models = data?.diagram.models || [];
    const views = data?.diagram.views || [];

    return [...models, ...views].reduce((result, item) => {
      result.push(convertor(item));
      if (includeColumns) {
        item.fields.forEach((field) => {
          result.push(convertor({ ...field, parent: item }));
        });
      }
      return result;
    }, [] as T[]);
  }, [data?.diagram, includeColumns]);
}
