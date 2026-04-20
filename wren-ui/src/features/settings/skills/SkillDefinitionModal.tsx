import {
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Typography,
  type FormInstance,
} from 'antd';
import {
  SKILL_CLEAR_SECRET_LABEL,
  SKILL_SECRET_EDIT_HINT,
  type SkillDefinitionFormValues,
} from './skillsPageUtils';
import type { SkillDefinitionView } from '@/utils/skillsRest';

const { Paragraph } = Typography;

export default function SkillDefinitionModal({
  open,
  editingDefinition,
  form,
  confirmLoading,
  connectorsLoading,
  connectorOptions,
  clearDefinitionSecretChecked,
  onClearDefinitionSecretCheckedChange,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  editingDefinition: SkillDefinitionView | null;
  form: FormInstance<SkillDefinitionFormValues>;
  confirmLoading: boolean;
  connectorsLoading: boolean;
  connectorOptions: Array<{ label: string; value: string }>;
  clearDefinitionSecretChecked: boolean;
  onClearDefinitionSecretCheckedChange: (checked: boolean) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal
      title={editingDefinition ? '编辑技能' : '添加技能'}
      open={open}
      onCancel={onCancel}
      onOk={onSubmit}
      confirmLoading={confirmLoading}
      destroyOnClose
      width={760}
    >
      <Form layout="vertical" form={form}>
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: '请输入技能名称' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="runtimeKind" label="运行时类型">
          <Input placeholder="isolated_python" />
        </Form.Item>
        <Form.Item name="sourceType" label="来源类型">
          <Input placeholder="inline / api / db" />
        </Form.Item>
        <Form.Item name="sourceRef" label="来源引用">
          <Input placeholder="可选的外部地址或内联来源引用" />
        </Form.Item>
        <Form.Item name="entrypoint" label="入口点">
          <Input placeholder="module:function or path" />
        </Form.Item>
        <Form.Item name="instruction" label="Instruction">
          <Input.TextArea
            rows={4}
            placeholder="输入注入 Ask / NL2SQL 主链的领域规则"
          />
        </Form.Item>
        <Form.Item name="executionMode" label="执行模式">
          <Select options={[{ label: 'inject_only', value: 'inject_only' }]} />
        </Form.Item>
        <Form.Item name="connectorId" label="连接器">
          <Select
            options={connectorOptions}
            placeholder="可选连接器"
            loading={connectorsLoading}
            allowClear
          />
        </Form.Item>
        <Form.Item name="enabled" label="启用" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="kbSuggestionIdsText" label="推荐知识库 ID（每行一个）">
          <Input.TextArea
            rows={3}
            placeholder="kb-1&#10;kb-2"
          />
        </Form.Item>
        <Form.Item name="runtimeConfigText" label="运行时配置 JSON">
          <Input.TextArea
            rows={6}
            placeholder='{"timeoutSec": 30, "toolName": "sales_skill"}'
          />
        </Form.Item>
        <Form.Item name="manifestText" label="清单 JSON">
          <Input.TextArea
            rows={6}
            placeholder='{"timeoutMs": 30000, "network": {"allow": ["api.example.com"]}}'
          />
        </Form.Item>
        <Paragraph type="secondary">{SKILL_SECRET_EDIT_HINT}</Paragraph>
        <Form.Item name="secretText" label="技能密钥 JSON">
          <Input.TextArea
            rows={4}
            placeholder='{"apiKey": "sk-***", "baseUrl": "https://api.example.com"}'
            disabled={clearDefinitionSecretChecked}
          />
        </Form.Item>
        {editingDefinition?.hasSecret ? (
          <Form.Item label={SKILL_CLEAR_SECRET_LABEL}>
            <Switch
              checked={clearDefinitionSecretChecked}
              onChange={onClearDefinitionSecretCheckedChange}
            />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
}
