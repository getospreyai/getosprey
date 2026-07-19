// Vendored from osprey-engine 2026-07-19. That repo remains the dev harness;
// this copy is canonical for the deployed product. Keep in sync manually.
export * from './types';
export * from './defaults';
export { pmt, remainingBalance, buildLoan } from './loan';
export { underwrite, type UnderwriteInput } from './underwrite';
export { project, irr } from './projection';
export { buildVerdict, type Verdict, type VerdictOptions } from './verdict';
export {
  RentCastClient,
  toPropertyInput,
  toIncomeInput,
  mapPropertyType,
  type RentCastListing,
  type RentCastRentEstimate,
} from './rentcast';
