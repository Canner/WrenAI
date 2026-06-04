import { useEffect, useState } from 'react';
import { Button, Result, Spin } from 'antd';
import { useRouter } from 'next/router';
import SimpleLayout from '@/components/layouts/SimpleLayout';

export default function AcceptOrganizationInvitationPage() {
  const router = useRouter();
  const token = Array.isArray(router.query.token)
    ? router.query.token[0]
    : router.query.token;
  const [state, setState] = useState<
    'loading' | 'success' | 'error'
  >('loading');
  const [message, setMessage] = useState('Accepting invitation...');

  useEffect(() => {
    if (!router.isReady || !token) return;

    const acceptInvitation = async () => {
      try {
        const response = await fetch(
          `/api/v1/organizations/invitations/accept/${token}`,
          {
            method: 'POST',
          },
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to accept invitation');
        }
        setState('success');
        setMessage('Invitation accepted successfully.');
      } catch (error: any) {
        setState('error');
        setMessage(error.message || 'Failed to accept invitation');
      }
    };

    void acceptInvitation();
  }, [router.isReady, token]);

  return (
    <SimpleLayout loading={false}>
      <div className="d-flex justify-center align-center" style={{ minHeight: 'calc(100vh - 48px)' }}>
        {state === 'loading' ? (
          <div className="text-center">
            <Spin />
            <div className="mt-3 gray-7">{message}</div>
          </div>
        ) : (
          <Result
            status={state === 'success' ? 'success' : 'error'}
            title={message}
            extra={
              <Button type="primary" onClick={() => void router.push('/organization/members')}>
                Go to members
              </Button>
            }
          />
        )}
      </div>
    </SimpleLayout>
  );
}
