/**
 * middleware/errors.js - Centralized error handling middleware.
 * Ensures consistent JSON error shape { error: { code, message } } without leaking secrets.
 */

export function errorHandler(err, req, res, next) {
  const statusCode = err.status || err.statusCode || (err.httpStatus && err.httpStatus >= 400 && err.httpStatus < 600 ? err.httpStatus : 500);
  const errorCode = err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED');
  const message = statusCode === 500 && process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred. Please try again later.'
    : err.message || 'Error processing request';

  console.error(`[error] [${req.method} ${req.originalUrl}] ${statusCode} - ${errorCode}:`, err.message);

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message,
      ...(err.details ? { details: err.details } : {})
    }
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `The requested endpoint ${req.method} ${req.originalUrl} does not exist.`
    }
  });
}
