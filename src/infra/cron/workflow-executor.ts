import crypto from "node:crypto";
import type { CliDeps } from "../../cli/deps.js";
import { loadConfig } from "../../config/io.js";
import type { OpenClawConfig, SupabaseWorkflowStep } from "../../config/types.js";
import type { CronDelivery } from "../../cron/types.js";
import { buildGatewayConnectionDetails } from "../../gateway/call.js";
import { GatewayClient, type GatewayEventFrame } from "../../gateway/client.js";
import { logInfo, logWarn, logDebug, logError } from "../../logger.js";
import {
  createSupabaseClient,
  supabaseSelect,
  supabaseInsert,
  supabaseUpdate,
  supabaseDelete,
  supabaseRpc,
  type SupabaseResult,
  type SupabaseClient,
} from "../supabase/client.js";

/**
 * Execute a chat.send request and wait for the response.
 * This replaces runCronIsolatedAgentTurn to use the same semantics as UI chat.
 */
async function executeChatSendAndWait(params: {
  sessionKey: string;
  message: string;
  timeoutMs?: number;
}): Promise<{
  outputText: string;
  sessionId: string;
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
}> {
  const { sessionKey, message, timeoutMs = 120000 } = params;

  // Get gateway URL
  const gatewayDetails = buildGatewayConnectionDetails({ config: loadConfig() });
  const gatewayUrl = gatewayDetails.url;
  const token = gatewayDetails.token;

  logDebug(`[workflow-chat] Connecting to gateway: ${gatewayUrl}`);
  logDebug(`[workflow-chat] Session: ${sessionKey}`);
  logDebug(`[workflow-chat] Message: ${message.substring(0, 100)}...`);

  return new Promise((resolve, reject) => {
    const client = new GatewayClient({
      url: gatewayUrl,
      token,
      onHello: () => {
        logDebug(`[workflow-chat] Connected, sending message...`);
      },
      onClose: (info) => {
        logDebug(`[workflow-chat] Connection closed: ${info.code} - ${info.reason}`);
        if (!responseReceived) {
          reject(new Error(`Gateway connection closed: ${info.reason}`));
        }
      },
      onEvent: (evt) => {
        handleEvent(evt);
      },
    });

    let responseReceived = false;
    let accumulatedText = "";
    let sessionId: string | undefined;
    let usage: { input_tokens: number; output_tokens: number; total_tokens: number } | undefined;

    const timeout = setTimeout(() => {
      responseReceived = true;
      client.stop();
      if (accumulatedText) {
        resolve({
          outputText: accumulatedText,
          sessionId: sessionId || "",
          usage,
        });
      } else {
        reject(new Error("Workflow chat.send timeout - no response received"));
      }
    }, timeoutMs);

    function handleEvent(evt: GatewayEventFrame) {
      if (evt.event === "chat") {
        const payload = evt.payload as {
          runId: string;
          sessionKey: string;
          state: "delta" | "final" | "aborted" | "error";
          message?: unknown;
          errorMessage?: string;
          usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
        };

        if (payload.sessionKey !== sessionKey) {
          return; // Ignore messages for other sessions
        }

        sessionId = payload.sessionKey;
        usage = payload.usage;

        if (payload.state === "delta") {
          // Streaming text delta
          const msg = payload.message as Record<string, unknown> | undefined;
          const content = msg?.content;
          let delta = "";
          if (typeof content === "string") {
            delta = content;
          } else if (Array.isArray(content)) {
            delta = (content as Array<{ type: string; text?: string }>)
              .filter((b) => b.type === "text" && typeof b.text === "string")
              .map((b) => b.text)
              .join("");
          } else if (typeof msg?.text === "string") {
            delta = msg.text;
          }
          if (delta) {
            accumulatedText += delta;
            logDebug(`[workflow-chat] Delta: ${delta.substring(0, 50)}...`);
          }
        } else if (payload.state === "final") {
          // Complete message
          responseReceived = true;
          clearTimeout(timeout);

          const msg = payload.message as Record<string, unknown> | undefined;
          if (msg) {
            const content = msg.content;
            if (typeof content === "string") {
              accumulatedText = content;
            } else if (Array.isArray(content)) {
              accumulatedText = (content as Array<{ type: string; text: string }>)
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n");
            } else if (typeof msg.text === "string") {
              accumulatedText = msg.text;
            }
          }

          logInfo(`[workflow-chat] Final response: ${accumulatedText.substring(0, 100)}...`);
          client.stop();

          resolve({
            outputText: accumulatedText,
            sessionId: sessionKey,
            usage,
          });
        } else if (payload.state === "aborted") {
          responseReceived = true;
          clearTimeout(timeout);
          logWarn(`[workflow-chat] Response aborted`);
          client.stop();
          resolve({
            outputText: accumulatedText,
            sessionId: sessionKey,
            usage,
          });
        } else if (payload.state === "error") {
          responseReceived = true;
          clearTimeout(timeout);
          const errorMsg = payload.errorMessage || "Unknown error";
          logWarn(`[workflow-chat] Error: ${errorMsg}`);
          client.stop();
          reject(new Error(`Workflow chat error: ${errorMsg}`));
        }
      }
    }

    // Start connection and send message
    client.start();

    // Wait for connection before sending
    const sendMessage = async () => {
      try {
        // Wait a bit for connection to establish
        await new Promise((res) => setTimeout(res, 1000));

        const runId = crypto.randomUUID();
        await client.request("chat.send", {
          sessionKey,
          message,
          deliver: false,
          idempotencyKey: runId,
        });

        logDebug(`[workflow-chat] Message sent, runId: ${runId}`);
      } catch (err) {
        clearTimeout(timeout);
        client.stop();
        reject(err);
      }
    };

    // Schedule send after a short delay to allow connection to establish
    setTimeout(() => sendMessage(), 500);
  });
}

