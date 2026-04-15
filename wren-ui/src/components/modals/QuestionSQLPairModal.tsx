import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Alert, Button, Form, Input, Modal, Typography, message } from 'antd';
import { Logo } from '@/components/Logo';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import SelectOutlined from '@ant-design/icons/SelectOutlined';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';
import { getDataSourceName } from '@/utils/dataSourceType';
import useModalAction, { ModalAction } from '@/hooks/useModalAction';
import SQLEditor from '@/components/editor/SQLEditor';
import { createSQLPairQuestionValidator } from '@/utils/validator';
import ErrorCollapse from '@/components/ErrorCollapse';
import PreviewData from '@/components/dataPreview/PreviewData';
import ImportDataSourceSQLModal, {
  isSupportSubstitute,
} from '@/components/modals/ImportDataSourceSQLModal';
import {
  SqlPair,
  DataSource,
  DataSourceName,
} from '@/apollo/client/graphql/__types__';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import {
  previewSql,
  validateSql,
  type SqlPreviewDataResponse,
} from '@/utils/sqlPreviewRest';
import { fetchSettings } from '@/utils/settingsRest';
import { generateKnowledgeSqlPairQuestion } from '@/utils/knowledgeRuleSqlRest';

type Props = ModalAction<SqlPair> & {
  loading?: boolean;
  payload?: {
    isCreateMode: boolean;
  };
};

type ModalErrorState = {
  message: string;
  shortMessage: string;
  code: string;
  stacktrace?: string[] | string;
} | null;

const StyledForm = styled(Form)`
  .ant-form-item {
    margin-bottom: 18px;
  }

  .adm-question-form-item > div > label {
    width: 100%;
  }

  .ant-form-item-label > label {
    font-size: 13px;
    font-weight: 600;
    color: #4b5563;
  }

  .ant-input {
    min-height: 40px;
    border-radius: 10px;
    border-color: #dbe2ea;
    box-shadow: none;
  }
`;

const StyledModal = styled(Modal)`
  .ant-modal-content {
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid #e5e7eb;
    box-shadow: 0 20px 56px rgba(15, 23, 42, 0.12);
  }

  .ant-modal-header {
    padding: 18px 20px;
    border-bottom: 1px solid #eef2f7;
  }

  .ant-modal-title {
    font-size: 18px;
    font-weight: 700;
    color: #111827;
  }

  .ant-modal-body {
    padding: 20px;
  }
`;

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
`;

const FooterHint = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 340px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.7;
`;

const Toolbar = (props: {
  dataSource?: DataSourceName;
  onClick: () => void;
}) => {
  const { dataSource, onClick } = props;
  const name = dataSource ? getDataSourceName(dataSource) : '数据源';
  return (
    <div className="d-flex justify-space-between align-center px-1">
      <span className="d-flex align-center gx-2">
        <Logo size={16} />
        Wren SQL
      </span>
      <Button className="px-0" type="link" size="small" onClick={onClick}>
        <SelectOutlined />从 {name} SQL 导入
      </Button>
    </div>
  );
};

