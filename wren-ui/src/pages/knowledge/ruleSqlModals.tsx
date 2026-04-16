import { memo } from 'react';
import { Form, Input, Typography } from 'antd';
import ArrowLeftOutlined from '@ant-design/icons/ArrowLeftOutlined';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import type { FormInstance } from 'antd';
import type { Instruction, SqlPair } from '@/types/api';
import type {
  RuleDetailFormValues,
  SqlTemplateFormValues,
} from '@/hooks/useKnowledgeRuleSqlManager';
import { REFERENCE_MODAL_MASK_STYLE } from './constants';
import {
  BackButton,
  BackTitle,
  CodeEditorGutter,
  CodeEditorShell,
  CodeEditorTextArea,
  DetailForm,
  DetailFormBody,
  DetailModalPanel,
  KnowledgeManageModalPanel,
  LargeTextArea,
  LightButton,
  ManageBody,
  ManageCreateCard,
  ManageCreatePlus,
  ManageCreateText,
  ManageHeaderMain,
  ManageHintLink,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
  ModalIntro,
  ModalTitle,
  PurpleButton,
  ReferenceModal,
  ScopeSelect,
} from './index.styles';
import { RuleManageEntryList, SqlManageEntryList } from './lists';

const { Text } = Typography;

type RuleSqlModalsProps = {
  ruleManageOpen: boolean;
  ruleManageLoading: boolean;
  ruleList: Instruction[];
  ruleDetailOpen: boolean;
  sqlManageOpen: boolean;
  sqlManageLoading: boolean;
  sqlList: SqlPair[];
  sqlDetailOpen: boolean;
  ruleForm: FormInstance<RuleDetailFormValues>;
  sqlTemplateForm: FormInstance<SqlTemplateFormValues>;
  createInstructionLoading: boolean;
  updateInstructionLoading: boolean;
  createSqlPairLoading: boolean;
  updateSqlPairLoading: boolean;
  openRuleDetail: (instruction?: Instruction) => void;
  closeRuleManageModal: () => void;
  closeRuleDetail: () => void;
  backToRuleManageModal: () => void;
  handleDeleteRule: (instruction: Instruction) => Promise<void> | void;
  submitRuleDetail: () => Promise<void> | void;
  openSqlTemplateDetail: (sqlPair?: SqlPair) => void;
  closeSqlManageModal: () => void;
  closeSqlDetail: () => void;
  backToSqlManageModal: () => void;
  handleDeleteSqlTemplate: (sqlPair: SqlPair) => Promise<void> | void;
  submitSqlTemplateDetail: () => Promise<void> | void;
};

