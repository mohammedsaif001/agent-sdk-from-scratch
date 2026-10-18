/**
 * @file types.ts
 * @description Core types and interfaces for the Agent SDK.
 */

import type { ITool, HandoffOptions } from '../tools/types.js';
import type { InputGuardrail, OutputGuardrail, ToolGuardrail } from '../guardrails/types.js';


/**
 * Chat message structure exchanged between the user, agent, and tools.
 */
export interface IMessage {
    /** The role of the message sender */
    role: 'user' | 'assistant' | 'developer' | 'system';
    /** The text content or JSON-encoded payload */
    content: string;
}

/**
 * Valid pipeline step types supported by the reasoning harness.
 */
export type AgentStepType =
    | 'INITIAL'
    | 'THINK'
    | 'ANALYSE'
    | 'TOOL_REQUEST'
    | 'OUTPUT';

/**
 * Interface representing the JSON structure expected from the LLM at each reasoning step.
 */
export interface AgentStepPayload {
    /** The current step in the reasoning pipeline */
    step: AgentStepType | string;
    /** The thought process or reasoning text for this step */
    text?: string;
    /** Name of the tool to invoke when step is 'TOOL_REQUEST' */
    functionName?: string;
    /** Argument/input payload passed to the requested tool */
    input?: string;
}

/**
 * Callback function to observe and intercept messages as they flow through the agent.
 */
export type Interceptor = (message: IMessage) => void;

/**
 * Interface representing an autonomous agent runtime instance.
 * Decouples types from the concrete Agent class implementation to prevent circular dependencies.
 */
export interface IAgent {
    /** The display name of the agent */
    readonly name: string;
    /** Executes the agent with a user prompt and optional run options */
    run(query: string, options?: AgentRunOptions): Promise<IMessage[]>;
    /** Attaches an interceptor callback to observe message emissions in real time */
    attachInterceptor(interceptor: Interceptor): void;
}

/**
 * Configuration options for creating an Agent.
 */
export interface AgentOptions {
    /** Display name of the agent (e.g. 'Coding Specialist', 'Weather Agent') */
    name?: string;
    /** Custom instructions or persona for the agent */
    instructions?: string;
    /** List of tools accessible to this agent */
    tools?: ITool[];
    /** List of peer agents this agent can hand off tasks to */
    handoffs?: Array<IAgent | { agent: IAgent; options?: HandoffOptions }>;
    /** Input guardrails evaluated before the user prompt reaches the model */
    inputGuardrails?: InputGuardrail[];
    /** Output guardrails evaluated before returning the final response */
    outputGuardrails?: OutputGuardrail[];
    /** Tool guardrails evaluated before any tool executor is called */
    toolGuardrails?: ToolGuardrail[];
    /** OpenAI API key (defaults to process.env.OPENAI_API_KEY) */
    apiKey?: string;
    /** OpenAI model identifier (default: 'gpt-4o') */
    model?: string;
    /** Maximum reasoning iterations (default: 30) */
    maxLoops?: number;
}

/**
 * Runtime execution options passed to `agent.run()`.
 */
export interface AgentRunOptions {
    /** Existing message history (e.g. inherited during a handoff) */
    history?: IMessage[];
}
