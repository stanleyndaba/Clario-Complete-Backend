import { Request, Response, NextFunction } from 'express';
import logger from './logger';

export interface CustomError extends Error {
  statusCode?: number;
  status?: string;
  isOperational?: boolean;
}

// Add the missing asyncHandler
export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction) => {
  const error = new Error(`Not found - ${_req.originalUrl}`) as CustomError;
  error.statusCode = 404;
  error.status = 'fail';
  next(error);
};

export const errorHandler = (err: CustomError, req: Request, res: Response, _next: NextFunction) => {
  let error = { ...err };
  error.message = err.message;
  error.statusCode = err.statusCode || 500;
  error.status = err.status || 'error';

  logger.error('Error:', {
    message: error.message,
    statusCode: error.statusCode,
    url: req.originalUrl
  });

  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = new Error(message) as CustomError;
    error.statusCode = 404;
  }

  if ((err as any).code === 11000) {
    const message = 'Duplicate field value entered';
    error = new Error(message) as CustomError;
    error.statusCode = 400;
  }

  if (err.name === 'ValidationError') {
    const message = Object.values((err as any).errors).map((val: any) => val.message);
    error = new Error(message.join(', ')) as CustomError;
    error.statusCode = 400;
  }

  res.status(error.statusCode || 500).json({
    status: error.status,
    message: error.message || 'Internal Server Error'
  });
};

// Convenience helper to create typed errors
export const createError = (message: string, statusCode = 400): CustomError => {
  const e = new Error(message) as CustomError;
  e.statusCode = statusCode;
  e.status = statusCode >= 500 ? 'error' : 'fail';
  e.isOperational = true;
  return e;
};
