import { RecommendationQuestion } from '@server/models/adaptor';
import { Manifest, ModelMDL, ColumnMDL } from '@server/mdl/type';

const MAX_MODEL_COUNT = 6;
type RecommendationModel = Partial<ModelMDL> & {
  name: string;
  columns?: Partial<ColumnMDL>[];
};

const quoteIdentifier = (identifier: unknown) => {
  return `"${String(identifier || '').replace(/"/g, '""')}"`;
};

const isMetricColumn = (column: Partial<ColumnMDL>) => {
  const name = String(column.name || '').toLowerCase();
  const type = String(column.type || '').toLowerCase();
  return (
    /int|float|double|decimal|numeric|number|real|money/.test(type) ||
    /amount|value|total|count|qty|quantity|price|cost|revenue|sales|margin|rate/.test(
      name,
    )
  );
};

const isDateColumn = (column: Partial<ColumnMDL>) => {
  const name = String(column.name || '').toLowerCase();
  const type = String(column.type || '').toLowerCase();
  return (
    /date|time|timestamp/.test(type) || /date|time|created|updated/.test(name)
  );
};

const isDimensionColumn = (column: Partial<ColumnMDL>) => {
  const name = String(column.name || '').toLowerCase();
  if (
    !column.name ||
    column.isCalculated ||
    isMetricColumn(column) ||
    isDateColumn(column)
  ) {
    return false;
  }
  return !/(^id$|_id$|uuid|guid|password|token|secret|json|payload)/.test(name);
};

const displayName = (model: RecommendationModel) => {
  return model.properties?.displayName || model.name;
};

const firstUsableModels = (manifest: Manifest) => {
  return (manifest.models || [])
    .filter((model): model is RecommendationModel => Boolean(model?.name))
    .filter((model) => (model.columns || []).some((column) => column.name))
    .slice(0, MAX_MODEL_COUNT);
};

export const buildFastRecommendationQuestions = (
  manifest: Manifest,
  maxQuestions = 5,
  previousQuestions: string[] = [],
): RecommendationQuestion[] => {
  const candidateLimit = Math.max(maxQuestions * 3, maxQuestions);
  const seen = new Set(
    previousQuestions.map((question) => question.trim().toLowerCase()),
  );
  const questions: RecommendationQuestion[] = [];
  const addQuestion = (question: RecommendationQuestion) => {
    if (questions.length >= candidateLimit) {
      return;
    }
    const key = question.question.trim().toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    questions.push(question);
  };

  for (const model of firstUsableModels(manifest)) {
    const modelRef = quoteIdentifier(model.name);
    const columns = model.columns || [];
    const dimensions = columns.filter(isDimensionColumn);
    const metrics = columns.filter(isMetricColumn);
    const dates = columns.filter(isDateColumn);
    const label = displayName(model);

    addQuestion({
      category: label,
      question: `How many records are in ${label}?`,
      sql: `SELECT COUNT(*) AS "RecordCount" FROM ${modelRef}`,
    });

    if (dimensions[0]) {
      const column = dimensions[0];
      const columnRef = `${modelRef}.${quoteIdentifier(column.name)}`;
      addQuestion({
        category: label,
        question: `What is the distribution of ${column.name} in ${label}?`,
        sql:
          `SELECT ${columnRef} AS ${quoteIdentifier(column.name)}, ` +
          `COUNT(*) AS "RecordCount" FROM ${modelRef} ` +
          `GROUP BY ${columnRef} ORDER BY COUNT(*) DESC`,
      });
    }

    if (dimensions[0] && metrics[0]) {
      const dimension = dimensions[0];
      const metric = metrics[0];
      const dimensionRef = `${modelRef}.${quoteIdentifier(dimension.name)}`;
      const metricRef = `${modelRef}.${quoteIdentifier(metric.name)}`;
      addQuestion({
        category: label,
        question: `Which ${dimension.name} values have the highest ${metric.name} in ${label}?`,
        sql:
          `SELECT ${dimensionRef} AS ${quoteIdentifier(dimension.name)}, ` +
          `SUM(${metricRef}) AS ${quoteIdentifier(`Total${metric.name}`)} ` +
          `FROM ${modelRef} GROUP BY ${dimensionRef} ` +
          `ORDER BY SUM(${metricRef}) DESC`,
      });
    }

    if (dates[0]) {
      const date = dates[0];
      const dateRef = `${modelRef}.${quoteIdentifier(date.name)}`;
      addQuestion({
        category: label,
        question: `Show monthly record count by ${date.name} in ${label}.`,
        sql:
          `SELECT DATEPART(YEAR, ${dateRef}) AS "year", ` +
          `DATEPART(MONTH, ${dateRef}) AS "month", ` +
          `COUNT(*) AS "RecordCount" FROM ${modelRef} ` +
          `GROUP BY DATEPART(YEAR, ${dateRef}), DATEPART(MONTH, ${dateRef}) ` +
          `ORDER BY DATEPART(YEAR, ${dateRef}), DATEPART(MONTH, ${dateRef})`,
      });
    }

    const previewColumns = columns
      .filter((column) => column.name)
      .slice(0, 8)
      .map(
        (column) =>
          `${modelRef}.${quoteIdentifier(column.name)} AS ${quoteIdentifier(
            column.name,
          )}`,
      );

    addQuestion({
      category: label,
      question: `Show the first 10 rows from ${label}.`,
      sql: `SELECT TOP 10 ${previewColumns.join(', ')} FROM ${modelRef}`,
    });
  }

  return questions;
};
