import styled from 'styled-components';

export const DiagramWrapper = styled.div`
  position: relative;
  height: 100%;
`;

export const ModelingStage = styled.div<{ $embedded?: boolean }>`
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 20px;
  min-height: ${(props) =>
    props.$embedded ? 'min(78vh, 920px)' : 'calc(100vh - 260px)'};

  @media (max-width: 1200px) {
    grid-template-columns: 1fr;
    min-height: auto;
  }
`;

export const ModelingSidebarPanel = styled.aside<{ $embedded?: boolean }>`
  height: ${(props) =>
    props.$embedded ? 'min(78vh, 920px)' : 'calc(100vh - 260px)'};
  min-height: ${(props) => (props.$embedded ? '680px' : '640px')};
  border-radius: ${(props) => (props.$embedded ? '20px' : '22px')};
  border: 1px solid var(--nova-outline-soft);
  background: ${(props) =>
    props.$embedded
      ? 'rgba(255, 255, 255, 0.96)'
      : 'linear-gradient(180deg, #fcfbff 0%, #f7f5ff 100%)'};
  box-shadow: ${(props) =>
    props.$embedded
      ? '0 14px 30px rgba(15, 23, 42, 0.04)'
      : 'inset 0 1px 0 rgba(255, 255, 255, 0.7)'};
  padding: ${(props) => (props.$embedded ? '12px 0' : '16px 0')};
  overflow: auto;

  @media (max-width: 1200px) {
    height: 560px;
    min-height: 560px;
  }
`;

export const DiagramPanel = styled.section<{ $embedded?: boolean }>`
  height: ${(props) =>
    props.$embedded ? 'min(78vh, 920px)' : 'calc(100vh - 260px)'};
  min-height: ${(props) => (props.$embedded ? '680px' : '640px')};
  border-radius: ${(props) => (props.$embedded ? '20px' : '22px')};
  border: 1px solid var(--nova-outline-soft);
  background: ${(props) => (props.$embedded ? '#ffffff' : '#fbfbff')};
  box-shadow: ${(props) =>
    props.$embedded ? '0 14px 30px rgba(15, 23, 42, 0.04)' : 'none'};
  overflow: hidden;

  @media (max-width: 1200px) {
    height: 560px;
    min-height: 560px;
  }
`;

export const EmbeddedLoadingState = styled.div`
  border-radius: 20px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.04);
  padding: 24px;
`;
