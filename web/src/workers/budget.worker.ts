import { optimizeBasketWithinBudget } from "../lib/budgetOptimizer.ts";

export type BudgetWorkerPayload = Omit<
  Parameters<typeof optimizeBasketWithinBudget>[0],
  "lockedItemKeys"
> & {
  lockedItemKeys: Set<string> | readonly string[];
};

export interface BudgetWorkerRequest {
  requestId: string;
  payload: BudgetWorkerPayload;
}

export type BudgetWorkerResponse =
  | {
      requestId: string;
      ok: true;
      result: ReturnType<typeof optimizeBasketWithinBudget>;
    }
  | {
      requestId: string;
      ok: false;
      error: string;
    };

export function runBudgetWorkerPayload(payload: BudgetWorkerPayload) {
  const lockedItemKeys =
    payload.lockedItemKeys instanceof Set
      ? payload.lockedItemKeys
      : new Set(payload.lockedItemKeys ?? []);
  return optimizeBasketWithinBudget({
    ...payload,
    lockedItemKeys,
  });
}

if (typeof self !== "undefined") {
  self.onmessage = (event: MessageEvent<BudgetWorkerRequest>) => {
    const data = event.data;
    const requestId = data?.requestId ?? "";
    try {
      if (!data?.payload) {
        throw new Error("Solicitud de presupuesto sin payload");
      }
      const result = runBudgetWorkerPayload(data.payload);
      self.postMessage({ requestId, ok: true, result } satisfies BudgetWorkerResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error optimizando presupuesto";
      self.postMessage({ requestId, ok: false, error: message } satisfies BudgetWorkerResponse);
    }
  };
}
