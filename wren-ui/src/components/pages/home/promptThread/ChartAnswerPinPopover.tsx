import { Button, Empty, Spin } from 'antd';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import styled from 'styled-components';

import {
  resolveDashboardDisplayName,
  type DashboardListItem,
} from '@/utils/dashboardRest';

type DashboardOption = Pick<DashboardListItem, 'id' | 'isDefault' | 'name'>;

const PopoverShell = styled.div`
  width: 272px;
`;

const PopoverList = styled.div`
  border: 1px solid var(--nova-outline-soft);
  border-radius: 10px;
  padding: 3px;
  max-height: 252px;
  overflow: auto;
  background: #fbfbfe;
`;

const PopoverRow = styled.button<{ $active?: boolean; $disabled?: boolean }>`
  width: 100%;
  min-width: 0;
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid
    ${(props) => (props.$active ? 'rgba(141, 101, 225, 0.18)' : 'transparent')};
  background: ${(props) =>
    props.$active ? 'rgba(141, 101, 225, 0.08)' : 'transparent'};
  text-align: left;
  cursor: ${(props) => (props.$disabled ? 'not-allowed' : 'pointer')};
  opacity: ${(props) => (props.$disabled ? 0.6 : 1)};
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: ${(props) =>
      props.$disabled
        ? 'transparent'
        : props.$active
          ? 'rgba(141, 101, 225, 0.1)'
          : '#f7f7fb'};
    border-color: ${(props) =>
      props.$disabled
        ? 'transparent'
        : props.$active
          ? 'rgba(141, 101, 225, 0.24)'
          : 'rgba(15, 23, 42, 0.06)'};
  }

  &:focus-visible {
    outline: none;
    border-color: rgba(111, 71, 255, 0.32);
    box-shadow: 0 0 0 3px rgba(111, 71, 255, 0.12);
  }

  & + & {
    margin-top: 4px;
  }
`;

const PopoverTitle = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 500;
  color: var(--nova-text-primary);
`;

const PopoverDefaultMeta = styled.span`
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: 999px;
  background: #f4f5f8;
  font-size: 10px;
  line-height: 1;
  font-weight: 600;
  color: var(--nova-text-secondary);
`;

const CreateAndPinButton = styled(Button)`
  &.ant-btn {
    width: 100%;
    margin-top: 5px;
    height: 30px;
    border-radius: 9px;
    border: 1px dashed rgba(111, 71, 255, 0.35);
    color: #6f47ff;
    background: rgba(111, 71, 255, 0.04);
    box-shadow: none;
    justify-content: flex-start;
    padding-inline: 8px;
    font-size: 12px;
    font-weight: 600;
  }

  &.ant-btn:hover:not([disabled]),
  &.ant-btn:focus-visible:not([disabled]) {
    border-color: rgba(111, 71, 255, 0.56);
    background: rgba(111, 71, 255, 0.08);
    color: #5d3ce0;
  }
`;

export default function ChartAnswerPinPopover({
  dashboardOptions,
  dashboardsLoading,
  disabled,
  onCreateAndPin,
  onSelectDashboard,
}: {
  dashboardOptions: DashboardOption[];
  dashboardsLoading: boolean;
  disabled?: boolean;
  onCreateAndPin: () => void;
  onSelectDashboard: (
    dashboardId: number,
    dashboardName?: string | null,
  ) => void | Promise<void>;
}) {
  return (
    <PopoverShell>
      <PopoverList>
        {dashboardsLoading ? (
          <div style={{ padding: '28px 0', textAlign: 'center' }}>
            <Spin />
          </div>
        ) : dashboardOptions.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="当前工作空间还没有看板"
          />
        ) : (
          dashboardOptions.map((dashboard) => (
            <PopoverRow
              key={dashboard.id}
              type="button"
              $active={Boolean(dashboard.isDefault)}
              $disabled={disabled}
              disabled={disabled}
              onClick={() =>
                void onSelectDashboard(dashboard.id, dashboard.name)
              }
            >
              <PopoverTitle>
                {resolveDashboardDisplayName(dashboard.name)}
              </PopoverTitle>
              {dashboard.isDefault ? (
                <PopoverDefaultMeta>默认</PopoverDefaultMeta>
              ) : null}
            </PopoverRow>
          ))
        )}
      </PopoverList>

      <CreateAndPinButton
        icon={<PlusOutlined />}
        disabled={disabled}
        onClick={onCreateAndPin}
      >
        新建看板并固定
      </CreateAndPinButton>
    </PopoverShell>
  );
}
