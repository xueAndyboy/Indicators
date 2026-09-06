#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = process.env.INDICATORS_DIR || path.resolve(__dirname, "..");

const server = new Server(
  {
    name: "tradingview-indicator-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Error handling for server
process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.close();
  process.exit(0);
});

// Define schemas for tool arguments
const AnalyzeIndicatorSchema = z.object({
  indicatorName: z.string().describe("Name of the indicator file to analyze"),
});

const ListIndicatorsSchema = z.object({
  pattern: z.string().optional().describe("Optional pattern to filter indicators"),
});

const SearchIndicatorSchema = z.object({
  searchTerm: z.string().describe("Term to search for in indicator files"),
  caseInsensitive: z.boolean().default(true).describe("Whether search should be case insensitive"),
});

const ExtractFunctionsSchema = z.object({
  indicatorName: z.string().describe("Name of the indicator file to extract functions from"),
});

const GetIndicatorContentSchema = z.object({
  indicatorName: z.string().describe("Name of the indicator file to read"),
  startLine: z.number().optional().describe("Optional starting line number (1-indexed)"),
  endLine: z.number().optional().describe("Optional ending line number (1-indexed)"),
});

// Helper functions
function getIndicatorFiles(pattern?: string): string[] {
  try {
    const files = readdirSync(REPO_ROOT);
    return files.filter(file => {
      // Filter out non-indicator files
      if (file.startsWith('.') || file.includes('node_modules') || file.includes('package') ||
          file.includes('tsconfig') || file.includes('Dockerfile') || file.endsWith('.js') ||
          file.endsWith('.ts') || file.endsWith('.json') || file.endsWith('.md') ||
          file.endsWith('.yml') || file.endsWith('.yaml') || file.endsWith('.rar')) {
        return false;
      }

      if (pattern) {
        return file.toLowerCase().includes(pattern.toLowerCase());
      }

      return true;
    });
  } catch (error) {
    throw new Error(`Failed to read directory (${REPO_ROOT}): ${error}`);
  }
}

function resolveIndicatorPath(filename: string): string {
  let targetPath = path.isAbsolute(filename) ? filename : path.join(REPO_ROOT, filename);
  if (!existsSync(targetPath) && !filename.endsWith('.pine')) {
    const withPine = path.isAbsolute(filename) ? `${filename}.pine` : path.join(REPO_ROOT, `${filename}.pine`);
    if (existsSync(withPine)) {
      return withPine;
    }
  }
  return targetPath;
}

