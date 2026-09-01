import { z } from 'zod';

export const PRODUCT_FEEDBACK_VERSION = 'product-feedback-v1';
export const PRODUCT_FEEDBACK_CATEGORIES = Object.freeze([
  'BUG',
  'CONFUSING',
  'IDEA',
  'PRAISE',
  'OTHER',
]);

const interfaceLocale = z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/);
const pagePath = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/);
const feedbackMessage = z.string()
  .trim()
  .min(3)
  .max(800)
  .refine(
    (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value),
    { message: 'Feedback cannot contain control characters.' },
  );

export const productFeedbackSchema = z.object({
  schemaVersion: z.literal(PRODUCT_FEEDBACK_VERSION),
  category: z.enum(PRODUCT_FEEDBACK_CATEGORIES),
  message: feedbackMessage,
  interfaceLocale,
  pagePath,
}).strict();
