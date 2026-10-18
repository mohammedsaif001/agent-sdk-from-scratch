/**
 * @file parser.ts
 * @description Robust JSON parsing and Zod schema validation for model outputs.
 */

import { z } from 'zod';
import type { AgentStepPayload } from './types.js';

/**
 * Zod schema defining valid LLM response payloads.
 */
export const AgentStepSchema = z.object({
    step: z.union([
        z.literal('INITIAL'),
        z.literal('THINK'),
        z.literal('ANALYSE'),
        z.literal('TOOL_REQUEST'),
        z.literal('OUTPUT'),
        z.string()
    ]),
    text: z.string().optional(),
    functionName: z.string().optional(),
    input: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().transform((val) => {
        if (typeof val === 'object' && val !== null) {
            return JSON.stringify(val);
        }
        return val;
    })
});

/**
 * Strips markdown code blocks and parses raw model output into an `AgentStepPayload`.
 * Validates the parsed structure against `AgentStepSchema`.
 *
 * @param raw - The raw text received from the model completion.
 * @returns Validated `AgentStepPayload` object.
 * @throws Error if JSON is malformed or violates the schema.
 */
export function parseJSONResponse(raw: string): AgentStepPayload {
    const trimmed = raw.trim();
    // Strip markdown code fences if present
    const codeBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = codeBlockMatch && codeBlockMatch[1] ? codeBlockMatch[1].trim() : trimmed;

    const parsedJson: unknown = JSON.parse(candidate);
    const validated = AgentStepSchema.parse(parsedJson);

    return validated as AgentStepPayload;
}
