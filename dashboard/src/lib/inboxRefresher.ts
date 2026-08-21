export interface InboxRefresher {
  trigger(): void;
  dispose(): void;
}

export interface InboxRefresherOptions<T> {
  load(): Promise<T>;
  onSuccess(value: T): void;
  onFailure(cause: unknown): void;
  onSettled?(): void;
}

/** One request in flight and, regardless of burst size, at most one trailing refresh. */
export function createInboxRefresher<T>(options: InboxRefresherOptions<T>): InboxRefresher {
  let active = true;
  let inFlight = false;
  let trailing = false;

  const trigger = (): void => {
    if (!active) return;
    if (inFlight) {
      trailing = true;
      return;
    }
    inFlight = true;
    void options.load()
      .then((value) => { if (active) options.onSuccess(value); })
      .catch((cause: unknown) => { if (active) options.onFailure(cause); })
      .finally(() => {
        inFlight = false;
        if (!active) return;
        options.onSettled?.();
        if (trailing) {
          trailing = false;
          trigger();
        }
      });
  };

  return {
    trigger,
    dispose(): void {
      active = false;
      trailing = false;
    },
  };
}