export default function QuestionSQLPairModal(props: Props) {
  const {
    defaultValue,
    formMode,
    loading,
    onClose,
    onSubmit,
    visible,
    payload,
  } = props;

  // pass payload?.isCreateMode to prevent formMode from being set to Update when passing defaultValue, for the 'Add a SQL pair from an existing answer' scenario use.
  const isCreateMode = formMode === FORM_MODE.CREATE || payload?.isCreateMode;
  const importDataSourceSQLModal = useModalAction();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [settings, setSettings] = useState<Awaited<
    ReturnType<typeof fetchSettings>
  > | null>(null);
  const normalizedSettingsDataSource = useMemo<DataSource | undefined>(() => {
    if (!settings?.dataSource?.type) {
      return undefined;
    }

    return {
      type: settings.dataSource.type,
      properties: settings.dataSource.properties || {},
      sampleDataset: settings.dataSource.sampleDataset || undefined,
    };
  }, [settings?.dataSource]);
  const dataSource = useMemo(
    () => ({
      isSupportSubstitute: isSupportSubstitute(normalizedSettingsDataSource),
      type: normalizedSettingsDataSource?.type || undefined,
    }),
    [normalizedSettingsDataSource],
  );

  const [form] = Form.useForm();
  const [error, setError] = useState<ModalErrorState>(null);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<
    SqlPreviewDataResponse | undefined
  >(undefined);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [generatingQuestion, setGeneratingQuestion] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);

  const sqlValue = Form.useWatch('sql', form);

  useEffect(() => {
    if (visible) {
      void fetchSettings(runtimeScopeNavigation.selector)
        .then((payload) => {
          setSettings(payload);
        })
        .catch((error) => {
          message.error(
            error instanceof Error
              ? error.message
              : '加载系统设置失败，请稍后重试。',
          );
        });
      form.setFieldsValue({
        question: defaultValue?.question,
        sql: defaultValue?.sql,
      });
    }
  }, [defaultValue, form, runtimeScopeNavigation.selector, visible]);

  const handleReset = () => {
    setPreviewData(undefined);
    setShowPreview(false);
    setError(null);
    form.resetFields();
  };

  const onValidateSQL = async () => {
    await validateSql(runtimeScopeNavigation.selector, sqlValue);
  };

  const handleError = (error: unknown) => {
    setError({
      message: error instanceof Error ? error.message : 'SQL 语法无效',
      shortMessage: 'SQL 语法无效',
      code: '',
      stacktrace: undefined,
    });
  };

  const onPreviewData = async () => {
    setError(null);
    setPreviewing(true);
    try {
      await onValidateSQL();
      setShowPreview(true);
      const data = await previewSql(runtimeScopeNavigation.selector, sqlValue);
      setPreviewData(data);
    } catch (error) {
      setShowPreview(false);
      setPreviewData(undefined);
      handleError(error);
    } finally {
      setPreviewing(false);
    }
  };

  const onSubmitButton = () => {
    setError(null);
    setSubmitting(true);
    setShowPreview(false);
    form
      .validateFields()
      .then(async (values) => {
        try {
          await onValidateSQL();
          if (onSubmit) {
            await onSubmit({ data: values, id: defaultValue?.id });
          }
          onClose();
        } catch (error) {
          handleError(error);
        } finally {
          setSubmitting(false);
        }
      })
      .catch((err) => {
        setSubmitting(false);
        message.error(err?.message || '保存失败，请稍后重试。');
      });
  };

  const onGenerateQuestion = async () => {
    try {
      setGeneratingQuestion(true);
      const question = await generateKnowledgeSqlPairQuestion(
        runtimeScopeNavigation.selector,
        sqlValue,
      );
      form.setFieldsValue({ question });
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : '生成问题失败，请稍后重试。',
      );
    } finally {
      setGeneratingQuestion(false);
    }
  };

  const confirmLoading = loading || submitting;
  const disabled = !sqlValue;

  return (
    <>
      <StyledModal
        title={isCreateMode ? '新增 SQL 模板' : '更新 SQL 模板'}
        centered
        closable
        confirmLoading={confirmLoading}
        destroyOnClose
        maskClosable={false}
        onCancel={onClose}
        visible={visible}
        width={640}
        cancelButtonProps={{ disabled: confirmLoading }}
        okButtonProps={{ disabled: previewing }}
        afterClose={() => handleReset()}
        footer={
          <Footer>
            <FooterHint>
              <InfoCircleOutlined className="mt-1" />
              <Typography.Text type="secondary" className="text-left">
                这里使用的是 <b>Wren SQL</b>，它基于 ANSI
                SQL，并针对当前语义引擎做了优化。{` `}
                <Typography.Link
                  type="secondary"
                  href="https://docs.getwren.ai/oss/guide/home/wren_sql"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  了解语法说明。
                </Typography.Link>
              </Typography.Text>
            </FooterHint>
            <div style={{ display: 'flex', gap: 12 }}>
              <Button onClick={onClose}>取消</Button>
              <Button
                type="primary"
                onClick={onSubmitButton}
                loading={confirmLoading}
              >
                提交
              </Button>
            </div>
          </Footer>
        }
      >
        <StyledForm form={form} preserve={false} layout="vertical">
          <Form.Item
            className="adm-question-form-item"
            label={
              <div
                className="d-flex justify-space-between"
                style={{ width: '100%' }}
              >
                <span>问题</span>
                <div className="gray-8 text-sm">
                  让 AI 为这条 SQL 自动生成匹配的问题描述。
                  <Button
                    className="ml-2"
                    size="small"
                    loading={generatingQuestion}
                    onClick={onGenerateQuestion}
                    disabled={disabled}
                  >
                    <span className="text-sm">生成问题</span>
                  </Button>
                </div>
              </div>
            }
            name="question"
            required
            rules={[
              {
                validator: createSQLPairQuestionValidator(
                  ERROR_TEXTS.SQL_PAIR.QUESTION,
                ),
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="SQL 语句"
            name="sql"
            required
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.SQL_PAIR.SQL.REQUIRED,
              },
            ]}
          >
            <SQLEditor
              toolbar={
                dataSource.isSupportSubstitute && (
                  <Toolbar
                    dataSource={dataSource.type}
                    onClick={() =>
                      importDataSourceSQLModal.openModal({
                        dataSource: dataSource.type || DataSourceName.BIG_QUERY,
                      })
                    }
                  />
                )
              }
              autoComplete
              autoFocus
            />
          </Form.Item>
        </StyledForm>
        <div className="my-3">
          <Typography.Text className="d-block gray-7 mb-2">
            数据预览（50 行）
          </Typography.Text>
          <Button
            onClick={onPreviewData}
            loading={previewing}
            disabled={disabled}
          >
            预览数据
          </Button>
          {showPreview && (
            <div className="my-3">
              <PreviewData
                loading={previewing}
                previewData={previewData}
                copyable={false}
              />
            </div>
          )}
        </div>
        {!!error && (
          <Alert
            showIcon
            type="error"
            message={error.shortMessage}
            description={<ErrorCollapse message={error.message} />}
          />
        )}
      </StyledModal>
      {dataSource.isSupportSubstitute && (
        <ImportDataSourceSQLModal
          {...importDataSourceSQLModal.state}
          onClose={importDataSourceSQLModal.closeModal}
          onSubmit={async (convertedSql: string) => {
            form.setFieldsValue({ sql: convertedSql });
          }}
        />
      )}
    </>
  );
}
