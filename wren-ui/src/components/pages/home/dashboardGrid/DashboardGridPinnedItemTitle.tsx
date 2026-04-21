import { Form } from 'antd';

import { appMessage as message } from '@/utils/antdAppBridge';
import EditableWrapper, { EditableContext } from '@/components/EditableWrapper';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { updateDashboardItem } from '@/utils/dashboardRest';

import type { DashboardGridItem } from './dashboardGridTypes';

export const DashboardGridPinnedItemTitle = (props: {
  id: number;
  title: string;
  readOnly?: boolean;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  onRename: (item: DashboardGridItem) => void;
}) => {
  const { title, readOnly = false, runtimeScopeSelector, onRename } = props;
  const [form] = Form.useForm();

  const handleSave = (
    dashboardItemId: string | number,
    values: { [key: string]: string },
  ) => {
    const nextTitle = values.title?.trim();
    if (!nextTitle || nextTitle === title) return;

    void updateDashboardItem(runtimeScopeSelector, Number(dashboardItemId), {
      displayName: nextTitle,
    })
      .then((item) => {
        onRename(item);
      })
      .catch((error) => {
        message.error(
          error instanceof Error
            ? error.message
            : '更新看板图表失败，请稍后重试。',
        );
      });
  };

  return (
    <EditableContext.Provider value={form}>
      {readOnly ? (
        <div
          className="editable-cell-value-wrap"
          style={{
            padding: '0 7px',
            border: '1px var(--gray-4) solid',
            borderRadius: 4,
          }}
        >
          {title}
        </div>
      ) : (
        <Form className="d-flex" form={form}>
          <EditableWrapper
            record={props}
            dataIndex="title"
            handleSave={handleSave}
          >
            {title}
          </EditableWrapper>
        </Form>
      )}
    </EditableContext.Provider>
  );
};
