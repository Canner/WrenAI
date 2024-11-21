import { ComponentProps } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { Button, Switch, Typography, Empty } from 'antd';
import styled from 'styled-components';
import CheckOutlined from '@ant-design/icons/CheckOutlined';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import CopyOutlined from '@ant-design/icons/lib/icons/CopyOutlined';
import UpCircleOutlined from '@ant-design/icons/UpCircleOutlined';
import PreviewData from '@/components/dataPreview/PreviewData';
import { DATA_SOURCE_OPTIONS } from '@/components/pages/setup/utils';
import { NativeSQLResult } from '@/hooks/useNativeSQL';

const CodeBlock = dynamic(() => import('@/components/editor/CodeBlock'), {
  ssr: false,
});

const { Text } = Typography;

const StyledToolBar = styled.div`
  background-color: var(--gray-2);
  height: 32px;
  padding: 4px 8px;
`;

const StyledPre = styled.pre<{ showNativeSQL: boolean }>`
  .adm_code-block {
    ${(props) => (props.showNativeSQL ? 'border-top: none;' : '')}
  }
`;

interface Props {
  isViewSQL?: boolean;
  isViewFullSQL?: boolean;
  isPreviewData?: boolean;
  onCloseCollapse: () => void;
  onCopyFullSQL?: () => void;
  sql: string;
  previewDataResult: ComponentProps<typeof PreviewData>;
  attributes: {
    stepNumber: number;
    isLastStep: boolean;
  };
  nativeSQLResult: NativeSQLResult;
  onChangeNativeSQL: (checked: boolean) => void;
}

export default function CollapseContent(props: Props) {
  const {
    isViewSQL,
    isViewFullSQL,
    isPreviewData,
    onCloseCollapse,
    onCopyFullSQL,
    sql,
    previewDataResult,
    attributes,
    onChangeNativeSQL,
    nativeSQLResult,
  } = props;
  const isStepViewSQL = !isViewFullSQL && isViewSQL;

  const { hasNativeSQL, dataSourceType } = nativeSQLResult;
  const showNativeSQL = Boolean(attributes.isLastStep) && hasNativeSQL;

  const sqls =
    nativeSQLResult.nativeSQLMode && nativeSQLResult.loading === false
      ? nativeSQLResult.data
      : sql;

  return (
    <>
      {(isViewSQL || isViewFullSQL) && (
        <StyledPre className="p-0 my-3" showNativeSQL={showNativeSQL}>
          {showNativeSQL && (
            <StyledToolBar className="d-flex justify-space-between text-family-base">
              <div>
                {nativeSQLResult.nativeSQLMode && (
                  <>
                    <Image
                      className="mr-2"
                      src={DATA_SOURCE_OPTIONS[dataSourceType].logo}
                      alt={DATA_SOURCE_OPTIONS[dataSourceType].label}
                      width="22"
                      height="22"
                    />
                    <Text className="gray-8 text-medium text-sm">
                      {DATA_SOURCE_OPTIONS[dataSourceType].label}
                    </Text>
                  </>
                )}
              </div>
              <div>
                <Switch
                  checkedChildren={<CheckOutlined />}
                  unCheckedChildren={<CloseOutlined />}
                  className="mr-2"
                  size="small"
                  onChange={onChangeNativeSQL}
                  loading={nativeSQLResult.loading}
                />
                <Text className="gray-8 text-medium text-sm">
                  Show original SQL
                </Text>
              </div>
            </StyledToolBar>
          )}
          <CodeBlock
            code={sqls}
            showLineNumbers
            maxHeight="300"
            loading={nativeSQLResult.loading}
          />
        </StyledPre>
      )}
      {isPreviewData && (
        <div className="my-3">
          <PreviewData
            {...previewDataResult}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="Sorry, we couldn't find any records that match your search criteria."
                />
              ),
            }}
          />
        </div>
      )}
      {(isStepViewSQL || isPreviewData) && (
        <div className="d-flex justify-space-between">
          <Button
            className="gray-6"
            type="text"
            size="small"
            icon={<UpCircleOutlined />}
            onClick={onCloseCollapse}
          >
            Collapse
          </Button>
          {isPreviewData && (
            <Text className="text-base gray-6">Showing up to 500 rows</Text>
          )}
        </div>
      )}
      {isViewFullSQL && (
        <>
          <Button
            className="gray-6 mr-2"
            type="text"
            size="small"
            icon={<UpCircleOutlined />}
            onClick={onCloseCollapse}
          >
            Collapse
          </Button>
          <Button
            className="gray-6"
            type="text"
            size="small"
            icon={<CopyOutlined />}
            onClick={onCopyFullSQL}
            data-ph-capture="true"
            data-ph-capture-attribute-name="cta_answer_copy_sql"
            data-ph-capture-attribute_step={attributes.stepNumber}
            data-ph-capture-attribute_is_last_step={attributes.isLastStep}
          >
            Copy
          </Button>
        </>
      )}
    </>
  );
}
