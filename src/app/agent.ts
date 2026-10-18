/**
 * @file agent.ts
 * @description Core Agent SDK implementation providing an extensible autonomous agent
 * with support for Multi-Step Reasoning, Input & Output Guardrails, Tool Execution Security,
 * and OpenAI-style Multi-Agent Handoffs.
 */

import { HARNESS_PROMPT, type AgentStepPayload } from "./config.js";
import {
    defaultGuardrails,
    type InputGuardrail,
    type OutputGuardrail,
    type ToolGuardrail
} from "./guardrails.js";
import {
    createHandoffTool,
    isHandoffSignal,
    type HandoffOptions,
    type HandoffSignal
} from "./handoff.js";
import Openai from 'openai';

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
    executor: (input: string) => Promise<string> | string;
}

/**
 * Callback function to observe and intercept messages as they flow through the agent.
 */
export type Interceptor = (message: IMessage) => void;

/**
 * Options for configuring an Agent directly without the builder.
 */
export interface AgentOptions {
    /** Name of the agent (e.g. 'Coding Specialist', 'Weather Agent') */
    name?: string;
    /** Custom instructions or persona for the agent */
    instructions?: string;
    /** List of tools accessible to this agent */
    tools?: ITool[];
    /** List of peer agents this agent can hand off tasks to */
    handoffs?: Array<Agent | { agent: Agent; options?: HandoffOptions }>;
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
 * Helper to safely extract and parse JSON from model responses,
 * stripping markdown code fences if present.
 */
function parseJSONResponse(raw: string): AgentStepPayload {
    const trimmed = raw.trim();
    const codeBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = codeBlockMatch && codeBlockMatch[1] ? codeBlockMatch[1].trim() : trimmed;
    return JSON.parse(candidate) as AgentStepPayload;
}

/**
 * Fluent builder class for assembling and configuring an `Agent` instance.
 */
export class AgentBuilder {
    public name: string = 'Agent';
    public instructions: string | undefined;
    public toolList: ITool[] = [];
    public handoffsList: Array<{ agent: Agent; options?: HandoffOptions }> = [];
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
    public addHandoff(targetAgent: Agent, options?: HandoffOptions): this {
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
    public addHandoffs(agents: Agent[]): this {
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
     * Activates the standard production guardrail suite:
     * - Input: Prompt injection detection & PII masking
     * - Output: API key / token secret leak detection
     * - Tools: Destructive CLI command blocker
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

/**
 * Autonomous Agent capable of multi-step reasoning, tool execution,
 * multi-agent handoffs, and bidirectional guardrail validation.
 */
export class Agent {
    public readonly name: string;
    private instructions: string;
    private messageHistory: IMessage[];
    private toolMap: Map<string, ITool>;
    private openai: Openai | null = null;
    private apiKey: string | undefined;
    private interceptors: Interceptor[];
    private maxLoops: number;
    private model: string;
    private inputGuardrails: InputGuardrail[];
    private outputGuardrails: OutputGuardrail[];
    private toolGuardrails: ToolGuardrail[];

    constructor(builderOrOptions?: AgentBuilder | AgentOptions) {
        this.toolMap = new Map();
        this.interceptors = [];
        this.messageHistory = [];

        let name = 'Agent';
        let instructions = '';
        let tools: ITool[] = [];
        let handoffs: Array<{ agent: Agent; options?: HandoffOptions }> = [];
        let inputGuards: InputGuardrail[] = [];
        let outputGuards: OutputGuardrail[] = [];
        let toolGuards: ToolGuardrail[] = [];
        let model = 'gpt-4o';
        let maxLoops = 30;
        let apiKey: string | undefined;

        if (builderOrOptions instanceof AgentBuilder) {
            name = builderOrOptions.name;
            instructions = builderOrOptions.instructions || '';
            tools = [...builderOrOptions.toolList];
            handoffs = [...builderOrOptions.handoffsList];
            inputGuards = [...builderOrOptions.inputGuardrails];
            outputGuards = [...builderOrOptions.outputGuardrails];
            toolGuards = [...builderOrOptions.toolGuardrails];
            model = builderOrOptions.model;
            maxLoops = builderOrOptions.maxLoops;
            apiKey = builderOrOptions.apiKey;
        } else if (builderOrOptions) {
            name = builderOrOptions.name ?? name;
            instructions = builderOrOptions.instructions ?? instructions;
            tools = builderOrOptions.tools ? [...builderOrOptions.tools] : [];
            if (builderOrOptions.handoffs) {
                handoffs = builderOrOptions.handoffs.map(h => 'agent' in h ? h : { agent: h });
            }
            inputGuards = builderOrOptions.inputGuardrails ? [...builderOrOptions.inputGuardrails] : [];
            outputGuards = builderOrOptions.outputGuardrails ? [...builderOrOptions.outputGuardrails] : [];
            toolGuards = builderOrOptions.toolGuardrails ? [...builderOrOptions.toolGuardrails] : [];
            model = builderOrOptions.model ?? model;
            maxLoops = builderOrOptions.maxLoops ?? maxLoops;
            apiKey = builderOrOptions.apiKey;
        }

        this.name = name;
        this.model = model;
        this.maxLoops = maxLoops;
        this.apiKey = apiKey;
        this.inputGuardrails = inputGuards;
        this.outputGuardrails = outputGuards;
        this.toolGuardrails = toolGuards;

        // Register tools
        for (const tool of tools) {
            this.toolMap.set(tool.name, tool);
        }

        // Register handoff tools
        for (const { agent: targetAgent, options } of handoffs) {
            const handoffTool = createHandoffTool(targetAgent, options);
            this.toolMap.set(handoffTool.name, handoffTool);
        }

        // Compile tool documentation for the harness prompt
        const formattedTools = this.toolMap.size > 0
            ? Array.from(this.toolMap.values()).map(t => JSON.stringify({
                functionName: t.name,
                functionDescription: t.description,
                functionDoc: t.doc ?? 'No signature doc provided'
            })).join('\n')
            : 'None';

        this.instructions = `
${HARNESS_PROMPT}

Agent Name:
${this.name}

Agent Persona & Custom Instructions:
${instructions || 'You are a helpful, accurate, and structured autonomous assistant.'}

Available Tools & Handoffs:
${formattedTools}
        `.trim();
    }

    /**
     * Lazily initializes and returns the OpenAI client instance.
     */
    private getOpenAIClient(): Openai {
        if (!this.openai) {
            const resolvedKey = this.apiKey || process.env.OPENAI_API_KEY;
            if (!resolvedKey) {
                throw new Error(
                    'OpenAI API key is missing. Please set the OPENAI_API_KEY environment variable in your .env file or provide it via Agent.builder().setApiKey("your-key").'
                );
            }
            this.openai = new Openai({ apiKey: resolvedKey });
        }
        return this.openai;
    }

    /**
     * Returns a new `AgentBuilder` instance.
     */
    public static builder(): AgentBuilder {
        return new AgentBuilder();
    }

    /**
     * Attaches an interceptor callback to observe message emissions in real time.
     */
    public attachInterceptor(interceptor: Interceptor): void {
        this.interceptors.push(interceptor);
    }

    /**
     * Dispatches a message to all attached interceptors.
     */
    private notifyInterceptors(message: IMessage): void {
        for (const interceptor of this.interceptors) {
            try {
                interceptor(message);
            } catch (err) {
                console.error(`[${this.name}] Error within message interceptor:`, err);
            }
        }
    }

    /**
     * Prints the compiled system prompt to standard output for debugging.
     */
    public printSystemPrompt(): void {
        console.log(this.instructions);
    }

    /**
     * Retrieves a copy of the conversation history.
     */
    public getHistory(): IMessage[] {
        return [...this.messageHistory];
    }

    /**
     * Sets or imports existing conversation history (useful during handoffs).
     */
    public setHistory(history: IMessage[]): void {
        this.messageHistory = [...history];
    }

    /**
     * Runs the autonomous reasoning loop for a given user query.
     *
     * @param query - The user's input prompt.
     * @param options - Optional run configuration (e.g. existing history from a handoff).
     * @returns Complete message history upon completion.
     */
    public async run(query: string, options?: { history?: IMessage[] }): Promise<IMessage[]> {
        if (options?.history) {
            this.messageHistory = [...options.history];
        }

        // ====================================================================
        // 1. INPUT GUARDRAILS
        // ====================================================================
        let sanitizedInput = query;
        for (const guard of this.inputGuardrails) {
            const check = await guard(sanitizedInput);
            if (!check.passed) {
                const rejectionMsg: IMessage = {
                    role: 'assistant',
                    content: JSON.stringify({
                        step: 'OUTPUT',
                        text: `⚠️ Request Blocked by Security Policy: ${check.reason || 'Input guardrail validation failed.'}`
                    })
                };
                this.messageHistory.push({ role: 'user', content: query });
                this.messageHistory.push(rejectionMsg);
                this.notifyInterceptors(rejectionMsg);
                return this.messageHistory;
            }
            if (check.sanitizedText !== undefined) {
                sanitizedInput = check.sanitizedText;
            }
        }

        // Record and broadcast user input
        const userMessage: IMessage = { role: 'user', content: sanitizedInput };
        this.messageHistory.push(userMessage);
        this.notifyInterceptors(userMessage);

        // ====================================================================
        // 2. REASONING & EXECUTION LOOP
        // ====================================================================
        for (let iteration = 0; iteration < this.maxLoops; iteration++) {
            const client = this.getOpenAIClient();
            const llmResponse = await client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: this.instructions },
                    ...this.messageHistory.map(entry => ({
                        role: entry.role,
                        content: entry.content
                    }))
                ]
            });

            const rawLLMResponse = llmResponse.choices[0]?.message?.content ?? '';

            const assistantMessage: IMessage = { role: 'assistant', content: rawLLMResponse };
            this.messageHistory.push(assistantMessage);
            this.notifyInterceptors(assistantMessage);

            let parsedResult: AgentStepPayload;
            try {
                parsedResult = parseJSONResponse(rawLLMResponse);
            } catch (parseError: any) {
                const feedbackContent = `Error: Could not parse response as valid JSON (${parseError.message}). Please respond strictly with valid JSON matching the schema.`;
                const feedbackMessage: IMessage = { role: 'developer', content: feedbackContent };
                this.messageHistory.push(feedbackMessage);
                this.notifyInterceptors(feedbackMessage);
                continue;
            }

            const step = parsedResult.step ? String(parsedResult.step).trim().toLowerCase() : '';

            // ================================================================
            // 3. OUTPUT GUARDRAIL EVALUATION
            // ================================================================
            if (step === 'output') {
                let finalText = parsedResult.text ?? rawLLMResponse;

                for (const outGuard of this.outputGuardrails) {
                    const outCheck = await outGuard(finalText);
                    if (!outCheck.passed) {
                        finalText = `⚠️ Response Blocked by Output Security Policy: ${outCheck.reason || 'Violation detected.'}`;
                        break;
                    }
                    if (outCheck.sanitizedText !== undefined) {
                        finalText = outCheck.sanitizedText;
                    }
                }

                // If sanitized, update the last assistant message
                if (finalText !== parsedResult.text) {
                    parsedResult.text = finalText;
                    const updatedContent = JSON.stringify(parsedResult);
                    this.messageHistory[this.messageHistory.length - 1]!.content = updatedContent;
                }

                return this.messageHistory;
            }

            // ================================================================
            // 4. TOOL & HANDOFF EXECUTION
            // ================================================================
            if (step === 'tool_request') {
                const functionName = parsedResult.functionName ?? '';
                const input = parsedResult.input ?? '';
                const tool = this.toolMap.get(functionName);

                if (!tool) {
                    const available = Array.from(this.toolMap.keys()).join(', ') || 'No tools registered';
                    const errorMsg = `Error: Tool "${functionName}" does not exist. Available tools: ${available}`;
                    const devMessage: IMessage = { role: 'developer', content: errorMsg };
                    this.messageHistory.push(devMessage);
                    this.notifyInterceptors(devMessage);
                    continue;
                }

                // Enforce Tool Execution Guardrails
                let toolBlocked = false;
                for (const toolGuard of this.toolGuardrails) {
                    const guardCheck = await toolGuard(functionName, input);
                    if (!guardCheck.passed) {
                        const blockedMsg = `Security Error: ${guardCheck.reason || 'Tool execution was blocked by policy.'}`;
                        const devBlocked: IMessage = {
                            role: 'developer',
                            content: JSON.stringify({
                                functionName,
                                input,
                                error: blockedMsg
                            })
                        };
                        this.messageHistory.push(devBlocked);
                        this.notifyInterceptors(devBlocked);
                        toolBlocked = true;
                        break;
                    }
                }

                if (toolBlocked) {
                    continue;
                }

                // Execute the tool
                try {
                    const rawToolResult = await tool.executor(input);

                    // Check for Agent Handoff Signal
                    let parsedSignal: unknown;
                    try {
                        parsedSignal = JSON.parse(rawToolResult);
                    } catch {
                        parsedSignal = null;
                    }

                    if (isHandoffSignal(parsedSignal)) {
                        const signal: HandoffSignal = parsedSignal;
                        const targetAgent = signal.targetAgent;

                        const handoffNotice: IMessage = {
                            role: 'developer',
                            content: `[HANDOFF]: Transferring execution from "${this.name}" to specialist agent "${targetAgent.name}". Context: ${signal.reason ?? 'Delegated task'}`
                        };
                        this.messageHistory.push(handoffNotice);
                        this.notifyInterceptors(handoffNotice);

                        // Attach this agent's interceptors to the target agent so logging continues uninterrupted
                        for (const interceptor of this.interceptors) {
                            targetAgent.attachInterceptor(interceptor);
                        }

                        // Seamlessly transfer conversation history to target agent and execute
                        const delegatedHistory = signal.passHistory ? [...this.messageHistory] : [];
                        return await targetAgent.run(signal.input || query, { history: delegatedHistory });
                    }

                    // Standard tool response
                    const devResponse: IMessage = {
                        role: 'developer',
                        content: JSON.stringify({
                            functionName,
                            input,
                            toolResult: rawToolResult
                        })
                    };
                    this.messageHistory.push(devResponse);
                    this.notifyInterceptors(devResponse);
                } catch (toolError: any) {
                    const errResponse: IMessage = {
                        role: 'developer',
                        content: JSON.stringify({
                            functionName,
                            input,
                            error: `Tool execution failed: ${toolError?.message || String(toolError)}`
                        })
                    };
                    this.messageHistory.push(errResponse);
                    this.notifyInterceptors(errResponse);
                }

                continue;
            }
        }

        console.warn(`[${this.name}] Reached maximum iteration limit of ${this.maxLoops} steps without an OUTPUT step.`);
        return this.messageHistory;
    }
}
