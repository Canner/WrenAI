import { Form, Input, Select } from 'antd';

import { WorkbenchEditorForm } from '@/features/knowledgePage/index.styles';

type KnowledgeInstructionFormFieldsProps = {
  isReadonly: boolean;
  ruleForm: any;
};

export default function KnowledgeInstructionFormFields({
  isReadonly,
  ruleForm,
}: KnowledgeInstructionFormFieldsProps) {
  return (
    <WorkbenchEditorForm form={ruleForm} layout="vertical">
      <Form.Item
        label="规则名称 / 首条问法"
        name="summary"
        rules={[{ required: true, message: '请输入分析规则描述' }]}
      >
        <Input disabled={isReadonly} placeholder="例如：GMV 统计口径" />
      </Form.Item>
      <Form.Item
        label="规则适用方式"
        name="scope"
        initialValue="all"
        rules={[{ required: true, message: '请选择规则适用方式' }]}
      >
        <Select
          disabled={isReadonly}
          options={[
            { label: '默认规则（全局生效）', value: 'all' },
            { label: '匹配问题（仅命中特定问法）', value: 'matched' },
          ]}
        />
      </Form.Item>
      <Form.Item
        label="分析规则内容"
        name="content"
        rules={[{ required: true, message: '请输入分析规则内容' }]}
      >
        <Input.TextArea
          disabled={isReadonly}
          rows={12}
          placeholder="请描述口径定义、字段约束、过滤条件和特殊说明。"
        />
      </Form.Item>
    </WorkbenchEditorForm>
  );
}