/**
 * Generate session key for workflow execution.
 * Format: agent:main:workflow:<workflow-name>
 * Replaces spaces with dashes in workflow name.
 */
function generateWorkflowSessionKey(workflowName: string): string {
  const sanitizedName = workflowName.replace(/\s+/g, "-").toLowerCase();
  return `agent:main:workflow:${sanitizedName}`;
}

/**
 * Session configuration for workflow steps.
 * Simple configuration - session key is auto-generated from workflow name.
 */
export interface SessionConfig {
  /**
   * Context mode for prompt building:
   * - 'minimal': Only current step input (90-96% token savings)
   * - 'full': Full workflow context
   * - 'custom': Custom context template
   */
  contextMode: "minimal" | "full" | "custom";
  /** Optional model override for this step */
  model?: string;
  /** Optional max tokens limit */
  maxTokens?: number;
  /** Thinking level: 'on' | 'off' */
  thinking?: "on" | "off";
}

/**
 * Workflow chain step definition.
 * Each step can have its own session configuration for token optimization.
 *
 * trueChain is used for recursive execution - it's ALWAYS executed after the current step.
 */
export interface WorkflowChainStep {
  /** Unique step identifier */
  nodeId: string;
  /** Type of action to execute */
  actionType: string;
  /** Human-readable label */
  label: string;
  /** Optional agent ID to use */
  agentId?: string;
  /** Prompt template or message */
  prompt?: string;
  /** Expected output schema for validation */
  outputSchema?: Record<string, unknown>;
  /** Session configuration for token optimization */
  sessionConfig?: SessionConfig;
  /** Optional delivery config for step output */
  delivery?: CronDelivery;

  // Recursive chain field
  /** Next steps to execute after this step (recursive execution) */
  trueChain?: WorkflowChainStep[];
  /** Deprecated - kept for backward compatibility only */
  falseChain?: WorkflowChainStep[];
  /** Deprecated - not used in recursive model */
  condition?: string;
}

/**
 * Execution context passed through workflow steps.
 */
export interface WorkflowExecutionContext {
  /** Workflow ID */
  workflowId: string;
  /** Timestamp when workflow started */
  timestamp: number;
  /** Current step index */
  currentStepIndex: number;
  /** Results from previous steps */
  stepResults: Record<string, unknown>;
  /** Shared context data */
  sharedData: Record<string, unknown>;
  /** Session tracking */
  sessions: Map<string, string>;
}

/**
 * Token tracking for workflow execution.
 */
