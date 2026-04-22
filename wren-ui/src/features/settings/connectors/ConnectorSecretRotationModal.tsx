import {
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Typography,
} from 'antd';
import {
  CONNECTOR_SECRET_ROTATION_HINT,
  type SecretReencryptSummary,
} from './connectorsPageUtils';

const { Paragraph, Text } = Typography;

type ConnectorSecretRotationModalProps = {
  open: boolean;
  scopeType: string;
  targetKeyVersionText: string;
  sourceKeyVersionText: string;
  summary?: SecretReencryptSummary | null;
  submittingMode?: 'dry-run' | 'execute' | null;
  rotateBlockedReason?: string | null;
  onClose: () => void;
  onScopeTypeChange: (value: string) => void;
  onTargetKeyVersionChange: (value: string) => void;
  onSourceKeyVersionChange: (value: string) => void;
  onDryRun: () => void | Promise<void>;
  onExecute: () => void | Promise<void>;
};

export default function ConnectorSecretRotationModal({
  open,
  scopeType,
  targetKeyVersionText,
  sourceKeyVersionText,
  summary,
  submittingMode,
  rotateBlockedReason,
  onClose,
  onScopeTypeChange,
  onTargetKeyVersionChange,
  onSourceKeyVersionChange,
  onDryRun,
  onExecute,
}: ConnectorSecretRotationModalProps) {
  return (
    <Modal
      title="批量轮换密钥"
      open={open}
      onCancel={onClose}
      destroyOnHidden
      footer={[
        <Button
          key="cancel"
          onClick={onClose}
          disabled={Boolean(submittingMode)}
        >
          取消
        </Button>,
        <Button
          key="dry-run"
          onClick={() => void onDryRun()}
          loading={submittingMode === 'dry-run'}
          disabled={
            Boolean(rotateBlockedReason) || submittingMode === 'execute'
          }
        >
          Dry-run
        </Button>,
        <Button
          key="execute"
          type="primary"
          danger
          onClick={() => void onExecute()}
          loading={submittingMode === 'execute'}
          disabled={
            Boolean(rotateBlockedReason) || submittingMode === 'dry-run'
          }
        >
          执行轮换
        </Button>,
      ]}
    >
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Paragraph type="secondary" className="mb-0">
          {CONNECTOR_SECRET_ROTATION_HINT}
        </Paragraph>
        <Form layout="vertical">
          <Form.Item label="作用域类型" style={{ marginBottom: 12 }}>
            <Select
              value={scopeType}
              options={[
                { label: 'connector', value: 'connector' },
                { label: 'skill', value: 'skill' },
              ]}
              onChange={onScopeTypeChange}
            />
          </Form.Item>
          <Form.Item label="目标 key version" style={{ marginBottom: 12 }}>
            <Input
              value={targetKeyVersionText}
              onChange={(event) => onTargetKeyVersionChange(event.target.value)}
              placeholder="例如 2"
            />
          </Form.Item>
          <Form.Item label="源 key version（可选）" style={{ marginBottom: 0 }}>
            <Input
              value={sourceKeyVersionText}
              onChange={(event) => onSourceKeyVersionChange(event.target.value)}
              placeholder="留空表示扫描所有非目标版本"
            />
          </Form.Item>
        </Form>

        {summary ? (
          <Descriptions
            bordered
            size="small"
            column={1}
            items={[
              {
                key: 'mode',
                label: '执行模式',
                children: summary.dryRun ? 'Dry-run' : 'Execute',
              },
              {
                key: 'overview',
                label: '处理概览',
                children: (
                  <Text>
                    扫描 {summary.scanned} 条 · 可处理 {summary.eligible} 条 ·
                    已更新 {summary.updated} 条
                  </Text>
                ),
              },
              {
                key: 'version',
                label: 'Key version',
                children: (
                  <Text>
                    目标版本：v{summary.targetKeyVersion}
                    {summary.filters?.sourceKeyVersion
                      ? ` · 源版本：v${summary.filters.sourceKeyVersion}`
                      : ''}
                    {summary.filters?.scopeType
                      ? ` · 作用域：${summary.filters.scopeType}`
                      : ''}
                  </Text>
                ),
              },
              {
                key: 'records',
                label: '样例记录',
                children:
                  summary.records?.length && summary.records.length > 0
                    ? summary.records
                        .slice(0, 3)
                        .map(
                          (record) =>
                            `${record.scopeType}:${record.scopeId} v${record.fromKeyVersion}→v${record.toKeyVersion}`,
                        )
                        .join('；')
                    : '—',
              },
            ]}
          />
        ) : null}
      </Space>
    </Modal>
  );
}
