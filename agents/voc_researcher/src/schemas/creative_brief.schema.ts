import { z } from "zod";

const AngleHypothesisSchema = z
  .object({
    problem: z.string().min(1),
    solution: z.string().min(1)
  })
  .strict();

const ScriptSchema = z
  .object({
    visual_cue: z.string().min(1),
    audio_script: z.string().min(1)
  })
  .strict();

export const CreativeBriefSchema = z
  .object({
    target_audience: z.string().min(1),
    core_pain_points: z.array(z.string().min(1)).min(3).max(3),
    angle_hypotheses: z.array(AngleHypothesisSchema).min(3).max(3),
    hooks: z.array(z.string().min(1)).min(10).max(10),
    scripts_15s: z.array(ScriptSchema).min(3).max(3),
    scripts_30s: z.array(ScriptSchema).min(2).max(2),
    ugc_prompts: z.array(z.string().min(1)).min(3),
    compliance_notes: z.array(z.string().min(1)).min(3)
  })
  .strict();

export type CreativeBrief = z.infer<typeof CreativeBriefSchema>;
