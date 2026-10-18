/**
 * @file handoff.ts
 * @description Multi-agent handoff orchestration for the Agent SDK,
 * designed around the OpenAI Agents SDK / Swarm handoff pattern.
 * 
 * Allows agents to seamlessly delegate tasks to specialized peer agents.
 */

import type { IAgent } from '../core/types.js';
import type { ITool, HandoffOptions } from './types.js';

export type { HandoffOptions };


/**
 * Special marker returned when an agent decides to hand off execution.
 */
export interface HandoffSignal {
    __isHandoff: true;
    targetAgent: IAgent;
    reason?: string;
    input?: string;
    passHistory: boolean;
}

/**
 * Checks if a value is a HandoffSignal.
 */
export function isHandoffSignal(value: unknown): value is HandoffSignal {
    return typeof value === 'object' && value !== null && '__isHandoff' in value;
}

/**
 * Creates an executable `ITool` that triggers a handoff to a recipient agent.
 *
 * @param targetAgent - The specialist agent receiving the handoff.
 * @param options - Configuration options for the handoff tool.
 * @returns An `ITool` that can be registered with any `Agent`.
 */
export function createHandoffTool(targetAgent: IAgent, options: HandoffOptions = {}): ITool {
    const agentName = targetAgent.name || 'SpecialistAgent';
    // Clean identifier for tool name
    const sanitizedName = agentName.replace(/[^a-zA-Z0-9_]/g, '_');
    const toolName = options.toolName || `transferTo_${sanitizedName}`;

    const description = options.description ||
        `Hands off the task to the "${agentName}" agent. Use this when the request requires specialized expertise provided by ${agentName}.`;

    return {
        name: toolName,
        description,
        doc: `${toolName}(reason: string): HandoffResult`,
        async executor(input: string): Promise<string> {
            const signal: HandoffSignal = {
                __isHandoff: true,
                targetAgent,
                reason: input,
                input,
                passHistory: options.passHistory ?? true
            };
            return JSON.stringify(signal);
        }
    };
}
