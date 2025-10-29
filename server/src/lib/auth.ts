import type { NextFunction, Request, Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { runtimeConfig } from '@config/env';

export type AuthContext = {
  userId: string;
};

export type AuthenticatedRequest = Request & { auth?: AuthContext };

let supabaseClient: SupabaseClient | null = null;

const getSupabaseClient = (): SupabaseClient => {
  if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseServiceRoleKey) {
    throw new Error('Supabase credentials not configured');
  }
  if (!supabaseClient) {
    supabaseClient = createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }
  return supabaseClient;
};

/**
 * Extracts authenticated user id from the request.
 * Verifies Supabase Auth JWTs when provided, while still allowing
 * the local `x-user-id` override for development and tests.
 */
export const authUserId = async (req: Request): Promise<string | null> => {
  const headerUser = req.header('x-user-id');
  if (headerUser && headerUser.trim().length > 0) {
    return headerUser.trim();
  }

  const authorization = req.header('authorization') ?? req.header('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (!token) {
      return null;
    }

    const client = getSupabaseClient();
    const { data, error } = await client.auth.getUser(token);
    if (error) {
      return null;
    }
    return data.user?.id ?? null;
  }

  return process.env.DEMO_USER_ID ?? null;
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = await authUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    (req as AuthenticatedRequest).auth = { userId };
    return next();
  } catch (error) {
    return next(error);
  }
};

export const authenticatedUser = (req: Request): AuthContext | null =>
  (req as AuthenticatedRequest).auth ?? null;
