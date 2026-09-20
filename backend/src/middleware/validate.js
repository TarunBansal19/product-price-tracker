/**
 * middleware/validate.js - Request validation helper using Zod.
 */

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Request body failed validation',
          details: result.error.format()
        }
      });
    }
    req.validatedBody = result.data;
    next();
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Query parameters failed validation',
          details: result.error.format()
        }
      });
    }
    req.validatedQuery = result.data;
    next();
  };
}
