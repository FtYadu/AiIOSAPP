import { Router } from 'express';

import { remoteConfig } from '@lib/remoteConfig';

type TrendRecord = {
  term: string;
  provider: string;
  rank: number;
  sampleUrl: string;
  updatedAt: string;
};

const fallbackTrends: TrendRecord[] = [
  {
    term: 'neon rain alley',
    provider: 'openai',
    rank: 1,
    sampleUrl: 'https://cdn.example.com/trends/neon-rain.jpg',
    updatedAt: new Date().toISOString()
  },
  {
    term: 'sunset sky swap',
    provider: 'reimagine',
    rank: 2,
    sampleUrl: 'https://cdn.example.com/trends/sunset-sky.jpg',
    updatedAt: new Date().toISOString()
  }
];

export const trendsRouter = Router();

trendsRouter.get('/', async (_req, res) => {
  const providers = await remoteConfig.listProviders();
  const results = providers
    .filter((provider) => provider.enabled)
    .map<TrendRecord>((provider, index) => ({
      term: `${provider.name} signature look`,
      provider: provider.name,
      rank: index + 1,
      sampleUrl: `https://cdn.example.com/trends/${provider.name}.jpg`,
      updatedAt: new Date().toISOString()
    }));

  return res.json({ trends: results.length > 0 ? results : fallbackTrends });
});
