import dynamic from 'next/dynamic';
import Link from 'next/link';
import styled from 'styled-components';
import { Button, message, Table, TableColumnsType, Typography } from 'antd';
import { format } from 'sql-formatter';
import SiderLayout from '@/components/layouts/SiderLayout';
import FunctionOutlined from '@ant-design/icons/FunctionOutlined';
import { MORE_ACTION } from '@/utils/enum';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import { MoreButton } from '@/components/ActionButton';
import { SQLPairDropdown } from '@/components/diagram/CustomDropdown';
import QuestionSQLPairModal from '@/components/modals/QuestionSQLPairModal';
import SQLPairDrawer from '@/components/pages/knowledge/SQLPairDrawer';
import { SqlPair } from '@/apollo/client/graphql/__types__';
import {
  useSqlPairsQuery,
  useCreateSqlPairMutation,
  useUpdateSqlPairMutation,
  useDeleteSqlPairMutation,
} from '@/apollo/client/graphql/sqlPairs.generated';

const CodeBlock = dynamic(() => import('@/components/editor/CodeBlock'), {
  ssr: false,
});

const { Title, Text } = Typography;

const StyledQuestionBlock = styled.div`
  width: 100%;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  white-space: normal;
`;

export default function ManageQuestionSQLPairs() {
  const questionSqlPairModal = useModalAction();
  const sqlPairDrawer = useDrawerAction();

  const { data, loading } = useSqlPairsQuery({
    fetchPolicy: 'cache-and-network',
  });
  const sqlPairs = data?.sqlPairs || [];

  const getBaseOptions = (options) => {
    return {
      onError: (error) => console.error(error),
      refetchQueries: ['SqlPairs'],
      awaitRefetchQueries: true,
      ...options,
    };
  };

  const [createSqlPairMutation, { loading: createSqlPairLoading }] =
    useCreateSqlPairMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully created question-sql pair.');
        },
      }),
    );

  const [deleteSqlPairMutation] = useDeleteSqlPairMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully deleted question-sql pair.');
      },
    }),
  );

  const [editSqlPairMutation, { loading: editSqlPairLoading }] =
    useUpdateSqlPairMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully updated question-sql pair.');
        },
      }),
    );

  const onMoreClick = async (payload) => {
    const { type, data } = payload;
    if (type === MORE_ACTION.DELETE) {
      await deleteSqlPairMutation({
        variables: { where: { id: data.id } },
      });
    } else if (type === MORE_ACTION.EDIT) {
      questionSqlPairModal.openModal(data);
    } else if (type === MORE_ACTION.VIEW_SQL_PAIR) {
      sqlPairDrawer.openDrawer({ ...data, sql: format(data.sql) });
    }
  };

  const columns: TableColumnsType<SqlPair> = [
    {
      title: 'Question',
      dataIndex: 'question',
      ellipsis: true,
      render: (question) => (
        <StyledQuestionBlock className="text-truncate">
          {question}
        </StyledQuestionBlock>
      ),
    },
    {
      title: 'SQL Statement',
      dataIndex: 'sql',
      width: '60%',
      render: (sql) => (
        <div style={{ width: '100%' }}>
          <CodeBlock code={sql} multipleLine={3} />
        </div>
      ),
    },
    {
      key: 'action',
      width: 64,
      align: 'center',
      render: (_, record) => (
        <SQLPairDropdown onMoreClick={onMoreClick} data={record}>
          <MoreButton className="gray-8" />
        </SQLPairDropdown>
      ),
    },
  ];

  return (
    <SiderLayout loading={false}>
      <div className="px-6 py-4">
        <div className="d-flex align-center justify-space-between mb-3">
          <Title level={4} className="text-medium gray-8 mb-0">
            <FunctionOutlined className="mr-2 gray-8" />
            Manage Question-SQL Pairs
          </Title>
          <Button
            type="primary"
            className=""
            onClick={() => questionSqlPairModal.openModal()}
          >
            Add Question-SQL Pair
          </Button>
        </div>
        <Text className="gray-7">
          On this page, you can manage your saved Question-SQL Pairs. These
          pairs help Wren AI learn how your organization writes SQL, allowing it
          to generate queries that better align with your expectations.{' '}
          <Link
            className="gray-8 underline"
            href="https://docs.getwren.ai/oss/guide/knowledge/question-sql-pairs"
            rel="noopener noreferrer"
            target="_blank"
          >
            Learn more.
          </Link>
        </Text>
        <Table
          dataSource={sqlPairs}
          loading={loading}
          columns={columns}
          className="mt-3"
          rowKey="id"
          pagination={{
            hideOnSinglePage: true,
            pageSize: 10,
            size: 'small',
          }}
        />
        <SQLPairDrawer
          {...sqlPairDrawer.state}
          onClose={sqlPairDrawer.closeDrawer}
        />
        <QuestionSQLPairModal
          {...questionSqlPairModal.state}
          onClose={questionSqlPairModal.closeModal}
          loading={createSqlPairLoading || editSqlPairLoading}
          onSubmit={async ({ id, data }) => {
            if (id) {
              await editSqlPairMutation({
                variables: { where: { id }, data },
              });
            } else {
              await createSqlPairMutation({ variables: { data } });
            }
          }}
        />
      </div>
    </SiderLayout>
  );
}
