import Link from 'next/link';
import { Button, Tag, Table, TableColumnsType, Typography } from 'antd';
import styled from 'styled-components';
import SiderLayout from '@/components/layouts/SiderLayout';
import { InstructionsSVG } from '@/utils/svgs';
import QuestionOutlined from '@ant-design/icons/QuestionOutlined';
import { MORE_ACTION } from '@/utils/enum';
import { getCompactTime } from '@/utils/time';
import { MoreButton } from '@/components/ActionButton';
import { InstructionDropdown } from '@/components/diagram/CustomDropdown';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import GlobalLabel from '@/components/pages/knowledge/GlobalLabel';
import InstructionModal from '@/components/modals/InstructionModal';
import InstructionDrawer from '@/components/pages/knowledge/InstructionDrawer';

const { Paragraph, Title, Text } = Typography;

const StyledQuestionsBlock = styled.div`
  margin: -2px -4px;
`;

const StyledTag = styled(Tag)`
  &.ant-tag.ant-tag {
    display: inline-block;
    margin: 2px 4px;
    max-width: 100%;
  }
`;

export default function ManageInstructions() {
  const instructionModal = useModalAction();
  const instructionDrawer = useDrawerAction();

  const onMoreClick = async (payload) => {
    const { type, data } = payload;
    if (type === MORE_ACTION.DELETE) {
      // TODO: Implement delete instruction
    } else if (type === MORE_ACTION.EDIT) {
      instructionModal.openModal(data);
    } else if (type === MORE_ACTION.VIEW_INSTRUCTION) {
      instructionDrawer.openDrawer(data);
    }
  };

  const data = [
    {
      id: '1',
      projectId: 'project-1',
      instruction:
        "When querying customer transactions, always filter by status != 'CANCELLED' unless explicitly asked for cancelled transactions.",
      questions: [],
      isDefault: true,
      createdAt: '2025-03-17 13:00',
      updatedAt: '2025-03-17 13:00',
    },
    {
      id: '2',
      projectId: 'project-1',
      instruction:
        "Exclude inactive or discontinued products unless explicitly asked (WHERE product_status = 'ACTIVE').",
      questions: [
        'list all available products',
        'who are the top buyers?',
        '+1',
        '+2',
        '+3',
        '+4',
        '+5',
      ],
      isDefault: false,
      createdAt: '2025-03-17 13:00',
      updatedAt: '2025-03-17 13:00',
    },
    {
      id: '3',
      projectId: 'project-1',
      instruction: 'What was the highest revenue product last year?',
      questions: ['list all available products'],
      isDefault: false,
      createdAt: '2025-03-17 13:00',
      updatedAt: '2025-03-17 13:00',
    },
    {
      id: '4',
      projectId: 'project-1',
      instruction:
        'XXX (If the Instruction Details are longer than three lines, they will be shown ellipsis) XXX XXX XXX XXX XXX XXX XXX XXX XXX XXX XXX XXX XXX XXX XXX XXX XXX XXX XXX XXX',
      questions: [
        'who are the top buyers?',
        'XXX (If the Instruction Details are longer than three lines, they will be shown ellipsis) XXX XXX OO',
        '+1',
      ],
      isDefault: false,
      createdAt: '2025-03-17 13:00',
      updatedAt: '2025-03-17 13:00',
    },
    {
      id: '5',
      projectId: 'project-1',
      instruction:
        'Pagila is a fictional DVD rental store database designed to model the operations of a typical rental business. It includes various tables that represent key entities such as films, actors, film categories, stores, customers, and payments. The database structure supports common rental store functionalities, including tracking movie inventory across different store locations, managing customer memberships, processing rentals and returns, and recording payment transactions. By organizing data into relational tables, Pagila enables efficient queries and reporting, making it a useful dataset for learning SQL and database management concepts.',
      questions: [
        'How does Pagila track the availability of films across different store locations?',
        'What relationships exist between the customers, rentals, and payments tables?',
        'How does the database handle film categorization and actor-film associations',
      ],
      isDefault: false,
      createdAt: '2025-03-17 13:00',
      updatedAt: '2025-03-17 13:00',
    },
    {
      id: '6',
      projectId: 'project-1',
      instruction: 'list all available products',
      questions: ['list all available products', 'who are the top top buyers?'],
      isDefault: false,
      createdAt: '2025-03-17 13:00',
      updatedAt: '2025-03-17 13:00',
    },
  ];

  const columns: TableColumnsType<any> = [
    {
      title: 'Instruction Details',
      dataIndex: 'instruction',
      render: (instruction) => (
        <Paragraph title={instruction} ellipsis={{ rows: 3 }}>
          {instruction}
        </Paragraph>
      ),
    },
    {
      title: 'Matching Questions',
      dataIndex: 'questions',
      width: '50%',
      render: (questions, record) => {
        if (record.isDefault) return <GlobalLabel />;

        const displayQuestions = questions.slice(0, 2);
        const moreCount = questions.length - 2;

        return (
          <StyledQuestionsBlock>
            {displayQuestions.map((question) => (
              <div key={question} className="mb-1">
                <StyledTag className="bg-gray-1 border-gray-5 text-truncate">
                  <QuestionOutlined className="geekblue-6" />
                  <Text className="gray-9" title={question}>
                    {question}
                  </Text>
                </StyledTag>
              </div>
            ))}
            {moreCount > 0 && (
              <div className="text-sm gray-7 pl-1">
                +{moreCount} more question{moreCount > 1 ? 's' : ''}
              </div>
            )}
          </StyledQuestionsBlock>
        );
      },
    },
    {
      title: 'Created Time',
      dataIndex: 'createdAt',
      width: 130,
      render: (time) => <Text className="gray-7">{getCompactTime(time)}</Text>,
    },
    {
      key: 'action',
      width: 64,
      align: 'center',
      fixed: 'right',
      render: (_, record) => (
        <InstructionDropdown onMoreClick={onMoreClick} data={record}>
          <MoreButton className="gray-8" />
        </InstructionDropdown>
      ),
    },
  ];

  return (
    <SiderLayout loading={false}>
      <div className="px-6 py-4">
        <div className="d-flex align-center justify-space-between mb-3">
          <Title level={4} className="text-medium gray-8 mb-0">
            <InstructionsSVG className="mr-2 gray-8" />
            Manage Instructions
          </Title>
          <Button
            type="primary"
            className=""
            onClick={() => instructionModal.openModal()}
          >
            Add an Instruction
          </Button>
        </div>
        <Text className="gray-7">
          On this page, you can manage saved instructions that guide Wren AI in
          generating SQL queries. These instructions help Wren AI understand
          your data model and business rules, improving query accuracy and
          reducing the need for manual refinements.{' '}
          <Link
            className="gray-8 underline"
            href="https://docs.getwren.ai/oss/guide/knowledge/instructions"
            rel="noopener noreferrer"
            target="_blank"
          >
            Learn more.
          </Link>
        </Text>
        <Table
          dataSource={data}
          loading={false}
          columns={columns}
          className="mt-3"
          rowKey="id"
          pagination={{
            hideOnSinglePage: true,
            pageSize: 10,
            size: 'small',
          }}
          scroll={{ x: 1080 }}
        />
        <InstructionDrawer
          {...instructionDrawer.state}
          onClose={instructionDrawer.closeDrawer}
        />
        <InstructionModal
          {...instructionModal.state}
          onClose={instructionModal.closeModal}
          loading={false}
          onSubmit={async (data) => {
            console.log('submit instruction', data);
            // TODO: Implement submit instruction
          }}
        />
      </div>
    </SiderLayout>
  );
}