export interface TokenTracking {
  /** Total input tokens */
  inputTokens: number;
  /** Total output tokens */
  outputTokens: number;
  /** Total tokens */
  totalTokens: number;
  /** Cache read tokens */
  cacheReadTokens: number;
  /** Cache write tokens */
  cacheWriteTokens: number;
  /** Per-step breakdown */
  stepBreakdown: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }
  >;
}

/**
 * Result of executing a workflow step.
 */
export interface StepExecutionResult {
  /** Step ID */
  nodeId: string;
  /** Success status */
  success: boolean;
  /** Output from step execution */
  output?: unknown;
  /** Error message if failed */
  error?: string;
  /** Session ID used */
  sessionId?: string;
  /** Session key used */
  sessionKey?: string;
  /** Token usage for this step */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** Execution duration in ms */
  durationMs: number;
  /** Additional metadata (for If/Else branching, etc.) */
  metadata?: Record<string, unknown>;
}

/**
 * Result of executing a complete workflow.
 */
export interface WorkflowExecutionResult {
  /** Workflow ID */
  workflowId: string;
  /** Success status */
  success: boolean;
  /** Results from all steps */
  stepResults: StepExecutionResult[];
  /** Final output */
  finalOutput?: unknown;
  /** Total token usage */
  tokenTracking?: TokenTracking;
  /** Error message if failed */
  error?: string;
  /** Total execution duration in ms */
  totalDurationMs: number;
}

/**
 * Workflow Executor with isolated sessions for token optimization.
 *
 * Key features:
 * - Isolated sessions per step (90-96% token savings)
 * - Session reuse within workflow
 * - Minimal context prompts
 * - Token tracking and logging
 */
export class WorkflowExecutor {
  private config: OpenClawConfig;
  private deps: CliDeps;
  private tokenTracking: TokenTracking;
  private activeSessions: Map<string, { sessionId: string; sessionKey: string; createdAt: number }>;

