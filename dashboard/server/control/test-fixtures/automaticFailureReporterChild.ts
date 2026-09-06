export {};

const [mode, moduleUrl] = process.argv.slice(2);

if (mode === 'unsafe') {
  void Promise.reject(new Error('engine-private-sentinel')).catch(async () => {
    throw new Error('unsafe reporter rejection');
  });
} else if (mode === 'safe') {
  const { superviseDetachedAutomaticExecution, surfaceAutomaticExecutionFailure } = await import(moduleUrl);
  superviseDetachedAutomaticExecution(Promise.reject(new Error('engine-private-sentinel')), {
    surface: 'post-ack-execution', runRef: 'run-child-rejected',
    onRejected: async () => { throw new Error('rejected failure reporter'); },
    log: async () => { throw new Error('rejected async logger'); },
  });
  superviseDetachedAutomaticExecution(Promise.resolve('done'), {
    surface: 'automatic-resume', runRef: 'run-child-fulfilled',
    onFulfilled: async () => { throw new Error('rejected success reporter'); },
    onRejected: async () => undefined,
    log: () => { throw new Error('throwing logger'); },
  });
  surfaceAutomaticExecutionFailure(
    { createHumanRequest: () => { throw new Error('store refused hydrate'); } },
    'operator', 'run-child-surface', new Error('engine-private-sentinel'),
    async () => { throw new Error('rejected surface logger'); },
  );
} else {
  throw new Error('unknown child mode');
}

await new Promise((resolve) => setTimeout(resolve, 30));
process.stdout.write('SURVIVED\n');
