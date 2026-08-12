declare module 'pngjs' {
  interface PNGOptions {
    width: number;
    height: number;
  }

  class PNG {
    readonly width: number;
    readonly height: number;
    data: Uint8Array;

    constructor(options: PNGOptions);

    static readonly sync: {
      write(png: PNG): Uint8Array;
    };
  }

  export { PNG };
}