  constructor(config: OpenClawConfig, deps: CliDeps) {
    // Ensure config is a valid object and has agents property to prevent
    // "Cannot read properties of undefined" errors when agent-scope functions
    // access cfg.agents?.list or cfg.agents?.defaults
    const safeConfig = config ?? {};
    const existingAgents = safeConfig.agents;
    this.config = {
      ...safeConfig,
      agents: {
        defaults: existingAgents?.defaults ?? {},
        list: existingAgents?.list ?? [],
      },
    };
    this.deps = deps;
    this.tokenTracking = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      stepBreakdown: {},
    };
    this.activeSessions = new Map();
  }

  /**
   * Execute a complete workflow chain.
   *
   * Handles trueChain recursion - after each step, if trueChain exists,
   * execute it recursively with the step's output as input.
   *
   * Session key format: agent:main:workflow:<workflow-name>
   * (spaces in workflow name are replaced with dashes)
   */
  async executeWorkflow(
    workflowId: string,
    steps: WorkflowChainStep[],
    initialContext?: Partial<WorkflowExecutionContext> & {
      sessionKey?: string;
      workflowName?: string;
    },
  ): Promise<WorkflowExecutionResult> {
    const timestamp = Date.now();
    const startTime = Date.now();

    // Generate workflow session key if not provided
    // Priority: explicit sessionKey > generated from workflowName > undefined
    let effectiveSessionKey = initialContext?.sessionKey;
    if (!effectiveSessionKey && initialContext?.workflowName) {
      effectiveSessionKey = generateWorkflowSessionKey(initialContext.workflowName);
      logInfo(`[workflow:${workflowId}] Generated session key: ${effectiveSessionKey}`);
    }

    const context: WorkflowExecutionContext = {
      workflowId,
      timestamp,
      currentStepIndex: 0,
      stepResults: {},
      sharedData: initialContext?.sharedData ?? {},
      sessions: new Map(),
    };

    // Store base session key from cron job for "main" target steps
    if (effectiveSessionKey) {
      context.sharedData.baseSessionKey = effectiveSessionKey;
    }

    const stepResults: StepExecutionResult[] = [];
    let workflowSuccess = true;
    let workflowError: string | undefined;

    logInfo(`[workflow:${workflowId}] Starting workflow execution with ${steps.length} steps`);

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        context.currentStepIndex = i;

        logDebug(
          `[workflow:${workflowId}] Executing step ${i + 1}/${steps.length}: ${step.nodeId}`,
        );

        const result = await this.executeStep(step, context);
        stepResults.push(result);

        if (!result.success) {
          workflowSuccess = false;
          workflowError = result.error;
          logWarn(`[workflow:${workflowId}] Step ${step.nodeId} failed: ${result.error}`);
          break;
        }

        // Store result in context for next steps
        context.stepResults[step.nodeId] = result.output;

        // ✅ RECURSIVE: Execute trueChain if exists
        if (step.trueChain && step.trueChain.length > 0) {
          logInfo(
            `[workflow:${workflowId}] Executing trueChain for step ${step.nodeId} (${step.trueChain.length} steps)`,
          );

          const trueChainResult = await this.executeWorkflow(
            `${workflowId}:${step.nodeId}:trueChain`,
            step.trueChain,
            {
              sharedData: context.sharedData,
              sessions: context.sessions,
              sessionKey: initialContext?.sessionKey,
              workflowName: initialContext?.workflowName, // Pass workflowName to recursive calls
            },
          );

          if (!trueChainResult.success) {
            workflowSuccess = false;
            workflowError = trueChainResult.error;
            break;
          }

          // Merge trueChain results
          stepResults.push(...trueChainResult.stepResults);

          // Update context with final output from trueChain
          const finalTrueChainOutput =
            trueChainResult.stepResults[trueChainResult.stepResults.length - 1]?.output;
          if (finalTrueChainOutput) {
            context.stepResults[`${step.nodeId}:trueChain`] = finalTrueChainOutput;
          }

          // Merge token tracking
          if (trueChainResult.tokenTracking) {
            this.tokenTracking.inputTokens += trueChainResult.tokenTracking.inputTokens;
            this.tokenTracking.outputTokens += trueChainResult.tokenTracking.outputTokens;
            this.tokenTracking.totalTokens += trueChainResult.tokenTracking.totalTokens;
            this.tokenTracking.cacheReadTokens += trueChainResult.tokenTracking.cacheReadTokens;
            this.tokenTracking.cacheWriteTokens += trueChainResult.tokenTracking.cacheWriteTokens;

            // Merge step breakdown
            Object.assign(
              this.tokenTracking.stepBreakdown,
              trueChainResult.tokenTracking.stepBreakdown,
            );
          }
        }
      }

      // Get final output from last successful step
      const finalOutput =
        stepResults.length > 0 ? stepResults[stepResults.length - 1].output : undefined;

      const totalDurationMs = Date.now() - startTime;

      logInfo(
        `[workflow:${workflowId}] Workflow completed in ${totalDurationMs}ms. ` +
          `Success: ${workflowSuccess}, Steps: ${stepResults.length}, ` +
          `Total tokens: ${this.tokenTracking.totalTokens}`,
      );

      return {
        workflowId,
        success: workflowSuccess,
        stepResults,
        finalOutput,
        tokenTracking: this.tokenTracking,
        error: workflowError,
        totalDurationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logWarn(`[workflow:${workflowId}] Workflow execution failed: ${errorMessage}`);

      return {
        workflowId,
        success: false,
        stepResults,
        tokenTracking: this.tokenTracking,
        error: errorMessage,
        totalDurationMs: Date.now() - startTime,
      };
    } finally {
      // Cleanup active sessions
      await this.cleanupSessions(workflowId);
    }
  }

  /**
   * Execute a single workflow step.
   *
   * After executing the step, if trueChain exists, execute it recursively.
   */
  async executeStep(
    step: WorkflowChainStep,
    context: WorkflowExecutionContext,
  ): Promise<StepExecutionResult> {
    const startTime = Date.now();

    try {
      // Handle Supabase operations
      if (step.actionType.startsWith("supabase-")) {
        return await this.executeSupabaseStep(step, context);
      }

      // Handle agent prompt operations
      const sessionConfig = step.sessionConfig ?? {
        contextMode: "minimal",
        model: undefined,
        thinking: undefined,
      };

      // Determine session (uses baseSessionKey from workflow name)
      const sessionInfo = await this.getOrCreateSession(
        context.workflowId,
        context.timestamp,
        step.nodeId,
        sessionConfig,
        context,
      );

      // Build prompt based on context mode
      const prompt = this.buildPrompt(step, context, sessionConfig);

      if (step?.prompt) {
        logInfo(`[workflow-prompt]: ${prompt}`);
      }

      // Execute the step
      const result = await this.executeAgentPrompt(step, prompt, sessionInfo, context);

      const durationMs = Date.now() - startTime;

      // Track token usage
      if (result.tokenUsage) {
        this.trackTokenUsage(step.nodeId, result.tokenUsage);
      }

      // Deliver step output - default to announce mode if not configured
      // This ensures workflow results are sent to the session chat
      const deliveryConfig = step.delivery ?? { mode: "announce" as const, channel: "last" };
      if (deliveryConfig.mode !== "none") {
        try {
          await this.deliverStepOutput(step, result.output, context);
        } catch (deliveryErr) {
          logWarn(
            `[workflow:${context.workflowId}] Step ${step.nodeId} delivery failed: ${deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr)}`,
          );
          // Don't fail the step due to delivery error
        }
      }

      // ✅ Return basic result - trueChain is handled by executeWorkflow()
      return {
        nodeId: step.nodeId,
        success: true,
        output: result.output,
        sessionId: result.sessionId,
        sessionKey: result.sessionKey,
        tokenUsage: result.tokenUsage,
        durationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startTime;

      logWarn(`[workflow:${context.workflowId}] Step ${step.nodeId} failed: ${errorMessage}`);

      return {
        nodeId: step.nodeId,
        success: false,
        error: errorMessage,
        durationMs,
      };
    }
  }

  /**
   * Extract agent ID from session key (e.g., "agent:main:workflow:xxx" -> "main")
   */
  private extractAgentIdFromSessionKey(sessionKey: string): string | undefined {
    // Format: agent:main:workflow:name or agent:main:session:xxx
    const match = sessionKey.match(/^agent:([^:]+):/);
    return match ? match[1] : undefined;
  }

  /**
   * Execute agent prompt with isolated session.
   */
  async executeAgentPrompt(
    step: WorkflowChainStep,
    prompt: string,
    sessionInfo: { sessionId: string; sessionKey: string },
    context: WorkflowExecutionContext,
  ): Promise<{
    output?: unknown;
    sessionId: string;
    sessionKey: string;
    tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  }> {
    // Use step's agentId, or extract from session key, or default to "main"
    const agentId =
      step.agentId ?? this.extractAgentIdFromSessionKey(sessionInfo.sessionKey) ?? "main";

    logDebug(
      `[workflow:${context.workflowId}] Executing agent prompt for step ${step.nodeId} with agentId: ${agentId}`,
    );

    try {
      // Use chat.send approach instead of isolated agent turn
      // This sends the message to the session and waits for AI response
      const result = await executeChatSendAndWait({
        sessionKey: sessionInfo.sessionKey,
        message: prompt,
      });

      return {
        output: result.outputText,
        sessionId: result.sessionId,
        sessionKey: sessionInfo.sessionKey,
        tokenUsage: result.usage
          ? {
              inputTokens: result.usage.input_tokens ?? 0,
              outputTokens: result.usage.output_tokens ?? 0,
              totalTokens: result.usage.total_tokens ?? 0,
            }
          : undefined,
      };
    } catch (error) {
      logWarn(
        `[workflow:${context.workflowId}] Agent execution failed for step ${step.nodeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Execute a Supabase workflow step.
   */
  private async executeSupabaseStep(
    step: WorkflowChainStep,
    context: WorkflowExecutionContext,
  ): Promise<StepExecutionResult> {
    const startTime = Date.now();
    const stepConfig = step as unknown as SupabaseWorkflowStep;

    try {
      // Get Supabase instance config
      const supabaseConfig = this.config.supabase;
      if (!supabaseConfig) {
        throw new Error("Supabase configuration not found in OpenClaw config");
      }

      const instanceName =
        stepConfig.instance ??
        supabaseConfig.defaultInstance ??
        Object.keys(supabaseConfig.instances)[0];
      const instanceConfig = supabaseConfig.instances[instanceName];

      if (!instanceConfig) {
        throw new Error(`Supabase instance '${instanceName}' not found in configuration`);
      }

      // Create Supabase client
      const client = createSupabaseClient({
        url: instanceConfig.url,
        key: typeof instanceConfig.key === "string" ? instanceConfig.key : instanceConfig.key.id,
        schema: instanceConfig.schema,
      });

      let result: SupabaseResult;

      // Execute based on action type
      switch (step.actionType) {
        case "supabase-select":
          result = await this.executeSupabaseSelect(client, stepConfig);
          break;
        case "supabase-insert":
          result = await this.executeSupabaseInsert(client, stepConfig);
          break;
        case "supabase-update":
          result = await this.executeSupabaseUpdate(client, stepConfig);
          break;
        case "supabase-delete":
          result = await this.executeSupabaseDelete(client, stepConfig);
          break;
        case "supabase-rpc":
          result = await this.executeSupabaseRpc(client, stepConfig);
          break;
        default:
          throw new Error(`Unknown Supabase action type: ${step.actionType}`);
      }

      const durationMs = Date.now() - startTime;

      if (!result.success) {
        logWarn(
          `[workflow:${context.workflowId}] Supabase step ${step.nodeId} failed: ${result.error}`,
        );
        return {
          nodeId: step.nodeId,
          success: false,
          error: result.error ?? "Unknown error",
          durationMs,
        };
      }

      logInfo(
        `[workflow:${context.workflowId}] Supabase step ${step.nodeId} completed successfully`,
      );
      return {
        nodeId: step.nodeId,
        success: true,
        output: result,
        durationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startTime;

      logError(
        `[workflow:${context.workflowId}] Supabase step ${step.nodeId} failed: ${errorMessage}`,
      );
      return {
        nodeId: step.nodeId,
        success: false,
        error: errorMessage,
        durationMs,
      };
    }
  }

  /**
   * Execute Supabase SELECT operation.
   */
  private async executeSupabaseSelect(
    client: SupabaseClient,
    config: SupabaseWorkflowStep,
  ): Promise<SupabaseResult> {
    if (!config.table) {
      throw new Error("Table name is required for SELECT operation");
    }

    return await supabaseSelect(client, {
      table: config.table,
      columns: config.columns,
      filters: config.filters,
      orderBy: config.orderBy,
      limit: config.limit,
    });
  }

  /**
   * Execute Supabase INSERT operation.
   */
  private async executeSupabaseInsert(
    client: SupabaseClient,
    config: SupabaseWorkflowStep,
  ): Promise<SupabaseResult> {
    if (!config.table) {
      throw new Error("Table name is required for INSERT operation");
    }
    if (!config.data) {
      throw new Error("Data is required for INSERT operation");
    }

    return await supabaseInsert(client, {
      table: config.table,
      data: config.data,
    });
  }

  /**
   * Execute Supabase UPDATE operation.
   */
  private async executeSupabaseUpdate(
    client: SupabaseClient,
    config: SupabaseWorkflowStep,
  ): Promise<SupabaseResult> {
    if (!config.table) {
      throw new Error("Table name is required for UPDATE operation");
    }
    if (!config.data) {
      throw new Error("Data is required for UPDATE operation");
    }
    if (!config.filters) {
      throw new Error("Filters are required for UPDATE operation");
    }

    return await supabaseUpdate(client, {
      table: config.table,
      data: config.data,
      filters: config.filters,
    });
  }

  /**
   * Execute Supabase DELETE operation.
   */
  private async executeSupabaseDelete(
    client: SupabaseClient,
    config: SupabaseWorkflowStep,
  ): Promise<SupabaseResult> {
    if (!config.table) {
      throw new Error("Table name is required for DELETE operation");
    }
    if (!config.filters) {
      throw new Error("Filters are required for DELETE operation");
    }

    return await supabaseDelete(client, {
      table: config.table,
      filters: config.filters,
    });
  }

  /**
   * Execute Supabase RPC operation.
   */
  private async executeSupabaseRpc(
    client: SupabaseClient,
    config: SupabaseWorkflowStep,
  ): Promise<SupabaseResult> {
    if (!config.functionName) {
      throw new Error("Function name is required for RPC operation");
    }

    return await supabaseRpc(client, {
      function: config.functionName,
      params: config.args,
    });
  }

  /**
   * Build prompt for a step with template variable replacement.
   * Supports: {{input}}, {{stepX}}, {{stepX.field}}
   */
  buildPrompt(
    step: WorkflowChainStep,
    context: WorkflowExecutionContext,
    sessionConfig: SessionConfig,
  ): string {
    const basePrompt = step.prompt ?? "";
    const stepKeys = Object.keys(context.stepResults);

    // Get previous step output for {{input}}
    const previousOutput =
      context.currentStepIndex > 0 && stepKeys.length > 0
        ? context.stepResults[stepKeys[context.currentStepIndex - 1]]
        : "";

    // Build template context
    const templateContext: Record<string, unknown> = {
      input: previousOutput,
    };

    // Add all step outputs: {{step1}}, {{step2}}, etc.
    stepKeys.forEach((nodeId, index) => {
      templateContext[`step${index + 1}`] = context.stepResults[nodeId];
      // Also add by nodeId: {{agent1}}, {{research}}, etc.
      if (nodeId.match(/^[a-zA-Z][a-zA-Z0-9_-]*$/)) {
        templateContext[nodeId] = context.stepResults[nodeId];
      }
    });

    // Replace template variables in prompt
    let prompt = basePrompt;
    prompt = this.replaceTemplateVariables(prompt, templateContext);

    // Add context based on mode
    if (sessionConfig.contextMode === "minimal") {
      const minimalContext = [
        `Workflow: ${context.workflowId}`,
        `Step: ${step.label} (${step.nodeId})`,
        `Position: ${context.currentStepIndex + 1}`,
        previousOutput
          ? `\n\n--- Previous Step Output ---\n${JSON.stringify(previousOutput, null, 2)}`
          : "",
        `\n\n--- Your Task ---\n${prompt}`,
      ]
        .filter(Boolean)
        .join("\n");

      return minimalContext;
    } else if (sessionConfig.contextMode === "full") {
      const fullContext = [
        `Workflow: ${context.workflowId}`,
        `Step: ${step.label} (${step.nodeId})`,
        `\n\n--- Previous Steps ---`,
        ...stepKeys.map(
          (nodeId, idx) =>
            `**Step ${idx + 1} (${nodeId}):**\n${JSON.stringify(context.stepResults[nodeId], null, 2)}`,
        ),
        `\n\n--- Your Task ---\n${prompt}`,
      ].join("\n");

      return fullContext;
    } else {
      // Custom context mode - return prompt with template variables replaced
      return prompt;
    }
  }

  /**
   * Replace template variables in text.
   * Supports: {{input}}, {{step1}}, {{step1.field}}, {{customId}}
   */
  private replaceTemplateVariables(text: string, context: Record<string, unknown>): string {
    return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const trimmedKey = key.trim();
      const parts = trimmedKey.split(".");
      let value: unknown = context[parts[0]];

      // Handle nested properties: {{step1.field}}
      for (let i = 1; i < parts.length && value !== undefined; i++) {
        if (typeof value === "object" && value !== null) {
          value = (value as Record<string, unknown>)[parts[i]];
        } else {
          value = undefined;
        }
      }

      if (value === undefined) {
        logWarn(`Template variable "${match}" not found in context`);
        return match; // Keep original if not found
      }

      // Convert to string
      return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    });
  }

  /**
   * Get or create session for workflow step.
   *
   * Session key is auto-generated from workflow name:
   * Format: agent:main:workflow:<workflow-name>
   *
   * All steps in the same workflow share the same session key.
   */
  private async getOrCreateSession(
    workflowId: string,
    timestamp: number,
    nodeId: string,
    config: SessionConfig,
    context: WorkflowExecutionContext,
  ): Promise<{ sessionId: string; sessionKey: string }> {
    // Get base session key (generated from workflow name)
    const baseSessionKey = context.sharedData.baseSessionKey as string | undefined;
    const sessionKey = baseSessionKey || `workflow:${workflowId}`;

    // Check if we already have a session for this workflow
    const existingSessionKey = context.sessions.get("workflow");
    if (existingSessionKey) {
      const session = this.activeSessions.get(existingSessionKey);
      if (session) {
        logDebug(`[workflow:${workflowId}] Reusing session: ${existingSessionKey}`);
        return { sessionId: session.sessionId, sessionKey: existingSessionKey };
      }
    }

    // Create new session for this workflow
    const sessionId = crypto.randomUUID();
    this.activeSessions.set(sessionKey, {
      sessionId,
      sessionKey,
      createdAt: Date.now(),
    });
    context.sessions.set("workflow", sessionKey);

    logDebug(`[workflow:${workflowId}] Created session: ${sessionKey}`);
    return { sessionId, sessionKey };
  }

  /**
   * Track token usage for a step.
   */
  private trackTokenUsage(
    nodeId: string,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number },
  ): void {
    this.tokenTracking.inputTokens += usage.inputTokens;
    this.tokenTracking.outputTokens += usage.outputTokens;
    this.tokenTracking.totalTokens += usage.totalTokens;

    this.tokenTracking.stepBreakdown[nodeId] = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    };

    logDebug(
      `[workflow:tokens] Step ${nodeId}: ` +
        `input=${usage.inputTokens}, output=${usage.outputTokens}, total=${usage.totalTokens}`,
    );
  }

  /**
   * Cleanup sessions after workflow completion.
   */
  private async cleanupSessions(workflowId: string): Promise<void> {
    const sessionsToCleanup = Array.from(this.activeSessions.entries()).filter(([key]) =>
      key.startsWith(`workflow:${workflowId}`),
    );

    for (const [sessionKey, _sessionInfo] of sessionsToCleanup) {
      logDebug(`[workflow:${workflowId}] Cleaning up session: ${sessionKey}`);
      this.activeSessions.delete(sessionKey);
    }

    logInfo(`[workflow:${workflowId}] Cleaned up ${sessionsToCleanup.length} sessions`);
  }

  /**
   * Get current token tracking summary.
   */
  getTokenTracking(): TokenTracking {
    return { ...this.tokenTracking };
  }

  /**
   * Reset token tracking.
   */
  resetTokenTracking(): void {
    this.tokenTracking = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      stepBreakdown: {},
    };
  }

  /**
   * Deliver step output to configured channel.
   * Default delivery: announce to session chat (channel: "last")
   */
  private async deliverStepOutput(
    step: WorkflowChainStep,
    output: unknown,
    context: WorkflowExecutionContext,
  ): Promise<void> {
    // Use default delivery if not configured - announce to session chat
    const delivery = step.delivery ?? { mode: "announce" as const, channel: "last" };

    if (!delivery || delivery.mode === "none") {
      return;
    }

    const outputText = typeof output === "string" ? output : JSON.stringify(output);
    if (!outputText || outputText.trim().length === 0) {
      return;
    }

    logDebug(
      `[workflow:${context.workflowId}] Delivering step ${step.nodeId} output to ${delivery.mode}`,
    );

    if (delivery.mode === "announce") {
      // Skip explicit delivery - the agent's response will naturally appear in the session
      // The subagent-announce flow wraps output in "[Internal task completion event]" which isn't ideal
      // For now, let the session naturally show the agent output
      logInfo(
        `[workflow:${context.workflowId}] Step ${step.nodeId} completed - agent output will appear in session naturally`,
      );
    } else if (delivery.mode === "webhook") {
      // Webhook delivery
      if (!delivery.to) {
        logWarn(
          `[workflow:${context.workflowId}] Step ${step.nodeId} webhook delivery missing URL`,
        );
        return;
      }
      try {
        const response = await fetch(delivery.to, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowId: context.workflowId,
            nodeId: step.nodeId,
            label: step.label,
            output: outputText,
            timestamp: Date.now(),
          }),
        });
        if (!response.ok) {
          throw new Error(`Webhook responded with status ${response.status}`);
        }
        logInfo(
          `[workflow:${context.workflowId}] Step ${step.nodeId} output delivered via webhook`,
        );
      } catch (err) {
        logWarn(
          `[workflow:${context.workflowId}] Step ${step.nodeId} webhook delivery failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    }
  }
}
