import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useEffect } from 'react';
import styled from 'styled-components';
import {
  Button,
  Divider,
  Empty,
  message,
  Space,
  Switch,
  Typography,
} from 'antd';
import CheckOutlined from '@ant-design/icons/CheckOutlined';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import CodeFilled from '@ant-design/icons/CodeFilled';
import { BinocularsIcon } from '@/utils/icons';
import { nextTick } from '@/utils/time';
import useNativeSQL from '@/hooks/useNativeSQL';
import { CONNECTION_TYPE_OPTIONS } from '@/components/pages/setup/utils';
import { Logo } from '@/components/Logo';
import { Props as AnswerResultProps } from '@/components/pages/home/promptThread/AnswerResult';
import { usePromptThreadActionsStore } from '@/components/pages/home/promptThread/store';
import PreviewData from '@/components/dataPreview/PreviewData';
import useResponsePreviewData from '@/hooks/useResponsePreviewData';

const SQLCodeBlock = dynamic(() => import('@/components/code/SQLCodeBlock'), {
  ssr: false,
});

const { Text } = Typography;

const StyledPre = styled.pre`
  .adm_code-block {
    border-top: none;
    border-radius: 0px 0px 4px 4px;
  }
`;

const StyledToolBar = styled.div`
  background-color: var(--gray-2);
  height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--gray-3);
  border-radius: 4px 4px 0px 0px;
`;

export default function ViewSQLTabContent(props: AnswerResultProps) {
  const {
    isLastThreadResponse,
    onInitPreviewDone,
    shouldAutoPreview,
    threadResponse,
  } = props;

  const { onOpenAdjustSQLModal } = usePromptThreadActionsStore();
  const { fetchNativeSQL, nativeSQLResult } = useNativeSQL();
  const previewDataResult = useResponsePreviewData(threadResponse.id);
  const { ensureLoaded: ensurePreviewLoaded } = previewDataResult;

  const onPreviewData = async () => {
    await ensurePreviewLoaded();
  };

  const autoTriggerPreviewDataButton = async () => {
    await nextTick();
    await onPreviewData();
    await nextTick();
    onInitPreviewDone();
  };

  // when is the last step of the last thread response, auto trigger preview data button
  useEffect(() => {
    if (isLastThreadResponse && shouldAutoPreview) {
      autoTriggerPreviewDataButton();
    }
  }, [isLastThreadResponse, shouldAutoPreview]);

  const { id, sql } = threadResponse;
  const sqlText = sql ?? '';

  const { connectionType, hasNativeSQL } = nativeSQLResult;
  const showNativeSQL = hasNativeSQL;
  const connectionTypeOption =
    connectionType && CONNECTION_TYPE_OPTIONS[connectionType]
      ? CONNECTION_TYPE_OPTIONS[connectionType]
      : null;

  const sqls =
    nativeSQLResult.nativeSQLMode && nativeSQLResult.loading === false
      ? nativeSQLResult.data
      : sqlText;

  const onChangeNativeSQL = async (checked: boolean) => {
    nativeSQLResult.setNativeSQLMode(checked);
    checked && fetchNativeSQL({ variables: { responseId: id } });
  };

  const onCopy = () => {
    if (!nativeSQLResult.nativeSQLMode) {
      message.success(
        <>
          你复制的是 Wren SQL。该方言用于 Wren
          Engine，可能无法直接在你的数据库中运行。
          {hasNativeSQL && (
            <>
              {' '}
              点击“<b>显示原始 SQL</b>”即可切换到可直接执行的版本。
            </>
          )}
        </>,
      );
    }
  };

  return (
    <div className="text-md gray-10 p-6 pb-4">
      <StyledPre className="p-0 mb-3">
        <StyledToolBar className="d-flex align-center justify-space-between text-family-base">
          <div>
            {nativeSQLResult.nativeSQLMode ? (
              <>
                {connectionTypeOption?.logo ? (
                  <Image
                    className="mr-2"
                    src={connectionTypeOption.logo}
                    alt={connectionTypeOption.label}
                    width="22"
                    height="22"
                  />
                ) : null}
                <Text className="gray-8 text-medium text-sm">
                  {connectionTypeOption?.label || '原始 SQL'}
                </Text>
              </>
            ) : (
              <span className="d-flex align-center gx-2">
                <Logo size={18} />
                <Text className="gray-8 text-medium text-sm">Wren SQL</Text>
              </span>
            )}
          </div>
          <Space separator={<Divider orientation="vertical" className="m-0" />}>
            {showNativeSQL && (
              <div
                className="d-flex align-center cursor-pointer"
                onClick={() =>
                  onChangeNativeSQL(!nativeSQLResult.nativeSQLMode)
                }
              >
                <Switch
                  checkedChildren={<CheckOutlined />}
                  unCheckedChildren={<CloseOutlined />}
                  className="mr-2"
                  size="small"
                  checked={nativeSQLResult.nativeSQLMode}
                  loading={nativeSQLResult.loading}
                />
                <Text className="gray-8 text-medium text-base">
                  显示原始 SQL
                </Text>
              </div>
            )}
            <Button
              type="link"
              data-ph-capture="true"
              data-ph-capture-attribute-name="view_sql_copy_sql"
              icon={<CodeFilled />}
              size="small"
              onClick={() =>
                onOpenAdjustSQLModal({ sql: sqlText, responseId: id })
              }
            >
              调整 SQL
            </Button>
          </Space>
        </StyledToolBar>
        <SQLCodeBlock
          code={sqls}
          showLineNumbers
          maxHeight="300"
          loading={nativeSQLResult.loading}
          copyable
          onCopy={onCopy}
        />
      </StyledPre>
      <div className="mt-6">
        <Button
          size="small"
          icon={
            <BinocularsIcon
              style={{
                paddingBottom: 2,
                marginRight: 8,
              }}
            />
          }
          loading={previewDataResult.loading}
          onClick={onPreviewData}
          data-ph-capture="true"
          data-ph-capture-attribute-name="view_sql_preview_data"
        >
          查看结果
        </Button>
        {previewDataResult?.data?.previewData && (
          <div className="mt-2 mb-3">
            <PreviewData
              error={previewDataResult.error}
              loading={previewDataResult.loading}
              previewData={previewDataResult?.data?.previewData}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="未找到符合当前查询条件的数据记录。"
                  />
                ),
              }}
            />
            <div className="text-right">
              <Text className="text-base gray-6">最多展示 500 行</Text>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
