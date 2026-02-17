import { z } from "zod";

export const CompetitorAdAnalysisSchema = z
  .object({
    main_angle: z.string().min(1),
    hook_type: z.string().min(1),
    aggression_score: z.number().int().min(1).max(10),
    target_demographic: z.string().min(1),
    estimated_spend_tier: z.enum(["Low", "Medium", "High"])
  })
  .strict();

export type CompetitorAdAnalysis = z.infer<typeof CompetitorAdAnalysisSchema>;
