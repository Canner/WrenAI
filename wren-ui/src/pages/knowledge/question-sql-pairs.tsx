import dynamic from 'next/dynamic';
import Link from 'next/link';
import styled from 'styled-components';
import { Button, Table, TableColumnsType, Typography } from 'antd';
import SiderLayout from '@/components/layouts/SiderLayout';
import FunctionOutlined from '@ant-design/icons/FunctionOutlined';
import { MORE_ACTION } from '@/utils/enum';
import useModalAction from '@/hooks/useModalAction';
import { MoreButton } from '@/components/ActionButton';
import { SQLPairDropdown } from '@/components/diagram/CustomDropdown';

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

  const data = [
    {
      id: 1,
      question: 'Show me the total sales for last month.',
      sql: "SELECT SUM(amount) FROM sales WHERE DATE_TRUNC('month', order_date) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month');",
    },
    {
      id: 2,
      question: 'List all active customers.',
      sql: "SELECT id, name, email FROM customers WHERE status = 'active';",
    },
    {
      id: 3,
      question: 'What was the highest revenue product last year?',
      sql: 'SELECT product_name, SUM(revenue) AS total_revenue FROM sales WHERE YEAR(order_date) = YEAR(CURRENT_DATE) - 1 GROUP BY product_name ORDER BY total_revenue DESC LIMIT 1;',
    },
    {
      id: 4,
      question:
        'What are the top 3 value for orders placed by customers in each city?',
      sql: `SELECT\n  \"olist_customers_dataset\".\"customer_city\" AS \"customer_city\",\n  \"olist_orders_dataset\".\"order_id\" AS \"order_id\",\n  SUM(\"olist_order_items_dataset\".\"price\") AS \"total_value\"\nFROM\n  \"olist_customers_dataset\"\n  JOIN \"olist_orders_dataset\" ON \"olist_customers_dataset\".\"customer_id\" = \"olist_orders_dataset\".\"customer_id\"\n  JOIN \"olist_order_items_dataset\" ON \"olist_orders_dataset\".\"order_id\" = \"olist_order_items_dataset\".\"order_id\"\nGROUP BY\n  \"olist_customers_dataset\".\"customer_city\",\n  \"olist_orders_dataset\".\"order_id\"\nORDER BY\n  \"total_value\" DESC\nLIMIT\n  3`,
    },
  ];

  const onMoreClick = async (payload) => {
    const { type, data } = payload;
    if (type === MORE_ACTION.DELETE) {
      // TODO: delete
    } else if (type === MORE_ACTION.EDIT) {
      questionSqlPairModal.openModal(data);
    } else if (type === MORE_ACTION.VIEW_SQL_PAIR) {
      // TODO: view sql pair
    }
  };

  const columns: TableColumnsType<any> = [
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
          dataSource={data}
          columns={columns}
          className="mt-3"
          rowKey="id"
          pagination={{
            hideOnSinglePage: true,
            pageSize: 10,
            size: 'small',
          }}
        />
      </div>
    </SiderLayout>
  );
}
