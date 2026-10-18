/**
 * @file index.ts
 * @description Demonstration entry point showcasing the Agent SDK.
 * 
 * Sets up custom tools (Weather fetching & CLI execution) and configures
 * an autonomous agent capable of multi-step problem solving.
 */

import 'dotenv/config';
import { Agent, type ITool } from './app/agent.js';
import axios from 'axios';
import { exec } from 'child_process';

/**
 * Tool to fetch current weather details for a given city via wttr.in.
 */
const weatherTool: ITool = {
    name: 'fetchWeatherInfo',
    description: 'Fetches real-time weather data for a specified city name',
    doc: 'fetchWeatherInfo(cityName: string): Promise<string>',
    async executor(cityName: string): Promise<string> {
        try {
            const cleanCity = cityName.trim();
            const url = `https://wttr.in/${encodeURIComponent(cleanCity)}?format=%C+%t`;
            const response = await axios.get(url, {
                responseType: 'text',
                timeout: 10000
            });
            return JSON.stringify({
                cityName: cleanCity,
                weatherInfo: String(response.data).trim()
            });
        } catch (error: any) {
            return JSON.stringify({
                cityName,
                error: `Failed to retrieve weather for "${cityName}": ${error?.message || String(error)}`
            });
        }
    }
};

/**
 * Tool to safely execute command-line instructions on the local system.
 */
const cliAccessTool: ITool = {
    name: 'execCli',
    description: "Runs a CLI command on the user's machine and returns stdout or stderr output",
    doc: 'execCli(command: string): Promise<string>',
    executor(command: string): Promise<string> {
        return new Promise((resolve) => {
            exec(command, (err, stdout, stderr) => {
                if (err) {
                    return resolve(`Command execution error: ${err.message}\n${stderr || ''}`);
                }
                const output = stdout.trim() || stderr.trim() || 'Command executed with no output.';
                return resolve(output);
            });
        });
    }
};

/**
 * Main application initializer demonstrating agent instantiation and execution.
 */
async function init(): Promise<void> {
    // 1. Build an expert coding agent equipped with local CLI capabilities
    const codingAgent: Agent = Agent.builder()
        .setInstructions('You are an expert coding agent capable of writing, compiling, and running code.')
        .tool(cliAccessTool)
        .build();

    // 2. Build a weather specialist agent equipped with weather lookup capabilities
    const weatherAgent: Agent = Agent.builder()
        .setInstructions('You are a friendly weather forecasting assistant.')
        .tool(weatherTool)
        .build();

    // 3. Attach interceptor to log agent progression in real-time
    codingAgent.attachInterceptor((message) => {
        console.log(`\n[${message.role.toUpperCase()}]:\n${message.content}`);
    });

    // 4. Run sample query using the coding agent
    console.log('--- Starting Agent Execution ---\n');
    const result = await codingAgent.run(
        'can you build a simple hello world program in c++ on my current project as hello.cpp'
    );

    // 5. Display the final message from the conversation history
    const finalMessage = result[result.length - 1];
    console.log('\n================ Final Agent Output ================');
    console.log(finalMessage?.content ?? 'No output returned.');
}

// Kick off agent demonstration
init().catch((err) => {
    console.error('Fatal initialization error:', err);
});