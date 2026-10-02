// `situation.read` (operations.md §4): who is signed in, which host, and how the
// portfolio stands. With a session the account is read from Door43's `/user`
// each time, so a token Door43 no longer accepts ends the session
// (`session_expired`). The portfolio summary arrives with #23; until then it
// is `null`.

import type { OperationOutput, ParsedInput } from '@tc-admin/shared/schema';
import { readAccount } from '../door43/auth';
import type { OperationContext } from './context';

export async function situationRead(_input: ParsedInput<'situation.read'>, context: OperationContext): Promise<OperationOutput<'situation.read'>> {
  const { origin, name, development } = context.host;
  const account = context.door43 ? (await readAccount(context.door43)).account : null;
  return { account, host: { origin, name, development }, portfolio: null, configured: context.configured };
}
