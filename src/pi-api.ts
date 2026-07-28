export type NotificationLevel = "info" | "warning" | "error";

export interface ScopedCommandContext {
  cwd: string;
  reload(): Promise<void>;
  ui: {
    notify(message: string, level?: NotificationLevel): void;
  };
}

export interface ScopedPiApi {
  registerCommand(
    name: string,
    options: {
      description?: string;
      getArgumentCompletions?: (
        argumentPrefix: string,
      ) =>
        | Array<{ value: string; label: string; description?: string }>
        | null
        | Promise<
            Array<{ value: string; label: string; description?: string }> | null
          >;
      handler: (
        args: string,
        ctx: ScopedCommandContext,
      ) => Promise<void>;
    },
  ): void;
}
