/**
 * @file guardrails.ts
 * @description Comprehensive Input, Output, and Tool Execution Guardrails for the Agent SDK,
 * modeled after OpenAI Agents SDK and industry security standards (OWASP Top 10 for LLMs).
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

// ============================================================================
// BUILT-IN INPUT GUARDRAILS
// ============================================================================

/**
 * Common prompt injection, jailbreak, and system override signatures.
 */
const INJECTION_PATTERNS: RegExp[] = [
    /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
    /disregard\s+(all\s+)?(previous|prior)\s+guidelines/i,
    /you\s+are\s+now\s+(unrestricted|DAN|jailbroken|free)/i,
    /system\s+override/i,
    /reveal\s+(your\s+)?(system\s+prompt|internal\s+instructions)/i,
    /print\s+(your\s+)?(initial\s+prompt|system\s+message)/i,
    /bypass\s+(safety\s+)?filters/i,
];

/**
 * Input Guardrail: Detects prompt injections, jailbreaks, and system override attempts.
 */
export const promptInjectionGuardrail: InputGuardrail = (input: string): GuardrailResult => {
    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(input)) {
            return {
                passed: false,
                reason: `Security Alert: Prompt injection or jailbreak attempt detected (rule: ${pattern.source}). Request blocked.`,
                metadata: { pattern: pattern.source }
            };
        }
    }
    return { passed: true, sanitizedText: input };
};

/**
 * Input Guardrail: Masks common PII (emails, phone numbers, credit card patterns) before sending to LLMs.
 */
export const piiMaskingInputGuardrail: InputGuardrail = (input: string): GuardrailResult => {
    let sanitized = input;

    // Mask Emails
    sanitized = sanitized.replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, '[EMAIL_REDACTED]');

    // Mask Phone numbers (E.164 and common 10-digit formats)
    sanitized = sanitized.replace(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[PHONE_REDACTED]');

    // Mask Credit Card patterns (16 digits with dashes or spaces)
    sanitized = sanitized.replace(/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, '[CREDIT_CARD_REDACTED]');

    return {
        passed: true,
        sanitizedText: sanitized
    };
};

/**
 * Input Guardrail: Enforces a maximum character limit on incoming prompts to prevent denial-of-wallet.
 */
export function createInputLengthGuardrail(maxLength: number = 4000): InputGuardrail {
    return (input: string): GuardrailResult => {
        if (input.length > maxLength) {
            return {
                passed: false,
                reason: `Input exceeds maximum allowed length of ${maxLength} characters (received ${input.length}).`
            };
        }
        return { passed: true, sanitizedText: input };
    };
}

// ============================================================================
// BUILT-IN OUTPUT GUARDRAILS
// ============================================================================

/**
 * Output Guardrail: Redacts accidentally leaked API keys, tokens, and secrets from model outputs.
 */
export const secretLeakageOutputGuardrail: OutputGuardrail = (output: string): GuardrailResult => {
    let sanitized = output;
    let redactedCount = 0;

    // OpenAI API Keys (sk-..., sk-proj-...)
    const openaiKeyPattern = /\bsk-(?:proj-)?[a-zA-Z0-9_-]{20,}\b/g;
    if (openaiKeyPattern.test(sanitized)) {
        sanitized = sanitized.replace(openaiKeyPattern, '[REDACTED_OPENAI_KEY]');
        redactedCount++;
    }

    // GitHub Personal Access Tokens (ghp_..., gho_...)
    const githubTokenPattern = /\bgh[pousr]_[a-zA-Z0-9]{36,}\b/g;
    if (githubTokenPattern.test(sanitized)) {
        sanitized = sanitized.replace(githubTokenPattern, '[REDACTED_GITHUB_TOKEN]');
        redactedCount++;
    }

    // AWS Access Key IDs (AKIA...)
    const awsKeyPattern = /\bAKIA[0-9A-Z]{16}\b/g;
    if (awsKeyPattern.test(sanitized)) {
        sanitized = sanitized.replace(awsKeyPattern, '[REDACTED_AWS_KEY]');
        redactedCount++;
    }

    // Generic Bearer Tokens
    const bearerPattern = /Bearer\s+[a-zA-Z0-9_.-]{25,}/g;
    if (bearerPattern.test(sanitized)) {
        sanitized = sanitized.replace(bearerPattern, 'Bearer [REDACTED_TOKEN]');
        redactedCount++;
    }

    return {
        passed: true,
        sanitizedText: sanitized,
        metadata: { redactedSecretsCount: redactedCount }
    };
};

// ============================================================================
// BUILT-IN TOOL GUARDRAILS
// ============================================================================

/**
 * Patterns of potentially destructive or dangerous CLI commands.
 */
const DESTRUCTIVE_CLI_PATTERNS: RegExp[] = [
    /\brm\s+-[rf]{1,2}\b/i,                 // rm -rf
    /\brmdir\s+\/[sq]\b/i,                 // Windows rmdir /s
    /\bdel\s+\/f\s+\/s\s+\/q\s+[c-z]:/i,   // Windows del /f /s /q C:
    /\bformat\s+[c-z]:/i,                  // Format disk
    /\bshutdown\b/i,                       // System shutdown
    /:(){ :|:& };:/,                       // Bash fork bomb
    /\bmkfs\b/i,                           // Create filesystem
    /\bdd\s+if=/i                          // Raw disk overwrite
];

/**
 * Tool Execution Guardrail: Inspects CLI commands and blocks destructive actions.
 */
export const cliSecurityToolGuardrail: ToolGuardrail = (functionName: string, input: string): GuardrailResult => {
    // Only target CLI execution tools
    if (['execCli', 'executeCli', 'executeCommandCli', 'bash', 'terminal'].includes(functionName)) {
        for (const pattern of DESTRUCTIVE_CLI_PATTERNS) {
            if (pattern.test(input)) {
                return {
                    passed: false,
                    reason: `Tool Execution Blocked: Destructive or unauthorized CLI command detected ("${input}").`,
                    metadata: { functionName, input, matchedRule: pattern.source }
                };
            }
        }
    }
    return { passed: true };
};

/**
 * Preset containing production-ready default guardrails for input, output, and tools.
 */
export const defaultGuardrails = {
    inputs: [promptInjectionGuardrail, piiMaskingInputGuardrail],
    outputs: [secretLeakageOutputGuardrail],
    tools: [cliSecurityToolGuardrail]
};
