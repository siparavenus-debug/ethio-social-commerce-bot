export function createSessionGuard() {
  let generation = 0;
  let activeToken: string | null = null;

  return {
    activate(token: string): void {
      generation += 1;
      activeToken = token;
    },

    capture(): number {
      return generation;
    },

    isCurrent(capturedGeneration: number): boolean {
      return (
        activeToken !== null &&
        capturedGeneration === generation
      );
    },

    invalidate(): void {
      generation += 1;
      activeToken = null;
    }
  };
}
