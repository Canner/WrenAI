export type RestErrorPayload = {
  error?: string;
};

export const parseRestJsonResponse = async <TPayload>(
  response: Response,
  fallbackMessage: string,
): Promise<TPayload> => {
  const payload = (await response.json().catch(() => null)) as
    | TPayload
    | RestErrorPayload
    | null;

  if (!response.ok) {
    throw new Error(
      (payload as RestErrorPayload | null)?.error || fallbackMessage,
    );
  }

  return payload as TPayload;
};
