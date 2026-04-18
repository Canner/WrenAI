import { useEffect, useMemo, useState } from 'react';
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
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const requestUrl = useMemo(
    () =>
      skip ? null : buildKnowledgeDiagramUrl(runtimeScopeNavigation.selector),
    [runtimeScopeNavigation.selector, skip],
  );
  const [data, setData] = useState<DiagramResponse | null>(
    requestUrl ? peekKnowledgeDiagramPayload({ requestUrl }) : null,
  );

  useEffect(() => {
    if (!requestUrl) {
      setData(null);
      return;
    }

    let cancelled = false;
    const cached = peekKnowledgeDiagramPayload({ requestUrl });
    if (cached) {
      setData(cached);
    }

    void loadKnowledgeDiagramPayload({
      requestUrl,
      useCache: true,
    })
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
        }
      })
      .catch(() => {
        if (!cancelled && !cached) {
          setData(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [requestUrl]);

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
