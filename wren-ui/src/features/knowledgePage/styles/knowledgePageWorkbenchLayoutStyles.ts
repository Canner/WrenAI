import styled from 'styled-components';

export const LibraryStage = styled.div`
  flex: 1;
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 0;
  min-height: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: transparent;
`;

export const WorkbenchGrid = styled.div`
  display: grid;
  grid-template-columns: 252px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  width: 100%;
  gap: 18px;
  align-items: stretch;
  align-content: stretch;
  min-height: 100%;
  height: 100%;

  @media (max-width: 1080px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto;
    min-height: 0;
    height: auto;
  }
`;

export const SidePanel = styled.div`
  position: sticky;
  top: 0;
  min-width: 0;
  min-height: 100%;
  height: 100%;
  border-radius: 18px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: var(--nova-shadow-soft);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-sizing: border-box;
  overflow: hidden;
  scrollbar-gutter: stable;

  @media (max-width: 1080px) {
    position: static;
    min-height: 0;
    height: auto;
  }
`;
