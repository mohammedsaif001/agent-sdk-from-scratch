/**
 * @file zod-tools-demo.ts
 * @description Demonstration showcasing Zod-powered type-safe tools in the Agent SDK:
 * 1. Defining tools with strict Zod schemas
 * 2. Automatic schema validation
 * 3. Self-healing error reporting on invalid inputs
 */

import { defineTool, z } from '../index.js';

// 1. Define a tool with a strict Zod schema
const calculatorTool = defineTool({
    name: 'calculateTax',
    description: 'Calculates sales tax and total amount for a purchase',
    schema: z.object({
        amount: z.number().positive('Amount must be positive'),
        taxRate: z.number().min(0).max(1, 'Tax rate must be between 0 and 1 (e.g. 0.08 for 8%)'),
        currency: z.enum(['USD', 'EUR', 'GBP', 'INR']).default('USD')
    }),
    executor: ({ amount, taxRate, currency }) => {
        const tax = amount * taxRate;
        const total = amount + tax;
        return {
            amount,
            tax,
            total,
            currency,
            formatted: `${currency} ${total.toFixed(2)}`
        };
    }
});

async function runDemo(): Promise<void> {
    console.log('--- 1. Tool Documentation Generated from Zod Schema ---');
    console.log(`Tool Name: ${calculatorTool.name}`);
    console.log(`Signature: ${calculatorTool.doc}\n`);

    console.log('--- 2. Valid Input Execution ---');
    const validResult = await calculatorTool.executor(
        JSON.stringify({ amount: 250, taxRate: 0.18, currency: 'INR' })
    );
    console.log('Result:', validResult, '\n');

    console.log('--- 3. Invalid Input Handled with Zod Schema Validation ---');
    const invalidResult = await calculatorTool.executor(
        JSON.stringify({ amount: -50, taxRate: 1.5, currency: 'XYZ' })
    );
    console.log('Self-healing error payload returned to Agent loop:');
    console.log(invalidResult);
}

runDemo().catch(console.error);
