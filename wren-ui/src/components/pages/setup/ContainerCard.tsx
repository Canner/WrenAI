import styled from 'styled-components';

const PageShell = styled.div<{ maxWidth?: number }>`
  max-width: ${(props) => props.maxWidth || 1240}px;
  margin: 28px auto 56px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 252px;
  gap: 18px;
`;

const MainCard = styled.div`
  border-radius: 30px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 30px 60px rgba(15, 23, 42, 0.06);
  padding: 26px 28px 28px;
`;

const StepRail = styled.div`
  border-radius: 22px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.04);
  padding: 18px 16px;
  height: fit-content;
`;

const StepHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
`;

const StepList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const StepItem = styled.div<{ $active?: boolean; $done?: boolean }>`
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
  color: ${(props) => (props.$active || props.$done ? '#26243c' : '#7f8799')};
`;

const StepDot = styled.div<{ $active?: boolean; $done?: boolean }>`
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${(props) =>
    props.$active || props.$done
      ? 'linear-gradient(180deg, #8c61ff 0%, #6f47ff 100%)'
      : 'rgba(15, 23, 42, 0.06)'};
  color: ${(props) => (props.$active || props.$done ? '#fff' : '#6f7688')};
  font-size: 12px;
  font-weight: 700;
  box-shadow: ${(props) =>
    props.$active ? '0 10px 20px rgba(111, 71, 255, 0.18)' : 'none'};
`;

const Divider = styled.div`
  position: relative;
  width: 1px;
  height: 12px;
  background: rgba(15, 23, 42, 0.08);
  margin: -1px 0 -1px 13px;
`;

const STEP_META = [
  {
    label: '创建连接',
    description: '先为知识库保存主连接。',
  },
  {
    label: '选择资产',
    description: '挑选本次纳入的核心资产。',
  },
  {
    label: '定义关系',
    description: '补齐表间关联语义。',
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
          <div style={{ color: '#6f47ff', fontWeight: 700, fontSize: 11 }}>
            初始化流程
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1f2435' }}>
            3 步完成初始化
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
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {item.label}
                    </div>
                    <div
                      style={{ marginTop: 2, fontSize: 12, lineHeight: 1.55 }}
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
      </StepRail>
    </PageShell>
  );
}
