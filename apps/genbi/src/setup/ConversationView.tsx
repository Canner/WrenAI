import { Typography } from 'antd';
import { CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { AgentMessage } from '@/session/messages/AgentMessage';
import { WorkLog } from '@/session/WorkLog';
import { t } from '@/i18n/strings';
import type { ConversationMessage } from './types';

interface ConversationViewProps {
  messages: ConversationMessage[];
}

/**
 * The guided setup conversation transcript. Assistant turns reuse the
 * generic `AgentMessage` shell from the Ask session; user turns get a small
 * local bubble (the Ask session's `UserMessage` is typed to its own
 * `UserEvent`, so it isn't a clean reuse here). A stream-driven message (e.g.
 * the connect step's live turn) additionally carries its `workLog` (rendered
 * via the shared `WorkLog`, collapsed by default behind a whole-tree
 * disclosure — same persisted-per-turn-trace pattern as the Ask page's
 * `EventList`) and its stream `terminal`, shown as a small status icon next
 * to the text.
 */
export function ConversationView({ messages }: ConversationViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {messages.map((message) =>
        message.role === 'assistant' ? (
          <AgentMessage key={message.id}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Typography.Text>{message.text}</Typography.Text>
                {message.terminal?.status === 'ok' && (
                  <CheckCircleOutlined aria-hidden="true" style={{ color: 'var(--ant-color-success)' }} />
                )}
                {message.terminal?.status === 'needs_input' && (
                  <ExclamationCircleOutlined aria-hidden="true" style={{ color: 'var(--ant-color-warning)' }} />
                )}
              </span>
              {message.workLog && message.workLog.length > 0 && (
                <WorkLog steps={message.workLog} title={t('ask.executionTrace')} />
              )}
            </div>
          </AgentMessage>
        ) : (
          <div key={message.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div
              style={{
                maxWidth: '80%',
                background: 'var(--ant-color-primary-bg)',
                borderRadius: 12,
                padding: '8px 12px',
              }}
            >
              <Typography.Text>{message.text}</Typography.Text>
            </div>
          </div>
        ),
      )}
    </div>
  );
}
