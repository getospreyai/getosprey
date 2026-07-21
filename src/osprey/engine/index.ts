// Vendored from osprey-engine 2026-07-19. That repo remains the dev harness;
// this copy is canonical for the deployed product. Keep in sync manually.
export * from './types';
export * from './defaults';
export { pmt, remainingBalance, buildLoan } from './loan';
export { underwrite, type UnderwriteInput } from './underwrite';
export { project, irr } from './projection';
export {
  buildVerdict,
  buildPriceCutAlert,
  type Verdict,
  type VerdictOptions,
  type PriceCutAlertInput,
} from './verdict';
export {
  RentCastClient,
  toPropertyInput,
  toIncomeInput,
  mapPropertyType,
  isRepeatPriceCut,
  type RentCastListing,
  type RentCastRentEstimate,
} from './rentcast';
export {
  solveMaxOffer,
  solveClearingRate,
  stressAtRangeLow,
  type SolverInput,
  type MaxOfferResult,
  type StressResult,
} from './solver';
export { section8Standard, SNRHA_MULTIPLIER, type Section8Standard } from './section8';
