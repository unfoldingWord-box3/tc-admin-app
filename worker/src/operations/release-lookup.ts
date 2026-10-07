// `release.lookup` (operations.md §4): whether Door43 has a release under a
// tag, and which commit it targets. The step a retry makes after
// `release_outcome_unknown` before anything is written again, so a lost
// answer never becomes a duplicate release (R6, X1). A read: nothing is
// written, and a tag Door43 has no release for is `found: false`, not a
// failure.

import type { OperationOutput, ParsedInput } from '@tc-admin/shared/schema';
import { readReleaseByTag } from '../door43/releases';
import type { OperationContext } from './context';
import { signedIn } from './context';

export async function releaseLookup(input: ParsedInput<'release.lookup'>, context: OperationContext): Promise<OperationOutput<'release.lookup'>> {
  const release = await readReleaseByTag(signedIn(context), input.owner, input.repo, input.tag);
  if (!release) return { found: false, release: null };
  return { found: true, release: { tag: release.tag, url: release.url, prerelease: release.prerelease, target_sha: release.target_sha } };
}
