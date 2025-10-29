import { Router } from 'express';

export const editsRouter = Router();

editsRouter.post('/', (_req, res) =>
  res.status(410).json({
    error: 'Legacy endpoint removed. Use POST /v1/images/edits instead.'
  })
);
