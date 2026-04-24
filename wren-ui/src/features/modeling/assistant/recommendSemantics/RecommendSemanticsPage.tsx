import { useMemo } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Space,
  Spin,
  Typography,
} from 'antd';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import ModelingAssistantRouteLayout from '../ModelingAssistantRouteLayout';
import { buildModelingAssistantBackParams } from '../modelingAssistantRoutes';
import useModelingAssistantLeaveGuard from '../useModelingAssistantLeaveGuard';
import useModelingAssistantReadonly from '../useModelingAssistantReadonly';
import useRecommendSemanticsWizard from './useRecommendSemanticsWizard';
import GeneratedSemanticsReview from './GeneratedSemanticsReview';
import { Path } from '@/utils/enum';
import {
  AssistantColumn,
  AssistantDocLink,
  AssistantFooterBar,
  AssistantIntroCard,
  AssistantMutedText,
  AssistantPill,
  AssistantPillRow,
  AssistantPromptChip,
  AssistantSectionCard,
  AssistantSectionHeader,
} from '../modelingAssistantVisuals';

const { Paragraph, Text, Title } = Typography;

export default function RecommendSemanticsPage() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const modelingAssistantReadonly = useModelingAssistantReadonly();

  const navigateBack = async () => {
    await runtimeScopeNavigation.pushWorkspace(
      Path.Knowledge,
      buildModelingAssistantBackParams(),
    );
  };

  const leaveGuard = useModelingAssistantLeaveGuard({
    onLeave: navigateBack,
  });

  const semanticsWizard = useRecommendSemanticsWizard({
    enabled:
      runtimeScopePage.hasRuntimeScope && !modelingAssistantReadonly.isReadOnly,
    selector: runtimeScopeNavigation.selector,
    onSaveSuccess: navigateBack,
  });

  const selectedModelCount = semanticsWizard.selectedModels.length;
  const generatedStateTitle = useMemo(
    () =>
      semanticsWizard.completed ? 'Generated semantics' : 'Example prompt',
    [semanticsWizard.completed],
  );

  const renderPickStep = () => {
    if (runtimeScopePage.guarding || semanticsWizard.modelList.loading) {
      return (
        <div style={{ padding: '48px 0', textAlign: 'center' }}>
          <Spin />
        </div>
      );
    }

    if (modelingAssistantReadonly.isReadOnly) {
      return (
        <Alert
          type="warning"
          showIcon
          title="Modeling AI Assistant is unavailable on read-only snapshots"
          description={modelingAssistantReadonly.readOnlyHint}
        />
      );
    }

    return (
      <AssistantColumn>
        <AssistantIntroCard>
          <AssistantSectionHeader>
            <div>
              <Text strong>Assistant setup</Text>
              <AssistantMutedText>
                Choose the models you want to enrich, then generate concise
                business-friendly descriptions before saving.
              </AssistantMutedText>
            </div>
            <AssistantDocLink
              href="https://docs.getwren.ai/cp/guide/modeling-ai-assistant"
              target="_blank"
              rel="noreferrer"
            >
              Learn more
            </AssistantDocLink>
          </AssistantSectionHeader>
          <AssistantPillRow>
            <AssistantPill $tone="accent">Step 1 of 2</AssistantPill>
            <AssistantPill
              $tone={selectedModelCount > 0 ? 'success' : 'warning'}
            >
              {selectedModelCount} model{selectedModelCount === 1 ? '' : 's'}{' '}
              selected
            </AssistantPill>
          </AssistantPillRow>
        </AssistantIntroCard>
        <Card style={{ borderRadius: 16 }}>
          <Title level={4} style={{ marginTop: 0 }}>
            Pick models
          </Title>
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {(semanticsWizard.modelList.data || []).map((model) => (
              <Checkbox
                key={model.referenceName}
                checked={semanticsWizard.selectedModels.includes(
                  model.referenceName,
                )}
                onChange={(event) =>
                  semanticsWizard.onToggleModel(
                    model.referenceName,
                    event.target.checked,
                  )
                }
              >
                <Text strong>{model.displayName}</Text>
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  {model.referenceName}
                </Text>
              </Checkbox>
            ))}
          </div>
          {semanticsWizard.validationError ? (
            <Alert
              style={{ marginTop: 16 }}
              type="error"
              showIcon
              title={semanticsWizard.validationError}
            />
          ) : null}
        </Card>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="primary" onClick={semanticsWizard.onNext}>
            Next
          </Button>
        </div>
      </AssistantColumn>
    );
  };

  const renderGenerateStep = () => (
    <AssistantColumn>
      <AssistantIntroCard>
        <AssistantSectionHeader>
          <div>
            <Text strong>Generation workflow</Text>
            <AssistantMutedText>
              Refine the prompt if needed, generate semantics, then save the
              reviewed descriptions back to modeling.
            </AssistantMutedText>
          </div>
          <AssistantDocLink
            href="https://docs.getwren.ai/cp/guide/modeling-ai-assistant"
            target="_blank"
            rel="noreferrer"
          >
            Learn more
          </AssistantDocLink>
        </AssistantSectionHeader>
        <AssistantPillRow>
          <AssistantPill $tone="accent">Step 2 of 2</AssistantPill>
          <AssistantPill
            $tone={semanticsWizard.completed ? 'success' : 'warning'}
          >
            {semanticsWizard.completed ? 'Generated' : 'Awaiting generation'}
          </AssistantPill>
          <AssistantPill $tone="default">
            {selectedModelCount} model{selectedModelCount === 1 ? '' : 's'}
          </AssistantPill>
        </AssistantPillRow>
      </AssistantIntroCard>
      <Card style={{ borderRadius: 16 }}>
        <Title level={4} style={{ marginTop: 0 }}>
          Generate semantics
        </Title>
        <Paragraph type="secondary">
          Selected models: {selectedModelCount}
        </Paragraph>
        <Input.TextArea
          rows={5}
          value={semanticsWizard.prompt}
          onChange={(event) => semanticsWizard.setPrompt(event.target.value)}
          placeholder="Add more context for the AI assistant (optional)"
        />
      </Card>

      {semanticsWizard.requestError ? (
        <Alert
          type="error"
          showIcon
          title="Failed to generate semantics"
          description={semanticsWizard.requestError}
          action={
            <Button
              size="small"
              onClick={() => void semanticsWizard.retryGenerate()}
            >
              Retry
            </Button>
          }
        />
      ) : null}

      {semanticsWizard.saveError ? (
        <Alert
          type="error"
          showIcon
          title="Failed to save semantics"
          description={semanticsWizard.saveError}
          action={
            <Button size="small" onClick={() => void semanticsWizard.save()}>
              Retry save
            </Button>
          }
        />
      ) : null}

      <AssistantSectionCard>
        <Title level={5} style={{ marginTop: 0 }}>
          {generatedStateTitle}
        </Title>
        {semanticsWizard.completed ? (
          <GeneratedSemanticsReview items={semanticsWizard.generatedModels} />
        ) : (
          <Space wrap>
            {semanticsWizard.examplePrompts.map((item) => (
              <AssistantPromptChip key={item} type="button">
                {item}
              </AssistantPromptChip>
            ))}
          </Space>
        )}
      </AssistantSectionCard>

      {semanticsWizard.polling &&
      semanticsWizard.task?.status === 'GENERATING' ? (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <Spin />
          <Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
            Generating semantics...
          </Paragraph>
        </div>
      ) : null}

      <AssistantSectionCard>
        <AssistantFooterBar>
          <Button onClick={semanticsWizard.onBack}>Back</Button>
          <Space>
            <Button
              onClick={() => void semanticsWizard.save()}
              loading={semanticsWizard.saving}
              disabled={!semanticsWizard.completed}
            >
              Save
            </Button>
            <Button
              type="primary"
              onClick={() => void semanticsWizard.generate()}
              loading={semanticsWizard.polling}
            >
              {semanticsWizard.completed ? 'Regenerate' : 'Generate'}
            </Button>
          </Space>
        </AssistantFooterBar>
      </AssistantSectionCard>
    </AssistantColumn>
  );

  return (
    <ModelingAssistantRouteLayout
      title="Generate semantics"
      description="Select models, add optional context, and let Modeling AI Assistant generate descriptions before saving them back to your semantic model."
      onBack={leaveGuard.onBackClick}
    >
      {semanticsWizard.step === 'pick'
        ? renderPickStep()
        : renderGenerateStep()}
    </ModelingAssistantRouteLayout>
  );
}
