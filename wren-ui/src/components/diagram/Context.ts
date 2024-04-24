import { createContext } from 'react';
import { ComposeDiagram } from '@/utils/data';

export interface ClickPayload {
  [key: string]: any;
  data: ComposeDiagram;
}

type ContextProps = {
  onMoreClick: (data: ClickPayload) => void;
  onNodeClick: (data: ClickPayload) => void;
  onAddClick: (data: ClickPayload) => void;
} | null;

export const DiagramContext = createContext<ContextProps>({
  onMoreClick: () => {},
  onNodeClick: () => {},
  onAddClick: () => {},
});
