/**
 * @file output.ts
 * @description Output guardrails for preventing secret, token, and API key leakage.
 */

import type { GuardrailResult, OutputGuardrail } from './types.js';

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
