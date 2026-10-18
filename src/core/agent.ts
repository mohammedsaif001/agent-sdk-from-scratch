/**
 * @file agent.ts
 * @description Core autonomous Agent runtime orchestrating multi-step reasoning,
 * tool execution, guardrail enforcement, and multi-agent handoffs.
 */

import Openai from 'openai';
import { HARNESS_PROMPT, formatToolSignatures } from './prompt.js';
import { parseJSONResponse } from './parser.js';
import { AgentBuilder } from './builder.js';
import type { IMessage, AgentStepPayload, Interceptor, AgentOptions, AgentRunOptions, IAgent } from './types.js';
import type { ITool, HandoffOptions, HandoffSignal } from '../tools/index.js';
import { createHandoffTool, isHandoffSignal } from '../tools/handoff.js';
import type { InputGuardrail, OutputGuardrail, ToolGuardrail } from '../guardrails/types.js';

/**
 * Autonomous Agent capable of multi-step reasoning, tool execution,
 * multi-agent handoffs, and bidirectional guardrail validation.
 */
export class Agent implements IAgent {
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
        let customInstructions = '';
        let tools: ITool[] = [];
        let handoffs: Array<{ agent: IAgent; options?: HandoffOptions }> = [];
        let inputGuards: InputGuardrail[] = [];
        let outputGuards: OutputGuardrail[] = [];
        let toolGuards: ToolGuardrail[] = [];
        let model = 'gpt-4o';
        let maxLoops = 30;
        let apiKey: string | undefined;

        if (builderOrOptions instanceof AgentBuilder) {
            name = builderOrOptions.name;
            customInstructions = builderOrOptions.instructions || '';
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
            customInstructions = builderOrOptions.instructions ?? customInstructions;
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

        // Register standard tools
        for (const tool of tools) {
            this.toolMap.set(tool.name, tool);
        }

        // Register handoff tools
        for (const { agent: targetAgent, options } of handoffs) {
            const handoffTool = createHandoffTool(targetAgent, options);
            this.toolMap.set(handoffTool.name, handoffTool);
        }

        // Compile tool documentation for the harness prompt
        const formattedTools = formatToolSignatures(this.toolMap.values());

        this.instructions = `
${HARNESS_PROMPT}

Agent Name:
${this.name}

Agent Persona & Custom Instructions:
${customInstructions || 'You are a helpful, accurate, and structured autonomous assistant.'}

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
     * Sets or imports existing conversation history.
     */
    public setHistory(history: IMessage[]): void {
        this.messageHistory = [...history];
    }

    /**
     * Runs the autonomous reasoning loop for a given user query.
     */
    public async run(query: string, options?: AgentRunOptions): Promise<IMessage[]> {
        if (options?.history) {
            this.messageHistory = [...options.history];
        }

        // ====================================================================
        // 1. INPUT GUARDRAILS EVALUATION
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

                        // Attach this agent's interceptors to target agent
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
