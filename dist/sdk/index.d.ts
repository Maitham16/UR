/**
 * UR programmatic SDK.
 *
 * A tiny, dependency-free wrapper around UR's headless mode (`ur -p
 * --output-format json`) so other programs can drive the agent without parsing
 * the TUI. It shells out to the installed `ur` binary, so it inherits the same
 * permission model, MCP config, and local Ollama routing as the interactive CLI.
 *
 * This is the subprocess counterpart to the loopback A2A server: A2A is for
 * agent-to-agent task hand-off over HTTP; this SDK is for local programmatic
 * calls that launch an installed `ur` process.
 *
 * @example
 *   import { query } from 'ur-agent/sdk'
 *   const { text } = await query('Summarize the README in one line')
 *   console.log(text)
 */
export type OutputFormat = 'json' | 'text' | 'stream-json';
export type QueryOptions = {
    /** Working directory for the run. Defaults to process.cwd(). */
    cwd?: string;
    /** Force a specific Ollama model (sets UR_MODEL for the child). */
    model?: string;
    /** Cap agentic turns. */
    maxTurns?: number;
    /** Output format passed to `ur -p`. Defaults to 'json'. */
    outputFormat?: OutputFormat;
    /** Pass --dangerously-skip-permissions (sandboxes/CI only). */
    skipPermissions?: boolean;
    /** Kill the run after this many ms. Defaults to 30 minutes. */
    timeoutMs?: number;
    /** Override the binary. Defaults to 'ur' on PATH. */
    bin?: {
        file: string;
        args?: string[];
    };
    /** Extra environment variables for the child process. */
    env?: Record<string, string>;
};
export type QueryResult = {
    ok: boolean;
    /** Best-effort final assistant text. */
    text: string;
    /** Raw stdout from the child. */
    raw: string;
    exitCode: number;
    stderr: string;
};
/**
 * Extract the final text from JSON, text, or stream-json (NDJSON) output.
 *
 * For stream-json, the terminal `result` envelope wins even when lifecycle
 * events follow it. If the input is not structured output, the original
 * trimmed text is returned.
 */
export declare function parseResultText(stdout: string): string;
/** Run a single headless UR query and resolve with its result. */
export declare function query(prompt: string, options?: QueryOptions): Promise<QueryResult>;
/** Run a query expecting JSON content and parse it (returns null on failure). */
export declare function queryJSON<T = unknown>(prompt: string, options?: QueryOptions): Promise<T | null>;
/** A reusable client that applies shared defaults to every query. */
export declare class UrClient {
    private readonly defaults;
    constructor(defaults?: QueryOptions);
    query(prompt: string, options?: QueryOptions): Promise<QueryResult>;
    queryJSON<T = unknown>(prompt: string, options?: QueryOptions): Promise<T | null>;
    private mergeOptions;
}
