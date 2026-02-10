import type { VercelRequest, VercelResponse } from '@vercel/node';

let appPromise: Promise<any> | null = null;

function getApp() {
  if (!appPromise) {
    appPromise = import('../server/src/app.js').then(m => m.default);
  }
  return appPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const app = await getApp();
  return app(req, res);
}
