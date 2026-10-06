// The language tag rule every project tC Admin writes must meet: `languageTag`
// in the Scripture Burrito schema's `common.schema.json` (E44), the BCP 47
// grammar, so a tag that passes here validates in `metadata.json` (W1). Pure:
// `project.create.plan` refuses a tag that fails it, and `language.list` marks
// which of Door43's tags it refuses, since Door43's list carries tags the
// schema does not accept (private-use subtags over eight characters, among
// others; E25, Q30). The `E44:` test in `worker/test/model/language.test.ts`
// holds this pattern to the recorded schema's.

export const LANGUAGE_TAG =
  /^(((en-GB-oed|i-ami|i-bnn|i-default|i-enochian|i-hak|i-klingon|i-lux|i-mingo|i-navajo|i-pwn|i-tao|i-tay|i-tsu|sgn-BE-FR|sgn-BE-NL|sgn-CH-DE)|(art-lojban|cel-gaulish|no-bok|no-nyn|zh-guoyu|zh-hakka|zh-min|zh-min-nan|zh-xiang))|((([A-Za-z]{2,3}(-([A-Za-z]{3}(-[A-Za-z]{3}){0,2}))?)|[A-Za-z]{4}|[A-Za-z]{5,8})(-([A-Za-z]{4}))?(-([A-Za-z]{2}|[0-9]{3}))?(-([A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*(-([0-9A-WY-Za-wy-z](-[A-Za-z0-9]{2,8})+))*(-(x(-[A-Za-z0-9]{1,8})+))?)|(x(-[A-Za-z0-9]{1,8})+))$/u;

/** Whether the Scripture Burrito schema accepts `tag` as a language tag. */
export function validLanguageTag(tag: string): boolean {
  return LANGUAGE_TAG.test(tag);
}
