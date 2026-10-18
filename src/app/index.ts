/**
 * @file index.ts
 * @description Main entry point for the Agent SDK.
 * 
 * Re-exports core Agent architectures, Guardrails, Handoff orchestration,
 * and harness prompts conforming to modern Agent SDK standards.
 */

// Core Agent & Builder
export {
    Agent,
    AgentBuilder,
    type AgentOptions,
    type IMessage,
    type ITool,
    type Interceptor
} from './agent.js';

// Multi-Agent Handoffs
export {
    createHandoffTool,
    isHandoffSignal,
    type HandoffOptions,
    type HandoffSignal
} from './handoff.js';

// Guardrails (Input, Output, and Tool Security)
export {
    defaultGuardrails,
    promptInjectionGuardrail,
    piiMaskingInputGuardrail,
    createInputLengthGuardrail,
    secretLeakageOutputGuardrail,
    cliSecurityToolGuardrail,
    type InputGuardrail,
    type OutputGuardrail,
    type ToolGuardrail,
    type GuardrailResult
} from './guardrails.js';

// Prompt Harness & Step Payloads
export {
    HARNESS_PROMPT,
    type AgentStepType,
    type AgentStepPayload
} from './config.js';
