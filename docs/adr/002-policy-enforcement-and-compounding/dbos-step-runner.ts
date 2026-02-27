// Two-layer durability: SQL unique-idempotency + DBOS-runtime trace
export interface StepRunner {
  runStep<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

// 1. InlineStepRunner: Used for simple unit tests/local dev without DBOS
export class InlineStepRunner implements StepRunner {
  async runStep<T>(_name: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

// 2. DbosStepRunner: Production/Integration gate for crash-resilient workflows
export class DbosStepRunner implements StepRunner {
  async runStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const workflowID = `forkloom-step-${token}`;
    // register callback, start workflow, await handle.getResult()
    // ensures exactly-once or resume-on-failure behavior
  }
}
