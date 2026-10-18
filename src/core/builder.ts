/**
 * @file builder.ts
 * @description Fluent builder class for assembling and configuring an Agent instance.
 */

import { Agent } from './agent.js';
import type { IAgent } from './types.js';
import type { ITool, HandoffOptions } from '../tools/types.js';
import type { InputGuardrail, OutputGuardrail, ToolGuardrail } from '../guardrails/types.js';

import { defaultGuardrails } from '../guardrails/index.js';

/**
 * Fluent builder class for assembling and configuring an `Agent` instance.
 */
export class AgentBuilder {
    public name: string = 'Agent';
    public instructions: string | undefined;
    public toolList: ITool[] = [];
    public handoffsList: Array<{ agent: IAgent; options?: HandoffOptions }> = [];
    public inputGuardrails: InputGuardrail[] = [];
    public outputGuardrails: OutputGuardrail[] = [];
    public toolGuardrails: ToolGuardrail[] = [];
    public apiKey: string | undefined;
    public model: string = 'gpt-4o';
    public maxLoops: number = 30;

    /**
     * Sets the agent's display name.
     */
    public setName(name: string): this {
        this.name = name;
        return this;
    }

    /**
     * Sets the system instructions / persona.
     */
    public setInstructions(instructions: string): this {
        this.instructions = instructions;
        return this;
    }

    /**
     * Adds a single tool to the agent.
     */
    public addTool(tool: ITool): this {
        this.toolList.push(tool);
        return this;
    }

    /**
     * Alias for `addTool`.
     */
    public tool(tool: ITool): this {
        return this.addTool(tool);
    }

    /**
     * Adds multiple tools at once.
     */
    public addTools(tools: ITool[]): this {
        this.toolList.push(...tools);
        return this;
    }

    /**
     * Adds an agent handoff, enabling this agent to delegate to another specialist.
     */
    public addHandoff(targetAgent: IAgent, options?: HandoffOptions): this {
        if (options !== undefined) {
            this.handoffsList.push({ agent: targetAgent, options });
        } else {
            this.handoffsList.push({ agent: targetAgent });
        }
        return this;
    }

    /**
     * Adds multiple agent handoffs.
     */
    public addHandoffs(agents: IAgent[]): this {
        for (const agent of agents) {
            this.addHandoff(agent);
        }
        return this;
    }

    /**
     * Adds an Input Guardrail to screen or sanitize user prompts.
     */
    public addInputGuardrail(guardrail: InputGuardrail): this {
        this.inputGuardrails.push(guardrail);
        return this;
    }

    /**
     * Adds an Output Guardrail to screen or sanitize LLM responses.
     */
    public addOutputGuardrail(guardrail: OutputGuardrail): this {
        this.outputGuardrails.push(guardrail);
        return this;
    }

    /**
     * Adds a Tool Guardrail to intercept tool invocations before execution.
     */
    public addToolGuardrail(guardrail: ToolGuardrail): this {
        this.toolGuardrails.push(guardrail);
        return this;
    }

    /**
     * Activates the standard production guardrail suite.
     */
    public useDefaultGuardrails(): this {
        this.inputGuardrails.push(...defaultGuardrails.inputs);
        this.outputGuardrails.push(...defaultGuardrails.outputs);
        this.toolGuardrails.push(...defaultGuardrails.tools);
        return this;
    }

    /**
     * Configures a custom OpenAI API key.
     */
    public setApiKey(apiKey: string): this {
        this.apiKey = apiKey;
        return this;
    }

    /**
     * Sets the OpenAI model identifier (default: 'gpt-4o').
     */
    public setModel(model: string): this {
        this.model = model;
        return this;
    }

    /**
     * Sets the maximum loop iterations (default: 30).
     */
    public setMaxLoops(maxLoops: number): this {
        this.maxLoops = maxLoops;
        return this;
    }

    /**
     * Builds and returns a new `Agent` instance.
     */
    public build(): Agent {
        return new Agent(this);
    }
}
