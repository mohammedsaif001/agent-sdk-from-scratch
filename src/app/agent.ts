/**
 * @file agent.ts
 * @description Core Agent SDK implementation providing an extensible autonomous agent
 * powered by OpenAI Chat Completions, structured reasoning pipelines, and tool execution.
 */

import { HARNESS_PROMPT, type AgentStepPayload } from "./config.js";
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
 * Helper to safely extract and parse JSON from model responses,
 * stripping markdown code fences if present.
 *
 * @param raw - Raw string output from the LLM.
 * @returns Parsed AgentStepPayload object.
 */
function parseJSONResponse(raw: string): AgentStepPayload {
    const trimmed = raw.trim();

    // Check if the output is wrapped in markdown code blocks like ```json ... ```
    const codeBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = codeBlockMatch && codeBlockMatch[1] ? codeBlockMatch[1].trim() : trimmed;

    return JSON.parse(candidate) as AgentStepPayload;
}

/**
 * Fluent builder class for assembling and configuring an `Agent` instance.
 */
export class AgentBuilder {
    public instructions: string | undefined;
    public toolList: ITool[];
    public apiKey: string | undefined;
    public model: string = 'gpt-4o';
    public maxLoops: number = 30;

    constructor() {
        this.toolList = [];
    }

    /**
     * Sets the custom system instructions for the agent.
     *
     * @param instructions - High-level system instructions defining the agent's persona.
     */
    public setInstructions(instructions: string): this {
        this.instructions = instructions;
        return this;
    }


    /**
     * Registers a single tool with the agent.
     *
     * @param tool - Tool definition to add.
     */
    public addTool(tool: ITool): this {
        this.toolList.push(tool);
        return this;
    }

    /**
     * Convenient alias for `addTool`.
     *
     * @param tool - Tool definition to add.
     */
    public tool(tool: ITool): this {
        return this.addTool(tool);
    }

    /**
     * Registers multiple tools at once.
     *
     * @param tools - Array of tools to add.
     */
    public addTools(tools: ITool[]): this {
        this.toolList.push(...tools);
        return this;
    }

    /**
     * Configures a custom OpenAI API key.
     * If not set, the agent defaults to `process.env.OPENAI_API_KEY`.
     *
     * @param apiKey - OpenAI API key.
     */
    public setApiKey(apiKey: string): this {
        this.apiKey = apiKey;
        return this;
    }

    /**
     * Configures the OpenAI model identifier (default: `'gpt-4o'`).
     *
     * @param model - Model name, e.g., 'gpt-4o', 'gpt-4o-mini'.
     */
    public setModel(model: string): this {
        this.model = model;
        return this;
    }

    /**
     * Sets the maximum iterations for the reasoning and tool execution loop (default: 30).
     *
     * @param maxLoops - Maximum number of iterations.
     */
    public setMaxLoops(maxLoops: number): this {
        this.maxLoops = maxLoops;
        return this;
    }

    /**
     * Builds and initializes a new `Agent` instance.
     */
    public build(): Agent {
        return new Agent(this);
    }
}

/**
 * Autonomous Agent capable of reasoning, planning, and invoking tools
 * across multiple iterations until an answer is produced.
 */
export class Agent {
    private instructions: string;
    private messageHistory: IMessage[];
    private toolMap: Map<string, ITool>;
    private openai: Openai | null = null;
    private apiKey: string | undefined;
    private interceptors: Interceptor[];
    private maxLoops: number;
    private model: string;

    constructor(builder: AgentBuilder) {
        this.toolMap = new Map();
        this.interceptors = [];
        this.messageHistory = [];
        this.maxLoops = builder.maxLoops;
        this.model = builder.model;
        this.apiKey = builder.apiKey;

        for (const tool of builder.toolList) {
            this.toolMap.set(tool.name, tool);
        }

        // Format available tools as a readable reference for the LLM
        const formattedTools = builder.toolList.length > 0
            ? builder.toolList.map(t => JSON.stringify({
                functionName: t.name,
                functionDescription: t.description,
                functionDoc: t.doc ?? 'No signature doc provided'
            })).join('\n')
            : 'None';

        this.instructions = `
${HARNESS_PROMPT}

Agent Persona & Custom Instructions:
${builder.instructions || 'You are a helpful, accurate, and structured autonomous assistant.'}

Available Tools:
${formattedTools}
        `.trim();
    }

    /**
     * Lazily initializes and returns the OpenAI client instance.
     * Throws a descriptive error if no API key is available.
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
     *
     * @param interceptor - Callback function invoked on every message.
     */
    public attachInterceptor(interceptor: Interceptor): void {
        this.interceptors.push(interceptor);
    }

    /**
     * Broadcasts a message to all attached interceptors safely.
     *
     * @param message - The message payload to dispatch.
     */
    private notifyInterceptors(message: IMessage): void {
        for (const interceptor of this.interceptors) {
            try {
                interceptor(message);
            } catch (err) {
                console.error('Error within message interceptor:', err);
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
     * Runs the autonomous reasoning loop for a given user query.
     *
     * @param query - The user's prompt or question.
     * @returns Complete message history upon completion or loop termination.
     */
    public async run(query: string): Promise<IMessage[]> {
        // 1. Record and notify user message
        const userMessage: IMessage = { role: 'user', content: query };
        this.messageHistory.push(userMessage);
        this.notifyInterceptors(userMessage);

        for (let iteration = 0; iteration < this.maxLoops; iteration++) {
            // 2. Call OpenAI with compiled system prompt and conversation history
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

            // 3. Append and notify assistant response
            const assistantMessage: IMessage = { role: 'assistant', content: rawLLMResponse };
            this.messageHistory.push(assistantMessage);
            this.notifyInterceptors(assistantMessage);

            // 4. Safely parse LLM output JSON
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

            // 5. Termination condition: OUTPUT reached
            if (step === 'output') {
                return this.messageHistory;
            }

            // 6. Tool execution step: TOOL_REQUEST
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

                try {
                    const toolResult = await tool.executor(input);
                    const devResponse: IMessage = {
                        role: 'developer',
                        content: JSON.stringify({
                            functionName,
                            input,
                            toolResult
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

            // 7. Intermediate pipeline steps (INITIAL, THINK, ANALYSE) continue loop to next step
        }

        console.warn(`[Agent] Reached maximum iteration limit of ${this.maxLoops} steps without an OUTPUT step.`);
        return this.messageHistory;
    }
}
