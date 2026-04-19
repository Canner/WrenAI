import type { RelationFormValues } from '@/components/modals/RelationModal';
import type { UpdateRelationInput } from '@/types/modeling';
import { createRelationship } from '@/utils/modelingRest';

export type RunDiagramMutation = <T>(
  setLoadingState: (loading: boolean) => void,
  action: () => Promise<T>,
) => Promise<T>;

export type RelationshipMutation =
  | {
      relationId: number;
      payload: UpdateRelationInput;
    }
  | {
      relationId: null;
      payload: Parameters<typeof createRelationship>[1];
    };

export type BuildRelationshipMutationInput = (
  values: RelationFormValues & { relationId?: number },
) => RelationshipMutation;
