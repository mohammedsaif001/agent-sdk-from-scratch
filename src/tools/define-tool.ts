/**
 * @file define-tool.ts
 * @description Zod-integrated tool definition helper enabling type-safe tool parameters,
 * automatic schema verification, and self-healing error reporting to the LLM.
 */

import { z, type ZodTypeAny } from 'zod';
import type { ITool } from './types.js';

/**
 * Options for configuring a type-safe tool with Zod schema validation.
 */
export interface DefineToolConfig<TSchema extends ZodTypeAny, TOutput = unknown> {
    /** Unique tool identifier name */
    name: string;
    /** Human-readable explanation of when and how to use this tool */
    description: string;
    /** Zod schema defining the expected arguments for this tool */
    schema: TSchema;
    /** Typed function executed when the agent calls this tool */
    executor: (args: z.infer<TSchema>) => Promise<TOutput> | TOutput;
    /** Optional custom documentation override */
    doc?: string;
}

/**
 * Formats a concise signature representation from a Zod schema.
 */
function formatSchemaSignature(name: string, schema: ZodTypeAny): string {
    if (schema instanceof z.ZodObject) {
        const shape = schema.shape as Record<string, any>;
        const fields = Object.entries(shape).map(([key, value]) => {
            const rawType = (value as any)?._def?.typeName?.replace('Zod', '') || (value as any)?.type || 'any';
            const isOptional = typeof (value as any)?.isOptional === 'function' && (value as any).isOptional() ? '?' : '';
            return `${key}${isOptional}: ${String(rawType).toLowerCase()}`;
        });
        return `${name}({ ${fields.join(', ')} })`;
    }
    const rawType = (schema as any)?._def?.typeName?.replace('Zod', '') || (schema as any)?.type || 'input';
    return `${name}(input: ${String(rawType).toLowerCase()})`;
}

/**
 * Defines a type-safe agent tool with automatic Zod schema validation.
 */
export function defineTool<TSchema extends ZodTypeAny, TOutput = unknown>(
    config: DefineToolConfig<TSchema, TOutput>
): ITool {
    const signatureDoc = config.doc ?? formatSchemaSignature(config.name, config.schema);

    return {
        name: config.name,
        description: config.description,
        doc: signatureDoc,
        async executor(rawInput: string): Promise<string> {
            let parsedRaw: unknown;

            const trimmed = rawInput.trim();
            try {
                parsedRaw = JSON.parse(trimmed);
            } catch {
                parsedRaw = trimmed;
            }

            if (config.schema instanceof z.ZodObject && typeof parsedRaw === 'string') {
                const keys = Object.keys(config.schema.shape);
                if (keys.length === 1 && keys[0]) {
                    parsedRaw = { [keys[0]]: parsedRaw };
                }
            }

            const validation = config.schema.safeParse(parsedRaw);

            if (!validation.success) {
                const errorPayload = {
                    status: 'validation_error',
                    message: `Invalid arguments for tool "${config.name}". Please correct and retry.`,
                    errors: validation.error.issues.map(issue => ({
                        path: issue.path.join('.'),
                        expected: issue.message
                    }))
                };
                return JSON.stringify(errorPayload);
            }

            try {
                const result = await config.executor(validation.data);
                if (typeof result === 'string') {
                    return result;
                }
                return JSON.stringify(result);
            } catch (err: any) {
                return JSON.stringify({
                    status: 'execution_error',
                    tool: config.name,
                    error: err?.message || String(err)
                });
            }
        }
    };
}
