/**
 * Workflow executor: traverse a node-graph in BFS order and execute
 * each action node sequentially, passing the output of each node as
 * context to the next one.
 *
 * Supported in Phase 1:
 *   - AI Agent Prompt  → runIsolatedAgentJob
 *   - Send Message     → enqueueSystemEvent
 *
 * Unsupported (logged as warning, skipped):
 *   - Execute Tool, Remote Invoke, Speak (TTS)
 *   - Logic nodes: If/Else, Delay, Custom JS
 */

import type { CronServiceState } from "../cron/service/state.js";
import type { CronJob, CronRunOutcome, CronRunTelemetry } from "../cron/types.js";

// ─── Node / Edge types from the frontend's ReactFlow schema ──────────────────

export interface WorkflowNode {
  id: string;
  type?: string;
  data: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// ─── Step execution log ───────────────────────────────────────────────────────

export interface WorkflowStepLog {
  nodeId: string;
  nodeLabel: string;
  status: "ok" | "error" | "skipped";
  outputText?: string;
  error?: string;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export type RunWorkflowChainResult = CronRunOutcome &
  CronRunTelemetry & {
    delivered?: boolean;
    deliveryAttempted?: boolean;
    outputText?: string;
    steps: WorkflowStepLog[];
  };

/**
 * Execute a workflow chain starting from `triggerId`.
 * Traverses edges in BFS order, running each action node and piping
 * its output into the next node's prompt context.
 */
export async function runWorkflowChain(params: {
  graph: WorkflowGraph;
  triggerId: string;
  workflowName: string;
  state: CronServiceState;
  /** A fake CronJob for use with runIsolatedAgentJob (carries schedule/agentId/etc.) */
  cronJob: CronJob;
  abortSignal?: AbortSignal;
}): Promise<RunWorkflowChainResult> {
  const { graph, triggerId, workflowName, state, cronJob, abortSignal } = params;
  const { nodes, edges } = graph;

  const nodeById = new Map<string, WorkflowNode>(nodes.map((n) => [n.id, n]));
  const steps: WorkflowStepLog[] = [];

  // BFS queue: [nodeId, contextText from previous node]
  const queue: Array<{ nodeId: string; context: string }> = [];
  const visited = new Set<string>();

  // Bootstrap: start from the trigger's outgoing edges
  const outgoing = edges.filter((e) => e.source === triggerId);
  for (const edge of outgoing) {
    queue.push({ nodeId: edge.target, context: "" });
  }

  let lastOutputText: string | undefined;

  while (queue.length > 0) {
    const item = queue.shift()!;
    const { nodeId, context } = item;

    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);

    if (abortSignal?.aborted) {
      break;
    }

    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }

    const nodeLabel = typeof node.data?.label === "string" ? node.data.label : "Node";
    const nodeType = node.type ?? "action";

    // Logic nodes are not yet supported — skip silently
    if (nodeType === "logic") {
      state.deps.log.warn(
        { nodeId, nodeLabel },
        "workflow: logic nodes not yet supported, skipping",
      );
      steps.push({ nodeId, nodeLabel, status: "skipped", error: "logic nodes not yet supported" });
      // Keep traversing downstream
      const childEdges = edges.filter((e) => e.source === nodeId);
      for (const edge of childEdges) {
        if (!visited.has(edge.target)) {
          queue.push({ nodeId: edge.target, context });
        }
      }
      continue;
    }

    // ── Action: AI Agent Prompt ───────────────────────────────────────────────
    if (nodeLabel === "AI Agent Prompt") {
      const promptTemplate =
        typeof node.data?.prompt === "string" ? node.data.prompt : "Perform the requested task.";
      const agentId =
        typeof node.data?.agentId === "string" && node.data.agentId.trim()
          ? node.data.agentId.trim()
          : undefined;

      // Compose the full message: inject previous output as context if present
      let message = promptTemplate;
      if (context.trim()) {
        message = `<previous_output>\n${context.trim()}\n</previous_output>\n\n${promptTemplate}`;
      }

      // Build a job clone with this node's agentId override
      const nodeJob: CronJob = {
        ...cronJob,
        agentId: agentId ?? cronJob.agentId,
      };

      try {
        const res = await state.deps.runIsolatedAgentJob({
          job: nodeJob,
          message,
          abortSignal,
        });

        const outputText = res.outputText?.trim() ?? res.summary?.trim() ?? "";
        lastOutputText = outputText;

        steps.push({
          nodeId,
          nodeLabel,
          status: res.status,
          outputText,
          error: res.error,
        });

        if (res.status === "error") {
          // Stop chain on agent error
          return {
            status: "error",
            error: res.error ?? `Agent node "${nodeLabel}" failed`,
            summary: `Workflow "${workflowName}" stopped at node "${nodeLabel}"`,
            steps,
            sessionId: res.sessionId,
            sessionKey: res.sessionKey,
            model: res.model,
            provider: res.provider,
            usage: res.usage,
          };
        }

        // Enqueue children with the agent's output as new context
        const childEdges = edges.filter((e) => e.source === nodeId);
        for (const edge of childEdges) {
          if (!visited.has(edge.target)) {
            queue.push({ nodeId: edge.target, context: outputText });
          }
        }
      } catch (err) {
        const errText = String(err);
        steps.push({ nodeId, nodeLabel, status: "error", error: errText });
        return {
          status: "error",
          error: errText,
          summary: `Workflow "${workflowName}" stopped at node "${nodeLabel}"`,
          steps,
        };
      }
      continue;
    }

    // ── Action: Send Message ──────────────────────────────────────────────────
    if (nodeLabel === "Send Message") {
      const body =
        typeof node.data?.body === "string" && node.data.body.trim()
          ? node.data.body.trim()
          : context.trim() || "Message from workflow";

      state.deps.enqueueSystemEvent(body, {
        agentId: cronJob.agentId,
        contextKey: `workflow:${cronJob.id}`,
      });

      steps.push({ nodeId, nodeLabel, status: "ok", outputText: body });
      lastOutputText = body;

      const childEdges = edges.filter((e) => e.source === nodeId);
      for (const edge of childEdges) {
        if (!visited.has(edge.target)) {
          queue.push({ nodeId: edge.target, context: body });
        }
      }
      continue;
    }

    // ── Unsupported action nodes ──────────────────────────────────────────────
    state.deps.log.warn(
      { nodeId, nodeLabel },
      `workflow: unsupported action node "${nodeLabel}", skipping`,
    );
    steps.push({
      nodeId,
      nodeLabel,
      status: "skipped",
      error: `unsupported node type: "${nodeLabel}"`,
    });

    const childEdges = edges.filter((e) => e.source === nodeId);
    for (const edge of childEdges) {
      if (!visited.has(edge.target)) {
        queue.push({ nodeId: edge.target, context });
      }
    }
  }

  const summary =
    lastOutputText?.slice(0, 500) ?? `Workflow "${workflowName}" completed (${steps.length} steps)`;

  return {
    status: "ok",
    summary,
    outputText: lastOutputText,
    steps,
  };
}
