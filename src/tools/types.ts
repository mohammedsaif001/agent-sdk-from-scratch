/**
 * @file types.ts
 * @description Tool interfaces and types for the Agent SDK.
 */

/**
 * Function signature for executing an agent tool.
 */
export type ToolExecutor = (input: string) => Promise<string> | string;

/**
 * Definition of an executable tool that an agent can invoke during reasoning.
 */
export interface ITool {
    /** Unique name identifier for the tool */
    name: string;
    /** Human-readable explanation of what the tool does */
    description: string;
    /** Optional signature or usage documentation for the tool */
    doc?: string;
    /** Function invoked when the agent calls this tool */
    executor: ToolExecutor;
}

/**
 * Configuration options for creating an agent handoff.
 */
export interface HandoffOptions {
    /** Custom function name for the tool (defaults to `transferTo_<AgentName>`) */
    toolName?: string;
    /** Explanation for the LLM of when and why to transfer to this agent */
    description?: string;
    /** Whether to pass accumulated conversation history to the target agent (default: true) */
    passHistory?: boolean;
}

