import { createContext } from 'react';
import {
  ModelData,
  MetricData,
  ViewData,
} from '@/utils/data';

export interface ClickPayload {
  [key: string]: any;
  title: string;
  data: ModelData | MetricData | ViewData;
}

type ContextProps = {
  onMoreClick: (data: ClickPayload) => void;
  onNodeClick: (data: ClickPayload) => void;
} | null;

export const DiagramContext = createContext<ContextProps>({
  onMoreClick: () => {},
  onNodeClick: () => {},
});
