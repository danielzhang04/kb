/** Pure camera math kept outside React so authored intensity can be unit-tested. */
export const pullScale = (
  progress: number,
  pullFrom: number,
  intensity: number,
): number => {
  const start = 1 + (pullFrom - 1) * intensity;
  const fullStrengthEnd = 1 + (pullFrom - 1) * 0.25;
  const end = 1 + (fullStrengthEnd - 1) * intensity;
  return start + (end - start) * progress;
};
