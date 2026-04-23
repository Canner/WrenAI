import { Button, Typography, Timeline } from 'antd';
import CloseCircleFilled from '@ant-design/icons/CloseCircleFilled';
import ToolOutlined from '@ant-design/icons/ToolOutlined';
import useModalAction from '@/hooks/useModalAction';
import ErrorCollapse from '@/components/ErrorCollapse';
import { FixSQLModal } from '@/components/modals/FixSQLModal';
import type { Error } from '@/types/home';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';

export interface Props {
  children: React.ReactNode;
  error?: Error & {
    invalidSql?: string;
    fixStatement?: (sql: string) => Promise<void>;
    fixStatementLoading?: boolean;
  };
}

export default function ErrorBoundary({ children, error }: Props) {
  const fixItModal = useModalAction();
  if (!error) return <>{children}</>;
  const errorMessage = resolveAbortSafeErrorMessage(
    error.message,
    '回答生成失败，请稍后重试。',
  );
  if (!errorMessage) {
    return <>{children}</>;
  }
  const shortMessage =
    resolveAbortSafeErrorMessage(error.shortMessage, errorMessage) ||
    '回答生成失败';
  const hasInvalidSql = !!error.invalidSql;
  return (
    <Timeline
      className="px-1 -mb-4"
      items={[
        {
          key: 'error',
          icon: <CloseCircleFilled className="red-5" />,
          content: (
            <>
              <Typography.Text className="gray-8">
                {hasInvalidSql
                  ? 'Failed to generate SQL statement'
                  : shortMessage}
              </Typography.Text>
              <div className="gray-7 text-sm mt-1">
                <div>
                  {hasInvalidSql
                    ? 'We tried to generate SQL based on your question but encountered a small issue. Help us fix it!'
                    : errorMessage}
                </div>
                {hasInvalidSql && (
                  <>
                    <div className="bg-gray-2 p-2 my-4">
                      <ErrorCollapse message={errorMessage} defaultActive />
                    </div>
                    <Button
                      className="mt-2 adm-fix-it-btn"
                      icon={<ToolOutlined />}
                      size="small"
                      onClick={() =>
                        fixItModal.openModal({ sql: error.invalidSql || '' })
                      }
                    >
                      Fix it
                    </Button>
                    <FixSQLModal
                      {...fixItModal.state}
                      loading={error.fixStatementLoading}
                      onClose={fixItModal.closeModal}
                      onSubmit={async (sql: string) => {
                        await error.fixStatement?.(sql);
                      }}
                    />
                  </>
                )}
              </div>
            </>
          ),
        },
      ]}
    />
  );
}
