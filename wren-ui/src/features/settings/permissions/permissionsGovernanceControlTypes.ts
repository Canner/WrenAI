export type ReviewActionDecision = 'keep' | 'remove';

export type AccessReview = {
  id: string;
  title: string;
  status: string;
  createdAt?: string | null;
  items: Array<{
    id: string;
    userId?: string | null;
    roleKey?: string | null;
    status: string;
    decision?: string | null;
  }>;
};

export type Member = {
  userId: string;
  user?: {
    displayName?: string | null;
    email?: string | null;
  } | null;
};

export type BreakGlassGrant = {
  id: string;
  userId: string;
  roleKey: string;
  status: string;
  revokedAt?: string | null;
  expiresAt?: string | null;
  reason?: string | null;
  user?: {
    displayName?: string | null;
    email?: string | null;
  } | null;
};
