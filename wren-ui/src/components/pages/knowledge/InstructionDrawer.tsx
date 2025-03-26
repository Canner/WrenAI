import { Drawer, Tag, Typography } from 'antd';
import { getCompactTime } from '@/utils/time';
import QuestionOutlined from '@ant-design/icons/QuestionOutlined';
import { DrawerAction } from '@/hooks/useDrawerAction';
import GlobalLabel from '@/components/pages/knowledge/GlobalLabel';
import { Instruction } from '@/apollo/client/graphql/__types__';

const { Text } = Typography;

type Props = DrawerAction<Instruction>;

export default function InstructionDrawer(props: Props) {
  const { visible, defaultValue, onClose } = props;

  return (
    <Drawer
      closable
      destroyOnClose
      onClose={onClose}
      title="View instruction"
      visible={visible}
      width={760}
    >
      <div className="mb-6">
        <Typography.Text className="gray-7 mb-2">
          Instruction details
        </Typography.Text>
        <div>{defaultValue?.instruction || '-'}</div>
      </div>
      <div className="mb-6">
        <Typography.Text className="gray-7 mb-2">
          Matching questions
        </Typography.Text>
        <div>
          {defaultValue?.isDefault ? (
            <>
              <GlobalLabel />
              <Text className="gray-7 ml-2" type="secondary">
                (applies to all questions)
              </Text>
            </>
          ) : (
            defaultValue?.questions.map((question, index) => (
              <div key={`${question}-${index}`} className="my-2">
                <Tag className="bg-gray-1 border-gray-5">
                  <QuestionOutlined className="geekblue-6" />
                  <Text className="gray-9">{question}</Text>
                </Tag>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="mb-6">
        <Typography.Text className="gray-7 mb-2">Created time</Typography.Text>
        <div>
          {defaultValue?.createdAt
            ? getCompactTime(defaultValue.createdAt)
            : '-'}
        </div>
      </div>
    </Drawer>
  );
}
