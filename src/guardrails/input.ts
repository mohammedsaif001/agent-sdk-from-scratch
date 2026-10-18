/**
 * @file input.ts
 * @description Input guardrails for prompt injection screening and PII masking.
 */

import type { GuardrailResult, InputGuardrail } from './types.js';

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
 * Input Guardrail Factory: Enforces a maximum character limit on incoming prompts to prevent denial-of-wallet.
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
