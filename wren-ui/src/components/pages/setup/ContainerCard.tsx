import styled from 'styled-components';

const PageShell = styled.div<{ maxWidth?: number }>`
  max-width: ${(props) => props.maxWidth || 1240}px;
  margin: 28px auto 56px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 22px;
`;

const MainCard = styled.div`
  border-radius: 30px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 30px 60px rgba(15, 23, 42, 0.06);
  padding: 28px 30px 30px;
`;

const StepRail = styled.div`
  border-radius: 26px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: linear-gradient(180deg, #ffffff 0%, #faf9ff 100%);
  box-shadow: 0 22px 48px rgba(15, 23, 42, 0.05);
  padding: 22px 20px;
  height: fit-content;
`;

const StepHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 22px;
`;

const StepList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const StepItem = styled.div<{ $active?: boolean; $done?: boolean }>`
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 12px;
  color: ${(props) => (props.$active || props.$done ? '#26243c' : '#7f8799')};
`;

const StepDot = styled.div<{ $active?: boolean; $done?: boolean }>`
  width: 34px;
  height: 34px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${(props) =>
    props.$active || props.$done
      ? 'linear-gradient(180deg, #8c61ff 0%, #6f47ff 100%)'
      : 'rgba(15, 23, 42, 0.06)'};
  color: ${(props) => (props.$active || props.$done ? '#fff' : '#6f7688')};
  font-weight: 700;
  box-shadow: ${(props) =>
    props.$active ? '0 12px 28px rgba(111, 71, 255, 0.24)' : 'none'};
`;

const Divider = styled.div`
  position: relative;
  width: 1px;
  height: 18px;
  background: rgba(15, 23, 42, 0.08);
  margin: -2px 0 -2px 16px;
`;

const Hint = styled.div`
  margin-top: 22px;
  padding: 16px 16px 0;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
  color: #6f7688;
  font-size: 13px;
  line-height: 1.7;
`;

const STEP_META = [
  {
    label: '连接数据源',
    description: '选择真实数据源或系统样例，确定本次建库入口。',
  },
  {
    label: '选择数据表',
    description: '挑选本次知识库中最核心的模型表与视图。',
  },
  {
    label: '定义关系',
    description: '确认表之间的关联，让问答和 SQL 共享统一语义。',
  },
];

interface Props {
  step: number;
  children: React.ReactNode;
  maxWidth?: number;
}

export default function ContainerCard(props: Props) {
  const { step, maxWidth, children } = props;

  return (
    <PageShell maxWidth={maxWidth}>
      <MainCard>{children}</MainCard>
      <StepRail>
        <StepHeader>
          <div style={{ color: '#6f47ff', fontWeight: 700, fontSize: 12 }}>
            建库向导
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1f2435' }}>
            3 步完成知识库初始化
          </div>
        </StepHeader>
        <StepList>
          {STEP_META.map((item, index) => {
            const active = index === step;
            const done = index < step;
            return (
              <div key={item.label}>
                <StepItem $active={active} $done={done}>
                  <StepDot $active={active} $done={done}>
                    {index + 1}
                  </StepDot>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>
                      {item.label}
                    </div>
                    <div
                      style={{ marginTop: 4, fontSize: 13, lineHeight: 1.6 }}
                    >
                      {item.description}
                    </div>
                  </div>
                </StepItem>
                {index < STEP_META.length - 1 ? <Divider /> : null}
              </div>
            );
          })}
        </StepList>
        <Hint>
          每一步都可以回退修改；如果当前账号已经完成
          onboarding，现在也可以重新进入该流程做回顾或重新配置。
        </Hint>
      </StepRail>
    </PageShell>
  );
}
