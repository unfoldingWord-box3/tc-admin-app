// Git's blob SHA-1 of a file, `sha1("blob <size>\0" + bytes)`, the id Door43
// lists for each file of a tree (E19) and of a commit's answer (E45). The
// retry of a first commit (`project.create.retry`, #31) compares the default
// branch's files to the plan's by these ids, so it can tell a commit Door43
// made from one it did not, without downloading a file (X1).

/** The blob SHA-1 of one file's bytes, as 40 lowercase hex characters. */
export async function gitBlobSha(content: Uint8Array | string): Promise<string> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const object = new Uint8Array(header.length + bytes.length);
  object.set(header);
  object.set(bytes, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', object));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Whether a ref holds exactly these files, path for path and blob for blob, and nothing else. */
export function sameFiles(expected: readonly { path: string; sha: string }[], actual: readonly { path: string; sha: string }[]): boolean {
  if (expected.length !== actual.length) return false;
  const wanted = new Map(expected.map(file => [file.path, file.sha]));
  const paths = new Set(actual.map(file => file.path));
  return wanted.size === expected.length && paths.size === actual.length && actual.every(file => wanted.get(file.path) === file.sha);
}
