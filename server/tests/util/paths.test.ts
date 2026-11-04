import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSamePath, pathToUri, uriToPath } from '../../src/util/paths';

describe('paths', () => {
  it('round-trips a path through a URI', () => {
    const fsPath = path.resolve('some dir', 'file é.twig');
    expect(isSamePath(uriToPath(pathToUri(fsPath)), fsPath)).toBe(true);
  });

  it('treats equivalent paths as equal', () => {
    expect(isSamePath(path.join('a', 'b', '..', 'c'), path.join('a', 'c'))).toBe(true);
  });

  it.runIf(process.platform === 'win32')('compares case-insensitively on Windows', () => {
    expect(isSamePath('C:\\Projects\\App', 'c:\\projects\\app')).toBe(true);
  });

  it.runIf(process.platform === 'win32')('decodes Zed-style Windows URIs', () => {
    expect(uriToPath('file:///c%3A/Projects/App/templates/base.html.twig')).toBe(
      'c:\\Projects\\App\\templates\\base.html.twig',
    );
  });

  it.skipIf(process.platform === 'win32')('compares case-sensitively elsewhere', () => {
    expect(isSamePath('/projects/App', '/projects/app')).toBe(false);
  });
});
