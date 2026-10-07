# Door43 fixtures, qa.door43.org, 7 October 2026

Recorded read-only from public endpoints with no credentials (ADR 0012). DCS `1.27.3+dcs.13-g23ba3c3ef9`.

| File | Request |
| --- | --- |
| `sb-archives/birch__es-419_tit_text_reg__master.zip`, `birch__en_web_mrk_book__master.zip` | `GET /api/v1/repos/{owner}/{repo}/sb/master.zip` (E34): the translationStudio and translationCore archives of E1, with the file list (`unzip -Z1`) and `metadata.json` extracted beside each (E53) |

The facts derived are E53 in `docs/evidence.md`.
