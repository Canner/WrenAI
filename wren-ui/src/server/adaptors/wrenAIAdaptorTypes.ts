import { Readable } from 'stream';
import {
  AskDetailInput,
  AskDetailResult,
  AskFeedbackInput,
  AskFeedbackResult,
  AskInput,
  AskResult,
  AsyncQueryResponse,
  ChartAdjustmentInput,
  ChartInput,
  ChartResult,
  DeleteInstructionsInput,
  DeleteSemanticsInput,
  DeleteSqlPairsInput,
  DeployData,
  DeploySqlPairInput,
  GenerateInstructionsPayload,
  InstructionResult,
  QuestionInput,
  QuestionsResult,
  RelationshipRecommendationInput,
  RelationshipRecommendationResult,
  RecommendationQuestionsInput,
  RecommendationQuestionsResult,
  SemanticsDescriptionInput,
  SemanticsDescriptionResult,
  SqlPairResult,
  TextBasedAnswerInput,
  TextBasedAnswerResult,
  WrenAIDeployResponse,
} from '@server/models/adaptor';

export interface IWrenAIAdaptor {
  deploy(deployData: DeployData): Promise<WrenAIDeployResponse>;
  delete(input: DeleteSemanticsInput): Promise<void>;
  ask(input: AskInput): Promise<AsyncQueryResponse>;
  cancelAsk(queryId: string): Promise<void>;
  getAskResult(queryId: string): Promise<AskResult>;
  getAskStreamingResult(queryId: string): Promise<Readable>;
  generateAskDetail(input: AskDetailInput): Promise<AsyncQueryResponse>;
  getAskDetailResult(queryId: string): Promise<AskDetailResult>;
  generateRecommendationQuestions(
    input: RecommendationQuestionsInput,
  ): Promise<AsyncQueryResponse>;
  getRecommendationQuestionsResult(
    queryId: string,
  ): Promise<RecommendationQuestionsResult>;
  generateRelationshipRecommendation(
    input: RelationshipRecommendationInput,
  ): Promise<AsyncQueryResponse>;
  getRelationshipRecommendationResult(
    queryId: string,
  ): Promise<RelationshipRecommendationResult>;
  generateSemanticsDescription(
    input: SemanticsDescriptionInput,
  ): Promise<AsyncQueryResponse>;
  getSemanticsDescriptionResult(
    queryId: string,
  ): Promise<SemanticsDescriptionResult>;
  createTextBasedAnswer(
    input: TextBasedAnswerInput,
  ): Promise<AsyncQueryResponse>;
  getTextBasedAnswerResult(queryId: string): Promise<TextBasedAnswerResult>;
  streamTextBasedAnswer(queryId: string): Promise<Readable>;
  generateChart(input: ChartInput): Promise<AsyncQueryResponse>;
  getChartResult(queryId: string): Promise<ChartResult>;
  cancelChart(queryId: string): Promise<void>;
  adjustChart(input: ChartAdjustmentInput): Promise<AsyncQueryResponse>;
  getChartAdjustmentResult(queryId: string): Promise<ChartResult>;
  cancelChartAdjustment(queryId: string): Promise<void>;
  deploySqlPair(input: DeploySqlPairInput): Promise<AsyncQueryResponse>;
  getSqlPairResult(queryId: string): Promise<SqlPairResult>;
  deleteSqlPairs(input: DeleteSqlPairsInput): Promise<void>;
  generateQuestions(input: QuestionInput): Promise<AsyncQueryResponse>;
  getQuestionsResult(queryId: string): Promise<Partial<QuestionsResult>>;
  generateInstruction(
    input: GenerateInstructionsPayload,
  ): Promise<AsyncQueryResponse>;
  getInstructionResult(queryId: string): Promise<InstructionResult>;
  deleteInstructions(input: DeleteInstructionsInput): Promise<void>;
  createAskFeedback(input: AskFeedbackInput): Promise<AsyncQueryResponse>;
  getAskFeedbackResult(queryId: string): Promise<AskFeedbackResult>;
  cancelAskFeedback(queryId: string): Promise<void>;
}
