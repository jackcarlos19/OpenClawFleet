import { z } from "zod";

export const ReviewInsightSchema = z
  .object({
    sentiment: z.enum(["positive", "negative", "neutral"]),
    intensity: z.number().int().min(1).max(10),
    pain_points: z.array(z.string().min(1)).default([]),
    jobs_to_be_done: z.string().min(1),
    product_features: z.array(z.string().min(1)).default([]),
    shift_context: z.string().min(1).nullable()
  })
  .strict();

export type ReviewInsight = z.infer<typeof ReviewInsightSchema>;
