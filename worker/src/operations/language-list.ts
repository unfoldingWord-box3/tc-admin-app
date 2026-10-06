// `language.list` (operations.md §4): every language Door43 lists, for the
// wizard's language field to search in the browser (Q20, E25), each marked
// with whether the Scripture Burrito schema accepts its tag (E44), since the
// list carries tags it does not and the wizard must not offer a language the
// plan would refuse (Q30); and, when an owner is named, the tags of the
// languages that owner already has repositories in, so the wizard can show
// those first. One read each, live, with its freshness (P3).

import type { OperationOutput, ParsedInput } from '@tc-admin/shared/schema';
import { readLanguages, readOwnerLanguageCodes } from '../door43/languages';
import { validLanguageTag } from '../model/language';
import type { OperationContext } from './context';
import { signedIn } from './context';

export async function languageList(input: ParsedInput<'language.list'>, context: OperationContext): Promise<OperationOutput<'language.list'>> {
  const client = signedIn(context);
  const owner = input.owner?.trim() || null;
  const [languages, ownerCodes] = await Promise.all([readLanguages(client), owner ? readOwnerLanguageCodes(client, owner) : Promise.resolve(null)]);
  return {
    languages: languages.map(language => ({ ...language, tag_accepted: validLanguageTag(language.code) })),
    owner_languages: ownerCodes,
    freshness: { read_at: context.now().toISOString(), source: 'live', age_seconds: 0 },
  };
}
