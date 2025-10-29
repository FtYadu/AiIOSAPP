export const deriveErrorTag = (error: unknown): string => {
  if (!error) {
    return 'unknown';
  }
  if (error instanceof Error) {
    const code = (error as Error & { code?: string | number }).code;
    const status = (error as Error & { status?: number }).status;
    if (status !== undefined) {
      return `status_${status}`;
    }
    if (code !== undefined) {
      return `code_${code}`;
    }
    return error.name || 'error';
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'unknown';
};
