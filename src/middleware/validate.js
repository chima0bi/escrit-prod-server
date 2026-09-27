// Wraps a Joi schema into Express middleware. Every route — public or
// authenticated — validates its input through this, no exceptions.
import { AppError } from './errorHandler.js';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      throw new AppError(
        400,
        'Validation failed',
        error.details.map((d) => d.message)
      );
    }
    req[source] = value;
    next();
  };
}
