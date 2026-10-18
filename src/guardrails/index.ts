/**
 * @file index.ts
 * @description Exports for the guardrails module.
 */

import { promptInjectionGuardrail, piiMaskingInputGuardrail } from './input.js';
import { secretLeakageOutputGuardrail } from './output.js';
import { cliSecurityToolGuardrail } from './tool.js';

export * from './types.js';
export * from './input.js';
export * from './output.js';
export * from './tool.js';

/**
 * Production-ready default guardrail suite.
 */
export const defaultGuardrails = {
    inputs: [promptInjectionGuardrail, piiMaskingInputGuardrail],
    outputs: [secretLeakageOutputGuardrail],
    tools: [cliSecurityToolGuardrail]
};
