import { Router } from 'express';

export const assetsRouter = Router();

assetsRouter.get('/:assetId', (req, res) => {
  const { assetId } = req.params;
  // In production this would sign and redirect; for now provide a stub URL.
  return res.json({
    assetId,
    url: `https://cdn.example.com/assets/${assetId}?token=stub`
  });
});
