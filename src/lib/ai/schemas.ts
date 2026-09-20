/**
 * What the AI is allowed to say, as a JSON schema for the provider and a
 * Zod validator for us. One call per event returns everything: the context
 * it read, its factors with bounded effects, an optional forecast (AI mode)
 * and the narrative.
 */

import { z } from 'zod';

import type { JsonSchema } from '@/lib/ai/provider';

export const MAX_FACTOR_EFFECT = 8;

export const aiAssessmentSchema: JsonSchema = {
  type: 'object',
  properties: {
    narrative: { type: 'string', description: 'Two or three plain sentences a fan would find useful: the shape of the match and what decides it. No hedging boilerplate.' },
    factors: {
      type: 'array',
      maxItems: 6,
      description: 'Things the statistics cannot see, each with a bounded effect in percentage points on the home side (positive favours the home side).',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Short snake_case identifier, e.g. key_absence, new_manager, motivation, fixture_congestion, weather.' },
          label: { type: 'string', description: 'Three to five words for the match page.' },
          effect: { type: 'number', minimum: -8, maximum: 8, description: 'Percentage points on the home win probability. Most factors are worth 1 to 3; only a decisive absence or a dead rubber reaches 6 or more.' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          note: { type: 'string', description: 'One sentence of evidence, citing the source when it came from a headline.' },
        },
        required: ['key', 'label', 'effect', 'confidence', 'note'],
      },
    },
    absences: {
      type: 'array',
      maxItems: 12,
      description: 'Players you believe are unavailable, from the injury list and the headlines.',
      items: {
        type: 'object',
        properties: {
          side: { type: 'string', enum: ['HOME', 'AWAY'] },
          player: { type: 'string' },
          importance: { type: 'string', enum: ['key', 'regular', 'fringe'] },
        },
        required: ['side', 'player', 'importance'],
      },
    },
    probabilities: {
      type: 'object',
      description: 'Only when asked to forecast: your own probabilities, summing to 1.',
      properties: {
        HOME: { type: 'number', minimum: 0, maximum: 1 },
        DRAW: { type: 'number', minimum: 0, maximum: 1 },
        AWAY: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['HOME', 'AWAY'],
    },
    expectedScore: {
      type: 'object',
      description: 'Only when asked to forecast: the most likely scoreline.',
      properties: {
        home: { type: 'integer', minimum: 0, maximum: 20 },
        away: { type: 'integer', minimum: 0, maximum: 20 },
      },
      required: ['home', 'away'],
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'], description: 'How much the context you found should move the statistical forecast.' },
  },
  required: ['narrative', 'factors', 'absences', 'confidence'],
};

export const aiAssessmentValidator = z.object({
  narrative: z.string().max(1_200),
  factors: z
    .array(
      z.object({
        key: z.string().max(40),
        label: z.string().max(60),
        effect: z.number().min(-MAX_FACTOR_EFFECT * 2).max(MAX_FACTOR_EFFECT * 2),
        confidence: z.enum(['low', 'medium', 'high']),
        note: z.string().max(300),
      }),
    )
    .max(8),
  absences: z.array(z.object({ side: z.enum(['HOME', 'AWAY']), player: z.string().max(80), importance: z.enum(['key', 'regular', 'fringe']) })).max(16),
  probabilities: z.object({ HOME: z.number().min(0).max(1), DRAW: z.number().min(0).max(1).optional(), AWAY: z.number().min(0).max(1) }).optional(),
  expectedScore: z.object({ home: z.number().int().min(0).max(20), away: z.number().int().min(0).max(20) }).optional(),
  confidence: z.enum(['low', 'medium', 'high']),
});

export type AiAssessment = z.infer<typeof aiAssessmentValidator>;

export const aiReviewSchema: JsonSchema = {
  type: 'object',
  properties: {
    lessons: { type: 'array', maxItems: 6, items: { type: 'string' }, description: 'Short, specific observations about where the forecasts went wrong and what pattern, if any, explains it.' },
    suggestions: { type: 'array', maxItems: 4, items: { type: 'string' }, description: 'Concrete things to try in the Lab (a parameter, a feature, a weight), or "nothing" if the misses look like noise.' },
  },
  required: ['lessons', 'suggestions'],
};

export const aiReviewValidator = z.object({ lessons: z.array(z.string().max(300)).max(8), suggestions: z.array(z.string().max(300)).max(6) });
export type AiReview = z.infer<typeof aiReviewValidator>;
