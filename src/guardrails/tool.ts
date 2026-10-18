/**
 * @file tool.ts
 * @description Tool guardrails for preventing destructive commands and unauthorized actions.
 */

import type { GuardrailResult, ToolGuardrail } from './types.js';

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
    // Target CLI execution tools
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
