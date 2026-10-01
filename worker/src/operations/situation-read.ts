// `situation.read` (operations.md §4): who is signed in, which host, and how the
// portfolio stands. Sessions arrive with #12; until then there is no account
// and no portfolio, and the call reports the host and whether sign-in is
// configured.

import type { OperationOutput, ParsedInput } from '@tc-admin/shared/schema';
import type { OperationContext } from './context';

export async function situationRead(_input: ParsedInput<'situation.read'>, context: OperationContext): Promise<OperationOutput<'situation.read'>> {
  const { origin, name, development } = context.host;
  return { account: null, host: { origin, name, development }, portfolio: null, configured: context.configured };
}
