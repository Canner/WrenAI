import { useState } from 'react';
import { message } from 'antd';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import {
  buildSecretReencryptApiUrl,
  buildSecretReencryptPayload,
  type SecretReencryptSummary,
} from './connectorsPageUtils';

export default function useConnectorSecretOperations({
  rotateConnectorSecretBlockedReason,
  requireWorkspaceSelector,
}: {
  rotateConnectorSecretBlockedReason?: string | null;
  requireWorkspaceSelector: () => { workspaceId?: string };
}) {
  const [secretOpsModalOpen, setSecretOpsModalOpen] = useState(false);
  const [targetKeyVersionText, setTargetKeyVersionText] = useState('2');
  const [sourceKeyVersionText, setSourceKeyVersionText] = useState('');
  const [secretScopeType, setSecretScopeType] = useState('connector');
  const [secretReencryptSubmittingMode, setSecretReencryptSubmittingMode] =
    useState<'dry-run' | 'execute' | null>(null);
  const [secretReencryptSummary, setSecretReencryptSummary] =
    useState<SecretReencryptSummary | null>(null);

  const openSecretOpsModal = () => {
    if (rotateConnectorSecretBlockedReason) {
      message.info(rotateConnectorSecretBlockedReason);
      return;
    }
    setSecretOpsModalOpen(true);
    setSecretReencryptSummary(null);
  };

  const closeSecretOpsModal = () => {
    setSecretOpsModalOpen(false);
    setSecretReencryptSummary(null);
    setSourceKeyVersionText('');
    setTargetKeyVersionText('2');
    setSecretScopeType('connector');
  };

  const executeSecretReencrypt = async (
    execute: boolean,
  ): Promise<SecretReencryptSummary> => {
    const payload = buildSecretReencryptPayload({
      targetKeyVersionText,
      sourceKeyVersionText,
      scopeType: secretScopeType,
      execute,
    });

    const response = await fetch(
      buildSecretReencryptApiUrl(requireWorkspaceSelector()),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error || '密钥轮换执行失败。');
    }

    return (await response.json()) as SecretReencryptSummary;
  };

  const handleSecretReencrypt = async (execute: boolean) => {
    if (rotateConnectorSecretBlockedReason) {
      message.info(rotateConnectorSecretBlockedReason);
      return;
    }
    const mode = execute ? 'execute' : 'dry-run';
    try {
      setSecretReencryptSubmittingMode(mode);
      const summary = await executeSecretReencrypt(execute);
      setSecretReencryptSummary(summary);
      message.success(
        execute ? '密钥重加密已执行。' : '密钥重加密 dry-run 已完成。',
      );
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '密钥轮换执行失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setSecretReencryptSubmittingMode(null);
    }
  };

  return {
    secretOpsModalOpen,
    targetKeyVersionText,
    sourceKeyVersionText,
    secretScopeType,
    secretReencryptSubmittingMode,
    secretReencryptSummary,
    openSecretOpsModal,
    closeSecretOpsModal,
    handleSecretReencrypt,
    setSecretScopeType,
    setTargetKeyVersionText,
    setSourceKeyVersionText,
  };
}
