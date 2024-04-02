import { createContext } from 'react';
import { ComposeDiagram } from '@/utils/data';

export interface ClickPayload {
  [key: string]: any;
  title: string;
  data: ComposeDiagram;
}

type ContextProps = {
  onMoreClick: (data: ClickPayload) => void;
  onNodeClick: (data: ClickPayload) => void;
} | null;

export const DiagramContext = createContext<ContextProps>({
  onMoreClick: () => {},
  onNodeClick: () => {},
});
