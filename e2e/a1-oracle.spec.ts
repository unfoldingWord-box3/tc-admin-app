// The A1 classifier, offline (#10, bench round 3 on #144): no QA, no credentials, no browser. A token in the callback's
// fragment is caught; the callback's own code and state pass; code and state anywhere else are read like any parameter.

import { expect, test } from '@playwright/test';
import { isCallbackUrl, looksLikeToken, urlCarriesToken } from './a1-oracle';

const HEX = 'a'.repeat(40);
const APP = 'https://app.example';

test('A1: a token in the callback document\'s fragment is caught, an implicit or hybrid grant\'s access_token or id_token', () => {
  expect(urlCarriesToken(`${APP}/auth/callback#access_token=eyJaaa.bbb.ccc`, true)).toBe(true);
  expect(urlCarriesToken(`${APP}/auth/callback?code=${HEX}&state=${HEX}#id_token=eyJaaa.bbb.ccc`, true)).toBe(true);
});

test('A1: the callback\'s own one-time code and state pass there, and only there', () => {
  expect(urlCarriesToken(`${APP}/auth/callback?code=${HEX}&state=${HEX}`, true)).toBe(false);
  expect(urlCarriesToken(`${APP}/api?code=${HEX}`, false)).toBe(true);
  expect(urlCarriesToken(`${APP}/api?state=eyJaaa.bbb.ccc`, false)).toBe(true);
});

test('A1: a commit SHA in a path is no token; one in a parameter is', () => {
  expect(urlCarriesToken(`${APP}/api/projects/o/r/commits/${HEX}`, false)).toBe(false);
  expect(urlCarriesToken(`${APP}/api/x?sha=${HEX}`, false)).toBe(true);
});

test('A1: the callback is told by the app\'s origin and path only', () => {
  expect(isCallbackUrl(`${APP}/auth/callback?code=x`, APP)).toBe(true);
  expect(isCallbackUrl('https://qa.door43.org/auth/callback', APP)).toBe(false);
  expect(isCallbackUrl(`${APP}/auth/callbacks`, APP)).toBe(false);
  expect(looksLikeToken('tca_session=' + 'A'.repeat(43))).toBe(false);
});
