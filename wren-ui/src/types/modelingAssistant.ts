import type {
  RelationInput,
  RelationType,
  UpdateModelMetadataInput,
} from '@/types/modeling';
import type { RecommendationQuestionError } from '@/types/modeling';

export type ModelingAssistantTaskStatus = 'GENERATING' | 'FINISHED' | 'FAILED';

export type RelationshipRecommendationTaskRow = {
  name: string;
  fromModel: string;
  fromColumn: string;
  toModel: string;
  toColumn: string;
  type: RelationType;
  reason: string;
};

export type RelationshipRecommendationTaskPayload = {
  relationships: RelationshipRecommendationTaskRow[];
};

export type RelationshipRecommendationTaskResponse = {
  id: string;
  status: ModelingAssistantTaskStatus;
  response?: RelationshipRecommendationTaskPayload | null;
  error?: RecommendationQuestionError | null;
  traceId?: string | null;
};

export type CreateRelationshipRecommendationTaskResponse = {
  id: string;
};

export type CreateSemanticsDescriptionTaskResponse = {
  id: string;
};

export type SemanticsDescriptionColumn = {
  name: string;
  description: string;
};

export type SemanticsDescriptionModel = {
  name: string;
  description: string;
  columns: SemanticsDescriptionColumn[];
};

export type SemanticsDescriptionTaskResponse = {
  id: string;
  status: ModelingAssistantTaskStatus;
  response?: SemanticsDescriptionModel[] | null;
  error?: RecommendationQuestionError | null;
  traceId?: string | null;
};

export type RelationshipRecommendationSavePayload = RelationInput & {
  description?: string;
};

export type SemanticsDescriptionSavePayload = {
  modelId: number;
  data: UpdateModelMetadataInput;
};
