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

interface Props {
  skip?: boolean;
  includeColumns?: boolean;
}

const convertMention = (item: (Model | Field) & { meta?: string }) => {
  return {
    id: `${item.id}-${item.referenceName}`,
    label: item.displayName,
    value: item.referenceName,
    nodeType: capitalize(item.nodeType),
    meta: item.meta,
    icon: getNodeTypeIcon(
      { nodeType: item.nodeType, type: (item as Field).type },
      { className: 'gray-8 mr-2' },
    ),
  };
};

export type Mention = ReturnType<typeof convertMention>;

export default function useMentions(props: Props) {
  const { includeColumns, skip } = props;
  const { data } = useDiagramQuery({ skip });

  // handle mentions data
  const mentions = useMemo(() => {
    const models = data?.diagram.models || [];
    const views = data?.diagram.views || [];

    return [...models, ...views].reduce((result, item) => {
      result.push(convertMention(item));
      if (includeColumns) {
        item.fields.forEach((field) => {
          result.push(
            convertMention({
              ...field,
              meta: `${item.displayName}.${field.displayName}`,
            }),
          );
        });
      }
      return result;
    }, [] as Mention[]);
  }, [data?.diagram, includeColumns]);

  return { mentions };
}
