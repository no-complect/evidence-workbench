import type { Run, RunSummary } from "../../../packages/contracts/models";
import type { workbenchApi } from "../src/lib/workbench-api";

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

export type SubmissionUsesItsActualResponse = Expect<
  Equal<Awaited<ReturnType<typeof workbenchApi.start>>, RunSummary>
>;
export type SubmissionCannotBeUsedAsRunDetail = Expect<
  RunSummary extends Run ? false : true
>;
