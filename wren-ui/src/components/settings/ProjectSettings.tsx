import { useState } from 'react';
import { Button, Modal, Select, Row, Col, Form, message } from 'antd';
import { Path } from '@/utils/enum';
import { getLanguageText } from '@/utils/language';
import { ProjectLanguage } from '@/apollo/client/graphql/__types__';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import {
  resetCurrentProject,
  updateCurrentProjectLanguage,
} from '@/utils/settingsRest';
import { clearRuntimePagePrefetchCache } from '@/utils/runtimePagePrefetch';

interface Props {
  data: { language: string };
  refetchSettings?: () => Promise<unknown>;
}

export default function ProjectSettings(props: Props) {
  const { data, refetchSettings } = props;
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const languageOptions = Object.keys(ProjectLanguage).map((key) => {
    return { label: getLanguageText(key as ProjectLanguage), value: key };
  });

  const reset = () => {
    Modal.confirm({
      title: '确认要重置当前知识库吗？',
      okButtonProps: { danger: true, loading: resetting },
      okText: '确认重置',
      cancelText: '取消',
      onOk: async () => {
        try {
          setResetting(true);
          await resetCurrentProject(runtimeScopeNavigation.selector);
          clearRuntimePagePrefetchCache();
          runtimeScopeNavigation.push(Path.OnboardingConnection);
        } catch (error) {
          message.error(
            error instanceof Error
              ? error.message
              : '重置知识库失败，请稍后重试。',
          );
          throw error;
        } finally {
          setResetting(false);
        }
      },
    });
  };

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        try {
          setSaving(true);
          await updateCurrentProjectLanguage(
            runtimeScopeNavigation.selector,
            values.language,
          );
          await refetchSettings?.();
          message.success('知识库语言已更新。');
        } catch (error) {
          message.error(
            error instanceof Error
              ? error.message
              : '更新知识库语言失败，请稍后重试。',
          );
        } finally {
          setSaving(false);
        }
      })
      .catch(() => {
        // form validation errors are displayed by antd fields
      });
  };

  return (
    <div className="py-3 px-4">
      <Form
        form={form}
        layout="vertical"
        initialValues={{ language: data.language }}
      >
        <Form.Item
          label="知识库语言"
          extra="该设置会影响 AI 与你对话时的默认回复语言。"
        >
          <Row gutter={16} wrap={false}>
            <Col className="flex-grow-1">
              <Form.Item name="language" noStyle>
                <Select
                  placeholder="选择语言"
                  showSearch
                  options={languageOptions}
                />
              </Form.Item>
            </Col>
            <Col>
              <Button
                type="primary"
                style={{ width: 70 }}
                onClick={submit}
                loading={saving}
              >
                保存
              </Button>
            </Col>
          </Row>
        </Form.Item>
      </Form>
      <div className="gray-8 mb-2">重置当前知识库</div>
      <Button type="primary" style={{ width: 70 }} danger onClick={reset}>
        重置
      </Button>
      <div className="gray-6 mt-1">
        重置会删除当前知识库下的设置与记录，包括语义建模内容以及首页中的对话线程，请谨慎操作。
      </div>
    </div>
  );
}
