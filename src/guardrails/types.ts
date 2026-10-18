/**
 * @file types.ts
 * @description Guardrail type definitions for input, output, and tool security.
 */

/**
 * Result returned by a guardrail check.
 */
export interface GuardrailResult {
    /** Whether the content passed the guardrail check */
    passed: boolean;
    /** Cleaned / sanitized text (if modified, e.g. masked PII or redacted secrets) */
    sanitizedText?: string;
    /** Human-readable reason if the check failed */
    reason?: string;
    /** Metadata or diagnostic info (e.g. detected violations) */
    metadata?: Record<string, unknown>;
}

/**
 * Signature for an Input Guardrail function.
 * Evaluates raw incoming user input before it reaches the agent loop.
 */
export type InputGuardrail = (input: string) => Promise<GuardrailResult> | GuardrailResult;

/**
 * Signature for an Output Guardrail function.
 * Evaluates generated agent output before it is returned to the user.
 */
export type OutputGuardrail = (output: string) => Promise<GuardrailResult> | GuardrailResult;

/**
 * Signature for a Tool Guardrail function.
 * Evaluates tool name and arguments before the tool's executor is run.
 */
export type ToolGuardrail = (functionName: string, input: string) => Promise<GuardrailResult> | GuardrailResult;
