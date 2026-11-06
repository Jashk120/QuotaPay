// Minimal browser-facing types for snarkjs 0.7.x (the package ships no .d.ts).
declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: unknown,
      wasmUrl: string,
      zkeyUrl: string,
    ): Promise<{
      proof: {
        pi_a: [string, string, ...string[]];
        pi_b: [[string, string], [string, string], ...unknown[]];
        pi_c: [string, string, ...string[]];
      };
      publicSignals: string[];
    }>;
    verify(
      verificationKey: unknown,
      publicSignals: string[],
      proof: unknown,
    ): Promise<boolean>;
  };
}