function RuleSqlModals({
  ruleManageOpen,
  ruleManageLoading,
  ruleList,
  ruleDetailOpen,
  sqlManageOpen,
  sqlManageLoading,
  sqlList,
  sqlDetailOpen,
  ruleForm,
  sqlTemplateForm,
  createInstructionLoading,
  updateInstructionLoading,
  createSqlPairLoading,
  updateSqlPairLoading,
  openRuleDetail,
  closeRuleManageModal,
  closeRuleDetail,
  backToRuleManageModal,
  handleDeleteRule,
  submitRuleDetail,
  openSqlTemplateDetail,
  closeSqlManageModal,
  closeSqlDetail,
  backToSqlManageModal,
  handleDeleteSqlTemplate,
  submitSqlTemplateDetail,
}: RuleSqlModalsProps) {
  return (
    <>
      <ReferenceModal
        visible={ruleManageOpen}
        title={null}
        footer={null}
        closable={false}
        onCancel={closeRuleManageModal}
        width={980}
        maskStyle={REFERENCE_MODAL_MASK_STYLE}
        destroyOnClose
      >
        <KnowledgeManageModalPanel>
          <ModalHeader>
            <ManageHeaderMain>
              <ModalTitle>分析规则管理</ModalTitle>
              <ModalIntro>
                可配置分析规则，让模型遵循你的业务规范和偏好。
              </ModalIntro>
              <ManageHintLink
                href="https://docs.getwren.ai"
                target="_blank"
                rel="noopener noreferrer"
              >
                查看标注规范 &gt;
              </ManageHintLink>
            </ManageHeaderMain>
            <ModalCloseButton type="button" onClick={closeRuleManageModal}>
              <CloseOutlined />
            </ModalCloseButton>
          </ModalHeader>

          <ManageBody>
            <ManageCreateCard type="button" onClick={() => openRuleDetail()}>
              <ManageCreatePlus>+</ManageCreatePlus>
              <ManageCreateText>添加分析规则</ManageCreateText>
            </ManageCreateCard>

            {ruleManageLoading ? <Text type="secondary">加载中...</Text> : null}

            {!ruleManageLoading && ruleList.length > 0 ? (
              <RuleManageEntryList
                ruleList={ruleList}
                onEdit={openRuleDetail}
                onDelete={handleDeleteRule}
              />
            ) : null}
          </ManageBody>
        </KnowledgeManageModalPanel>
      </ReferenceModal>

      <ReferenceModal
        visible={sqlManageOpen}
        title={null}
        footer={null}
        closable={false}
        onCancel={closeSqlManageModal}
        width={1120}
        maskStyle={REFERENCE_MODAL_MASK_STYLE}
        destroyOnClose
      >
        <KnowledgeManageModalPanel>
          <ModalHeader>
            <ManageHeaderMain>
              <ModalTitle>SQL模板</ModalTitle>
              <ModalIntro>可配置 SQL 模板供模型参考，提升模型表现。</ModalIntro>
              <ManageHintLink
                href="https://docs.getwren.ai"
                target="_blank"
                rel="noopener noreferrer"
              >
                查看标注规范 &gt;
              </ManageHintLink>
            </ManageHeaderMain>
            <ModalCloseButton type="button" onClick={closeSqlManageModal}>
              <CloseOutlined />
            </ModalCloseButton>
          </ModalHeader>

          <ManageBody>
            <ManageCreateCard
              type="button"
              onClick={() => openSqlTemplateDetail()}
            >
              <ManageCreatePlus>+</ManageCreatePlus>
              <ManageCreateText>添加SQL</ManageCreateText>
            </ManageCreateCard>

            {sqlManageLoading ? <Text type="secondary">加载中...</Text> : null}

            {!sqlManageLoading && sqlList.length > 0 ? (
              <SqlManageEntryList
                sqlList={sqlList}
                onEdit={openSqlTemplateDetail}
                onDelete={handleDeleteSqlTemplate}
              />
            ) : null}
          </ManageBody>
        </KnowledgeManageModalPanel>
      </ReferenceModal>

      <ReferenceModal
        visible={ruleDetailOpen}
        title={null}
        footer={null}
        closable={false}
        onCancel={closeRuleDetail}
        width={1020}
        maskStyle={REFERENCE_MODAL_MASK_STYLE}
        destroyOnClose
      >
        <DetailModalPanel>
          <ModalHeader>
            <BackTitle>
              <BackButton type="button" onClick={backToRuleManageModal}>
                <ArrowLeftOutlined />
              </BackButton>
              <ModalTitle>分析规则详情</ModalTitle>
            </BackTitle>
            <ModalCloseButton type="button" onClick={closeRuleDetail}>
              <CloseOutlined />
            </ModalCloseButton>
          </ModalHeader>

          <DetailForm form={ruleForm} layout="vertical">
            <DetailFormBody>
              <Form.Item
                label="分析规则描述"
                name="summary"
                rules={[{ required: true, message: '请输入分析规则描述' }]}
              >
                <Input placeholder="请输入分析规则描述，如输出要求、取数规则、绘制图表规则等" />
              </Form.Item>

              <Form.Item label="适用范围" name="scope" initialValue="all">
                <ScopeSelect
                  options={[
                    { label: '全部资产', value: 'all' },
                    { label: '匹配问题', value: 'matched' },
                  ]}
                />
              </Form.Item>

              <Form.Item
                label="分析规则内容"
                name="content"
                rules={[{ required: true, message: '请输入分析规则内容' }]}
              >
                <LargeTextArea
                  showCount
                  maxLength={8000}
                  placeholder={`请输入分析规则标题大类下的具体规则描述，下面给出一些例子：\n- 以输出要求为例：1）图文并茂；2）需要给出深刻和高价值的建议...\n- 以取数规则为例：统计会话数必须限制 content LIKE '%selectedNodes%' ...\n- 绘制图表规则为例：要求所有图表必须是左边是图，右边是源数据表的呈现方式`}
                />
              </Form.Item>
            </DetailFormBody>
          </DetailForm>

          <ModalFooter>
            <LightButton onClick={backToRuleManageModal}>返回</LightButton>
            <PurpleButton
              loading={createInstructionLoading || updateInstructionLoading}
              onClick={submitRuleDetail}
            >
              确认
            </PurpleButton>
          </ModalFooter>
        </DetailModalPanel>
      </ReferenceModal>

      <ReferenceModal
        visible={sqlDetailOpen}
        title={null}
        footer={null}
        closable={false}
        onCancel={closeSqlDetail}
        width={1280}
        maskStyle={REFERENCE_MODAL_MASK_STYLE}
        destroyOnClose
      >
        <DetailModalPanel>
          <ModalHeader>
            <BackTitle>
              <BackButton type="button" onClick={backToSqlManageModal}>
                <ArrowLeftOutlined />
              </BackButton>
              <ModalTitle>SQL模板详情</ModalTitle>
            </BackTitle>
            <ModalCloseButton type="button" onClick={closeSqlDetail}>
              <CloseOutlined />
            </ModalCloseButton>
          </ModalHeader>

          <DetailForm form={sqlTemplateForm} layout="vertical">
            <DetailFormBody>
              <Form.Item
                label="代码"
                name="sql"
                rules={[{ required: true, message: '请输入 SQL 语句' }]}
              >
                <CodeEditorShell>
                  <CodeEditorGutter>1</CodeEditorGutter>
                  <CodeEditorTextArea rows={12} />
                </CodeEditorShell>
              </Form.Item>

              <Form.Item label="适用范围" name="scope" initialValue="all">
                <ScopeSelect
                  style={{ width: 170 }}
                  options={[
                    { label: '全部资产', value: 'all' },
                    { label: '匹配问题', value: 'matched' },
                  ]}
                />
              </Form.Item>

              <Form.Item
                label="AI 模板描述"
                name="description"
                rules={[{ required: true, message: '请输入 SQL 模板描述' }]}
              >
                <Input.TextArea
                  rows={5}
                  placeholder="请输入入该 SQL 模板的描述，例如：某个业务指标的固定查询逻辑或口径说明。"
                />
              </Form.Item>
            </DetailFormBody>
          </DetailForm>

          <ModalFooter>
            <LightButton onClick={backToSqlManageModal}>返回</LightButton>
            <PurpleButton
              loading={createSqlPairLoading || updateSqlPairLoading}
              onClick={submitSqlTemplateDetail}
            >
              确认
            </PurpleButton>
          </ModalFooter>
        </DetailModalPanel>
      </ReferenceModal>
    </>
  );
}

export default memo(RuleSqlModals);
