import { Form, Input } from 'antd';

import { WorkbenchEditorForm } from '@/features/knowledgePage/index.styles';

type KnowledgeSqlTemplateFormFieldsProps = {
  isReadonly: boolean;
  sqlTemplateForm: any;
};

export default function KnowledgeSqlTemplateFormFields({
  isReadonly,
  sqlTemplateForm,
}: KnowledgeSqlTemplateFormFieldsProps) {
  return (
    <WorkbenchEditorForm form={sqlTemplateForm} layout="vertical">
      <Form.Item
        label="模板名称 / 典型问法"
        name="description"
        rules={[{ required: true, message: '请输入模板名称或典型问法' }]}
      >
        <Input disabled={isReadonly} placeholder="例如：最近 30 天 GMV 趋势" />
      </Form.Item>
      <Form.Item
        label="SQL 代码"
        name="sql"
        rules={[{ required: true, message: '请输入 SQL 语句' }]}
      >
        <Input.TextArea
          disabled={isReadonly}
          rows={14}
          placeholder="请输入可复用的 SQL 示例，建议优先沉淀稳定口径。"
        />
      </Form.Item>
    </WorkbenchEditorForm>
  );
}
