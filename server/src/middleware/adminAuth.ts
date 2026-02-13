import type { Request, Response, NextFunction } from 'express';

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  if ((req.session as any).isAdmin === true) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized - admin access required' });
}
