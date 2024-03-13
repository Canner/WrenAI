import { AdaptedData } from '@/utils/data';
import { NODE_TYPE } from '@/utils/enum';
import { SQLEditorAutoCompleteSourceWordInfo } from '@/components/editor';

const NODE_TYPE_CAPTION = {
  [NODE_TYPE.MODEL]: 'Model',
  [NODE_TYPE.METRIC]: 'Metric',
};

const convertColumns = (
  columnsArray: any,
  previousSqlName: string,
  previousLayerName = ''
) =>
  (columnsArray || []).flatMap((column) => {
    const title = column.name;
    const columnSqlQueryKey = previousLayerName
      ? `${previousLayerName}.${title}`
      : title;

    const isModelType = Boolean((column as any)?.relationship);
    const columnType = isModelType ? 'Model' : column.type;
    const columnInfo = {
      caption: `${previousSqlName}.${columnSqlQueryKey}`,
      meta: `Column(${columnType})`,
      value: columnSqlQueryKey,
      title: columnSqlQueryKey,
    };

    const nestedColumnsArray = column?.columns || [];
    if (!['ARRAY'].includes(columnType) && nestedColumnsArray.length > 0) {
      const childrenColumn = convertColumns(
        nestedColumnsArray,
        previousSqlName,
        columnSqlQueryKey
      );
      return [columnInfo, ...childrenColumn];
    }

    return columnInfo;
  });

export const convertToAutoCompleteSourceWordInfo = (
  adaptedData: AdaptedData
): SQLEditorAutoCompleteSourceWordInfo[] =>
  Object.keys(adaptedData).reduce((allWorkdInfo, key) => {
    if (!['metrics', 'models'].includes(key)) return allWorkdInfo;

    const data = adaptedData[key];
    const wordInfo = data.reduce((allWorkdInfo, item) => {
      return [
        ...allWorkdInfo,
        {
          caption: item.name,
          value: item.name,
          meta: NODE_TYPE_CAPTION[item.nodeType],
        },
        ...convertColumns(item.columns, item.name),
      ];
    }, []);

    return [...allWorkdInfo, ...wordInfo];
  }, []);
