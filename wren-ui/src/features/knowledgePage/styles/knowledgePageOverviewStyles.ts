import styled from 'styled-components';

export const AssetsPanel = styled.div`
  flex: 1;
  min-height: 0;
  background: transparent;
  padding: 0;
`;

export const AssetsPanelBody = styled.div`
  position: relative;
  min-height: 420px;
`;

export const AssetsLoadingOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(2px);
  pointer-events: auto;
`;

export const AssetGalleryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(292px, 1fr));
  gap: 12px;
`;

export const AssetGalleryCard = styled.button<{ $active?: boolean }>`
  width: 100%;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(91, 75, 219, 0.2)' : 'rgba(15, 23, 42, 0.08)'};
  border-radius: 12px;
  background: #fff;
  padding: 0;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &:hover {
    border-color: rgba(91, 75, 219, 0.14);
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
    transform: translateY(-1px);
  }
`;

export const AssetGalleryHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  background: #fafbfc;
  border-bottom: 1px solid #edf1f5;
`;

export const AssetGalleryTitle = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
`;

export const AssetGalleryLabel = styled.span`
  display: block;
  color: #111827;
  font-size: 11px;
  line-height: 1.4;
  font-weight: 600;
`;

export const AssetGalleryRowMeta = styled.span`
  color: #98a0b3;
  font-size: 10px;
  line-height: 1.4;
`;

export const AssetGalleryBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 8px;
`;

export const AssetGalleryInfoGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const AssetGalleryInfoRow = styled.div`
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
`;

export const AssetGalleryInfoSplit = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

export const AssetGalleryInfoLabel = styled.span`
  color: #98a0b3;
  font-size: 11px;
  line-height: 1.5;
`;

export const AssetGalleryInfoValue = styled.span<{ $multiline?: boolean }>`
  min-width: 0;
  color: #374151;
  font-size: 12px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: ${(props) => (props.$multiline ? 'normal' : 'nowrap')};
  display: ${(props) => (props.$multiline ? '-webkit-box' : 'block')};
  -webkit-line-clamp: ${(props) => (props.$multiline ? 2 : 'unset')};
  -webkit-box-orient: vertical;
`;

export const AssetGalleryFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 12px 8px;
`;

export const AssetGalleryChips = styled.div`
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

export const AssetGalleryFooterRight = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  flex-wrap: wrap;
  margin-left: auto;
`;
