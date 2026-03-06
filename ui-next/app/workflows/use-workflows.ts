import { Node, Edge } from "@xyflow/react";
import { useState, useEffect } from "react";
import { useGateway } from "@/lib/use-gateway";

export interface WorkflowItem {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  updatedAt: string;
  cronJobIds?: string[];
}

export function useWorkflows() {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { request, state } = useGateway();

  useEffect(() => {
    if (state !== "connected") {
      return;
    }

    let active = true;
    void Promise.resolve().then(() => {
      void (active && setLoading(true));
    });
    request<{ workflows: WorkflowItem[] }>("workflows.get", {})
      .then((res) => {
        if (active) {
          setWorkflows(res.workflows || []);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.error("Failed to load workflows", e);
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [request, state]);

  const saveWorkflow = async (id: string, name: string, nodes: Node[], edges: Edge[]) => {
    // 1. Delete existing cron jobs for this workflow
    const existingWorkflow = workflows.find((w) => w.id === id);
    if (existingWorkflow?.cronJobIds) {
      for (const cronId of existingWorkflow.cronJobIds) {
        try {
          await request("cron.remove", { jobId: cronId });
        } catch (e) {
          console.error("Failed to remove old cron job", e);
        }
      }
    }

    const newCronJobIds: string[] = [];

    // 2. Create ONE cron job per Cron trigger.
    //    The backend executor will traverse the full workflow graph at runtime.
    const triggers = nodes.filter(
      (n) => n.type === "trigger" && n.data?.label === "Schedule (Cron)",
    );
    for (const trigger of triggers) {
      const cronExpr = (trigger.data.cronExpr as string) || "* * * * *";

      const jobCreate = {
        name: `Workflow: ${name}`,
        description: `Generated from Workflow Editor (trigger: ${trigger.id})`,
        enabled: true,
        schedule: { kind: "cron" as const, expr: cronExpr },
        sessionTarget: "isolated" as const,
        wakeMode: "now" as const,
        payload: {
          kind: "workflowRun" as const,
          workflowId: id,
          triggerId: trigger.id,
        },
      };

      try {
        const res = await request<{ id: string }>("cron.add", jobCreate);
        newCronJobIds.push(res.id);
      } catch (e) {
        console.error("Failed to add workflow cron job", e);
      }
    }

    setWorkflows((prev) => {
      const existing = prev.find((w) => w.id === id);
      const updatedList = existing
        ? prev.map((w) =>
            w.id === id
              ? {
                  ...w,
                  name,
                  nodes,
                  edges,
                  updatedAt: new Date().toISOString(),
                  cronJobIds: newCronJobIds,
                }
              : w,
          )
        : [
            ...prev,
            {
              id,
              name,
              nodes,
              edges,
              updatedAt: new Date().toISOString(),
              cronJobIds: newCronJobIds,
            },
          ];

      request("workflows.save", { workflows: updatedList }).catch((e) =>
        console.error("Failed to save workflows", e),
      );
      return updatedList;
    });
  };

  const deleteWorkflow = async (id: string) => {
    const existingWorkflow = workflows.find((w) => w.id === id);
    if (existingWorkflow?.cronJobIds) {
      for (const cronId of existingWorkflow.cronJobIds) {
        try {
          await request("cron.remove", { jobId: cronId });
        } catch (e) {
          console.error("Failed to remove cron job on workflow delete", e);
        }
      }
    }

    setWorkflows((prev) => {
      const updatedList = prev.filter((w) => w.id !== id);
      request("workflows.save", { workflows: updatedList }).catch((e) =>
        console.error("Failed to save workflows", e),
      );
      return updatedList;
    });
    if (currentId === id) {
      setCurrentId(null);
    }
  };

  return { workflows, currentId, setCurrentId, saveWorkflow, deleteWorkflow, loading };
}
