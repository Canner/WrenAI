import { useMemo } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Divider,
  Empty,
  Form,
  Input,
  Row,
  Col,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import type { CollapseProps } from 'antd';
import SafetyCertificateOutlined from '@ant-design/icons/SafetyCertificateOutlined';
import {
  formatDateTime,
  formatUserLabel,
} from '@/features/settings/workspaceGovernanceShared';
import {
  BREAK_GLASS_DURATION_OPTIONS,
  BREAK_GLASS_ROLE_OPTIONS,
  getAccessReviewDecisionColor,
  getAccessReviewStatusColor,
  PERMISSION_ROLE_LABELS,
} from './permissionsPageUtils';

const { Text, Title } = Typography;

import type {
  AccessReview,
  BreakGlassGrant,
  Member,
  ReviewActionDecision,
} from './permissionsGovernanceControlTypes';

const STACK_ITEM_STYLE = {
  padding: '12px 14px',
  border: '1px solid var(--ant-color-border-secondary)',
  borderRadius: 8,
  background: 'var(--ant-color-bg-container)',
} as const;

export default function PermissionsGovernanceControlsSection({
  canManageControls,
  accessReviewCount,
  activeBreakGlassCount,
  accessReviews,
  members,
  reviewActionLoading,
  accessReviewTitle,
  accessReviewLoading,
  breakGlassTargetOptions,
  breakGlassUserId,
  breakGlassRoleKey,
  breakGlassReason,
  breakGlassDurationMinutes,
  breakGlassLoading,
  breakGlassGrants,
  ownerCandidateOptions,
  impersonationTargetUserId,
  impersonationReason,
  impersonationLoading,
  impersonationActive,
  impersonationReasonLabel,
  onAccessReviewTitleChange,
  onCreateAccessReview,
  onReviewAccessItem,
  onBreakGlassUserIdChange,
  onBreakGlassRoleKeyChange,
  onBreakGlassReasonChange,
  onBreakGlassDurationMinutesChange,
  onCreateBreakGlassGrant,
  onRevokeBreakGlassGrant,
  onImpersonationTargetUserIdChange,
  onImpersonationReasonChange,
  onStartImpersonation,
}: {
  canManageControls: boolean;
  accessReviewCount: number;
  activeBreakGlassCount: number;
  accessReviews: AccessReview[];
  members: Member[];
  reviewActionLoading: {
    reviewId: string;
    itemId: string;
    decision: ReviewActionDecision;
  } | null;
  accessReviewTitle: string;
  accessReviewLoading: boolean;
  breakGlassTargetOptions: Array<{ label: string; value: string }>;
  breakGlassUserId: string | null;
  breakGlassRoleKey: string;
  breakGlassReason: string;
  breakGlassDurationMinutes: string;
  breakGlassLoading: boolean;
  breakGlassGrants: BreakGlassGrant[];
  ownerCandidateOptions: Array<{ label: string; value: string }>;
  impersonationTargetUserId: string | null;
  impersonationReason: string;
  impersonationLoading: boolean;
  impersonationActive?: boolean;
  impersonationReasonLabel?: string | null;
  onAccessReviewTitleChange: (value: string) => void;
  onCreateAccessReview: () => void;
  onReviewAccessItem: (
    reviewId: string,
    itemId: string,
    decision: ReviewActionDecision,
  ) => void;
  onBreakGlassUserIdChange: (value: string | null) => void;
  onBreakGlassRoleKeyChange: (value: string) => void;
  onBreakGlassReasonChange: (value: string) => void;
  onBreakGlassDurationMinutesChange: (value: string) => void;
  onCreateBreakGlassGrant: () => void;
  onRevokeBreakGlassGrant: (grantId: string) => void;
  onImpersonationTargetUserIdChange: (value: string | null) => void;
  onImpersonationReasonChange: (value: string) => void;
  onStartImpersonation: () => void;
}) {
  const memberMap = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members],
  );
  const accessReviewItems: CollapseProps['items'] = accessReviews
    .slice(0, 2)
    .map((review) => ({
      key: review.id,
      label: (
        <Space size={[8, 8]} wrap>
          <Text strong>{review.title}</Text>
          <Tag color={getAccessReviewStatusColor(review.status)}>
            {review.status === 'completed' ? '已完成' : '进行中'}
          </Tag>
          <Text type="secondary">{formatDateTime(review.createdAt)}</Text>
        </Space>
      ),
      children:
        (review.items || []).slice(0, 3).length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该复核暂无成员项"
          />
        ) : (
          <Space orientation="vertical" size={8} style={{ width: '100%' }}>
            {(review.items || []).slice(0, 3).map((item) => {
              const member = item.userId
                ? memberMap.get(item.userId)
                : undefined;
              const busy =
                reviewActionLoading?.reviewId === review.id &&
                reviewActionLoading?.itemId === item.id;

              return (
                <Row
                  key={item.id}
                  gutter={[12, 12]}
                  align="middle"
                  justify="space-between"
                  style={STACK_ITEM_STYLE}
                >
                  <Col flex="auto">
                    <Space orientation="vertical" size={4}>
                      <Text strong>
                        {formatUserLabel(
                          member?.user?.displayName,
                          member?.user?.email,
                          item.userId || item.id,
                        )}
                      </Text>
                      <Space size={[8, 8]} wrap>
                        <Tag color="blue">
                          {PERMISSION_ROLE_LABELS[item.roleKey || 'member'] ||
                            item.roleKey ||
                            'member'}
                        </Tag>
                        <Tag
                          color={getAccessReviewDecisionColor(item.decision)}
                        >
                          {item.decision === 'remove'
                            ? '移除'
                            : item.decision === 'keep'
                              ? '保留'
                              : '待处理'}
                        </Tag>
                      </Space>
                    </Space>
                  </Col>
                  {canManageControls && item.status !== 'reviewed' ? (
                    <Col>
                      <Space size={8} wrap>
                        <Button
                          type="primary"
                          loading={
                            busy && reviewActionLoading?.decision === 'keep'
                          }
                          onClick={() =>
                            onReviewAccessItem(review.id, item.id, 'keep')
                          }
                        >
                          保留
                        </Button>
                        <Button
                          danger
                          loading={
                            busy && reviewActionLoading?.decision === 'remove'
                          }
                          onClick={() =>
                            onReviewAccessItem(review.id, item.id, 'remove')
                          }
                        >
                          移除
                        </Button>
                      </Space>
                    </Col>
                  ) : null}
                </Row>
              );
            })}
          </Space>
        ),
    }));

  return (
    <Card
      title={
        <Space size={8}>
          <SafetyCertificateOutlined />
          <span>访问复核与高风险流程</span>
        </Space>
      }
      extra={
        <Tag color="default">
          访问复核 {accessReviewCount} · Break-glass 生效中{' '}
          {activeBreakGlassCount}
        </Tag>
      }
    >
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        {!canManageControls ? (
          <Alert
            type="info"
            showIcon
            title="当前为只读视图"
            description="你可以查看 access review、break-glass 与代理登录状态，但发起复核、紧急授权或代理登录仍需要具备对应治理权限。"
          />
        ) : null}

        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Title level={5} style={{ marginBottom: 12 }}>
            访问复核
          </Title>
          {canManageControls ? (
            <Form layout="vertical" style={{ marginBottom: 12 }}>
              <Row gutter={[12, 0]} align="bottom">
                <Col flex="auto">
                  <Form.Item label="复核标题">
                    <Input
                      placeholder="例如 Q2 成员权限复核"
                      value={accessReviewTitle}
                      onChange={(event) =>
                        onAccessReviewTitleChange(event.target.value)
                      }
                    />
                  </Form.Item>
                </Col>
                <Col>
                  <Button
                    type="primary"
                    loading={accessReviewLoading}
                    onClick={onCreateAccessReview}
                  >
                    发起复核
                  </Button>
                </Col>
              </Row>
            </Form>
          ) : null}

          {accessReviews.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="当前还没有访问复核记录。"
            />
          ) : (
            <Collapse ghost items={accessReviewItems} />
          )}
        </Space>

        <Divider style={{ margin: '4px 0' }} />

        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Title level={5} style={{ marginBottom: 12 }}>
            Break-glass
          </Title>
          {canManageControls ? (
            <>
              <Alert
                type="warning"
                showIcon
                title="Break-glass 仅用于紧急场景"
                description="建议优先使用目录组、工作空间成员或代理登录；Break-glass 应设置明确原因与较短时效。"
                style={{ marginBottom: 12 }}
              />
              <Form layout="vertical">
                <Row gutter={[12, 0]}>
                  <Col xs={24} md={12}>
                    <Form.Item label="目标用户">
                      <Select
                        allowClear
                        showSearch
                        value={breakGlassUserId || undefined}
                        placeholder="留空则授权给当前平台管理员"
                        options={breakGlassTargetOptions}
                        optionFilterProp="label"
                        onChange={(value) =>
                          onBreakGlassUserIdChange(value || null)
                        }
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={6}>
                    <Form.Item label="授权角色">
                      <Select
                        value={breakGlassRoleKey}
                        options={BREAK_GLASS_ROLE_OPTIONS}
                        onChange={onBreakGlassRoleKeyChange}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={6}>
                    <Form.Item label="有效时长">
                      <Select
                        value={breakGlassDurationMinutes}
                        options={BREAK_GLASS_DURATION_OPTIONS}
                        onChange={onBreakGlassDurationMinutesChange}
                      />
                    </Form.Item>
                  </Col>
                  <Col flex="auto">
                    <Form.Item label="授权原因">
                      <Input
                        placeholder="例如排查客户 SSO 故障"
                        value={breakGlassReason}
                        onChange={(event) =>
                          onBreakGlassReasonChange(event.target.value)
                        }
                      />
                    </Form.Item>
                  </Col>
                  <Col>
                    <Form.Item label=" ">
                      <Button
                        type="primary"
                        loading={breakGlassLoading}
                        onClick={onCreateBreakGlassGrant}
                      >
                        创建紧急授权
                      </Button>
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
            </>
          ) : null}

          {breakGlassGrants.slice(0, 3).length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无紧急授权记录"
            />
          ) : (
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
              {breakGlassGrants.slice(0, 3).map((grant) => (
                <Row
                  key={grant.id}
                  gutter={[12, 12]}
                  align="middle"
                  justify="space-between"
                  style={STACK_ITEM_STYLE}
                >
                  <Col flex="auto">
                    <Space orientation="vertical" size={2}>
                      <Text strong>
                        {formatUserLabel(
                          grant.user?.displayName,
                          grant.user?.email,
                          grant.userId,
                        )}
                      </Text>
                      <Text type="secondary">
                        {grant.reason || '—'} · 到期{' '}
                        {formatDateTime(grant.expiresAt)}
                      </Text>
                    </Space>
                  </Col>
                  <Col>
                    {!grant.revokedAt && grant.status === 'active' ? (
                      <Button
                        danger
                        loading={breakGlassLoading}
                        onClick={() => onRevokeBreakGlassGrant(grant.id)}
                      >
                        撤销
                      </Button>
                    ) : (
                      <Tag>{grant.status}</Tag>
                    )}
                  </Col>
                </Row>
              ))}
            </Space>
          )}
        </Space>

        <Divider style={{ margin: '4px 0' }} />

        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Title level={5} style={{ marginBottom: 12 }}>
            代理登录
          </Title>
          {canManageControls ? (
            <Form layout="vertical">
              <Row gutter={[12, 0]} align="bottom">
                <Col xs={24} md={10}>
                  <Form.Item label="代理目标用户">
                    <Select
                      showSearch
                      value={impersonationTargetUserId || undefined}
                      placeholder="选择代理目标用户"
                      options={ownerCandidateOptions}
                      optionFilterProp="label"
                      onChange={(value) =>
                        onImpersonationTargetUserIdChange(value || null)
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={10}>
                  <Form.Item label="代理原因">
                    <Input
                      placeholder="例如排查成员工单"
                      value={impersonationReason}
                      onChange={(event) =>
                        onImpersonationReasonChange(event.target.value)
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={4}>
                  <Form.Item label=" ">
                    <Button
                      type="primary"
                      loading={impersonationLoading}
                      onClick={onStartImpersonation}
                    >
                      开始代理登录
                    </Button>
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          ) : null}

          <Alert
            type={impersonationActive ? 'warning' : 'info'}
            showIcon
            title={impersonationActive ? '代理登录进行中' : '当前无代理会话'}
            description={
              impersonationActive && impersonationReasonLabel
                ? `代理原因：${impersonationReasonLabel}`
                : '代理登录状态会在此实时同步。'
            }
          />
        </Space>
      </Space>
    </Card>
  );
}
