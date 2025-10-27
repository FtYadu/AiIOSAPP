import { Request } from 'express';

/**
 * Extracts authenticated user id from the request.
 * In production this would verify Supabase Auth JWTs.
 * For local development we accept `x-user-id` header fallback.
 */
export const authUserId = (req: Request): string | null => {
  const headerUser = req.header('x-user-id');
  if (headerUser && headerUser.trim().length > 0) {
    return headerUser.trim();
  }

  // TODO: integrate Supabase Auth JWT verification.
  return process.env.DEMO_USER_ID ?? null;
};
