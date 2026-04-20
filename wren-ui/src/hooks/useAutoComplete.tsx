import { useEffect, useMemo } from 'react';
import { capitalize } from 'lodash';
import { getNodeTypeIcon } from '@/utils/nodeType';
import {
  type DiagramResponse,
  DiagramModel,
  DiagramModelField,
  DiagramView,
  DiagramViewField,
} from '@/types/modeling';
import {
  buildKnowledgeDiagramUrl,
  loadKnowledgeDiagramPayload,
  peekKnowledgeDiagramPayload,
} from '@/utils/knowledgeDiagramRest';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import useRestRequest from './useRestRequest';

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

export const buildAutoCompleteRequestKey = ({
  selector,
  skip,
}: {
  selector: Parameters<typeof buildKnowledgeDiagramUrl>[0];
  skip?: boolean;
}) => (skip ? null : buildKnowledgeDiagramUrl(selector));

export default function useAutoComplete<T = Completer>(props: Props<T>) {
  const { includeColumns, skip } = props;
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const requestUrl = useMemo(
    () =>
      buildAutoCompleteRequestKey({
        selector: runtimeScopeNavigation.selector,
        skip,
      }),
    [runtimeScopeNavigation.selector, skip],
  );
  const initialData = useMemo(
    () => (requestUrl ? peekKnowledgeDiagramPayload({ requestUrl }) : null),
    [requestUrl],
  );
  const shouldAutoFetch = Boolean(requestUrl && !initialData);
  const { data, setData } = useRestRequest<DiagramResponse | null>({
    enabled: Boolean(requestUrl),
    auto: shouldAutoFetch,
    initialData,
    requestKey: requestUrl,
    request: async () =>
      loadKnowledgeDiagramPayload({
        requestUrl: requestUrl as string,
        useCache: true,
      }),
  });

  useEffect(() => {
    setData(initialData);
  }, [initialData, setData]);

  // Defined convertor
  const convertor = (props.convertor || convertCompleter) as Convertor<T>;

  return useMemo(() => {
    const models = (data?.diagram.models || []).filter(
      (item): item is DiagramModel => item != null,
    );
    const views = (data?.diagram.views || []).filter(
      (item): item is DiagramView => item != null,
    );

    return [...models, ...views].reduce((result, item) => {
      result.push(convertor(item));
      if (includeColumns) {
        item.fields
          .filter((field): field is Field => field != null)
          .forEach((field) => {
            result.push(
              convertor({
                ...field,
                parent: item,
              } as Field & { parent: Model }),
            );
          });
      }
      return result;
    }, [] as T[]);
  }, [convertor, data?.diagram, includeColumns]);
}