function readIndicatorFile(filename: string): string {
  const targetPath = resolveIndicatorPath(filename);
  try {
    return readFileSync(targetPath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read indicator file "${filename}" at "${targetPath}": ${error}`);
  }
}

function analyzeIndicatorCode(content: string): {
  functions: string[];
  variables: string[];
  plots: string[];
  inputs: string[];
  alerts: string[];
  complexity: 'Low' | 'Medium' | 'High';
  lineCount: number;
} {
  const lines = content.split('\n');
  const functions = [];
  const variables = [];
  const plots = [];
  const inputs = [];
  const alerts = [];

  // Extract different components
  for (const line of lines) {
    const trimmed = line.trim();

    // Functions
    if (trimmed.match(/^[a-zA-Z_][a-zA-Z0-9_]*\s*\(/)) {
      functions.push(trimmed.split('(')[0]);
    }

    // Variables
    if (trimmed.match(/^(var\s+)?[a-zA-Z_][a-zA-Z0-9_]*\s*=/)) {
      const varName = trimmed.replace(/^var\s+/, '').split('=')[0].trim();
      variables.push(varName);
    }

    // Plots
    if (trimmed.includes('plot(') || trimmed.includes('plotshape(') || trimmed.includes('plotchar(')) {
      plots.push(trimmed);
    }

    // Inputs
    if (trimmed.includes('input(') || trimmed.includes('input.')) {
      inputs.push(trimmed);
    }

    // Alerts
    if (trimmed.includes('alert(') || trimmed.includes('alertcondition(')) {
      alerts.push(trimmed);
    }
  }

  // Determine complexity
  let complexity: 'Low' | 'Medium' | 'High' = 'Low';
  if (lines.length > 100 || functions.length > 10) {
    complexity = 'Medium';
  }
  if (lines.length > 300 || functions.length > 20 || plots.length > 5) {
    complexity = 'High';
  }

  return {
    functions: functions.slice(0, 10), // Limit output
    variables: variables.slice(0, 15),
    plots: plots.slice(0, 10),
    inputs: inputs.slice(0, 10),
    alerts: alerts.slice(0, 5),
    complexity,
    lineCount: lines.length
  };
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_indicators",
        description: "List all available TradingView indicator files in the current directory",
        inputSchema: ListIndicatorsSchema,
      },
      {
        name: "analyze_indicator",
        description: "Analyze a TradingView indicator file and extract key components",
        inputSchema: AnalyzeIndicatorSchema,
      },
      {
        name: "search_indicators",
        description: "Search for specific terms across all indicator files",
        inputSchema: SearchIndicatorSchema,
      },
      {
        name: "extract_functions",
        description: "Extract and list all functions from an indicator file",
        inputSchema: ExtractFunctionsSchema,
      },
      {
        name: "get_indicator_content",
        description: "Read the source code of a TradingView Pine Script indicator file",
        inputSchema: GetIndicatorContentSchema,
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_indicators": {
        const { pattern } = ListIndicatorsSchema.parse(args);
        const indicators = getIndicatorFiles(pattern);

        return {
          content: [
            {
              type: "text",
              text: `Found ${indicators.length} indicator files:\n\n${indicators.map((file, i) => `${i + 1}. ${file}`).join('\n')}`,
            },
          ],
        };
      }

      case "analyze_indicator": {
        const { indicatorName } = AnalyzeIndicatorSchema.parse(args);
        const content = readIndicatorFile(indicatorName);
        const analysis = analyzeIndicatorCode(content);

        const result = `# Analysis of ${indicatorName}

## Overview
- **Lines of Code**: ${analysis.lineCount}
- **Complexity**: ${analysis.complexity}

## Components Found
- **Functions**: ${analysis.functions.length} found
- **Variables**: ${analysis.variables.length} found
- **Plots**: ${analysis.plots.length} found
- **Inputs**: ${analysis.inputs.length} found
- **Alerts**: ${analysis.alerts.length} found

## Key Functions
${analysis.functions.length > 0 ? analysis.functions.map(f => `- ${f}`).join('\n') : 'None found'}

## Plot Commands
${analysis.plots.length > 0 ? analysis.plots.map(p => `- ${p.substring(0, 100)}...`).join('\n') : 'None found'}

## Input Parameters
${analysis.inputs.length > 0 ? analysis.inputs.map(i => `- ${i.substring(0, 80)}...`).join('\n') : 'None found'}
`;

        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
        };
      }

      case "search_indicators": {
        const { searchTerm, caseInsensitive } = SearchIndicatorSchema.parse(args);
        const indicators = getIndicatorFiles();
        const results = [];

        for (const indicator of indicators) {
          try {
            const content = readIndicatorFile(indicator);
            const searchContent = caseInsensitive ? content.toLowerCase() : content;
            const term = caseInsensitive ? searchTerm.toLowerCase() : searchTerm;

            if (searchContent.includes(term)) {
              // Find line numbers where term appears
              const lines = content.split('\n');
              const matches = lines
                .map((line, index) => ({ line: line.trim(), number: index + 1 }))
                .filter(({line}) => {
                  const searchLine = caseInsensitive ? line.toLowerCase() : line;
                  return searchLine.includes(term);
                })
                .slice(0, 3); // Limit to first 3 matches per file

              results.push({
                file: indicator,
                matches
              });
            }
          } catch (error) {
            // Skip files that can't be read
            continue;
          }
        }

        const resultText = results.length > 0
          ? `Found "${searchTerm}" in ${results.length} files:\n\n${results.map(r =>
              `**${r.file}**:\n${r.matches.map(m => `  Line ${m.number}: ${m.line}`).join('\n')}`
            ).join('\n\n')}`
          : `No matches found for "${searchTerm}"`;

        return {
          content: [
            {
              type: "text",
              text: resultText,
            },
          ],
        };
      }

      case "extract_functions": {
        const { indicatorName } = ExtractFunctionsSchema.parse(args);
        const content = readIndicatorFile(indicatorName);
        const lines = content.split('\n');
        const functions = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const funcMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*=>/) ||
                            line.match(/^method\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*=>/);

          if (funcMatch) {
            const funcName = funcMatch[1];
            const functionStart = i;
            let functionEnd = i;

            // Pine script function bodies are indented
            for (let j = i + 1; j < lines.length; j++) {
              const nextLine = lines[j];
              if (nextLine.trim() === '') {
                continue;
              }
              // Indented with at least 2 spaces or tab
              if (nextLine.startsWith('  ') || nextLine.startsWith('\t')) {
                functionEnd = j;
              } else {
                break;
              }
            }

            const functionCode = lines.slice(functionStart, functionEnd + 1).join('\n');
            functions.push({
              name: funcName,
              startLine: functionStart + 1,
              endLine: functionEnd + 1,
              code: functionCode,
            });
          }
        }

        const result = `# Functions extracted from ${indicatorName}

Found ${functions.length} functions:

${functions.length > 0 ? functions.map(f => `## ${f.name}
**Lines**: ${f.startLine}-${f.endLine}

\`\`\`pinescript
${f.code}
\`\`\`

---`).join('\n\n') : '_No explicit custom function definitions found._'}`;

        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
        };
      }

      case "get_indicator_content": {
        const { indicatorName, startLine, endLine } = GetIndicatorContentSchema.parse(args);
        const content = readIndicatorFile(indicatorName);
        const lines = content.split('\n');

        const start = startLine ? Math.max(1, startLine) : 1;
        const end = endLine ? Math.min(lines.length, endLine) : lines.length;

        const slice = lines.slice(start - 1, end).join('\n');

        return {
          content: [
            {
              type: "text",
              text: `# Indicator: ${indicatorName} (Lines ${start}-${end} of ${lines.length})\n\n\`\`\`pinescript\n${slice}\n\`\`\``,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`TradingView Indicator MCP Server running on stdio (Serving ${REPO_ROOT})`);
}

main().catch(err => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});