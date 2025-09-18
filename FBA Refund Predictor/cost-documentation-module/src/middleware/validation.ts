import { AnyZodObject, ZodEffects } from 'zod';
import { Request, Response, NextFunction } from 'express';

export function validateBody(schema: AnyZodObject | ZodEffects<any>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: 'ValidationError',
        details: err?.issues || err?.message || 'Invalid payload',
      });
    }
  };
}

export function validateQuery(schema: AnyZodObject | ZodEffects<any>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = await schema.parseAsync(req.query);
      next();
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        error: 'ValidationError',
        details: err?.issues || err?.message || 'Invalid query params',
      });
    }
  };
}


