import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvIndex } from '../../src/index/EnvIndex';
import { parseDotenv } from '../../src/project/dotenv';

describe('parseDotenv', () => {
  it('reads names and values, comments, export and quotes', () => {
    const source = [
      '# comment',
      'APP_ENV=dev',
      'APP_SECRET=abc # trailing comment',
      'export MAILER_DSN="smtp://localhost"',
      "QUOTED='a # not a comment'",
      'MULTI="line 1',
      'NOT_A_NAME=inside the value',
      'line 3"',
      '_PRIVATE=1',
      'EMPTY=',
      'not valid',
      '',
    ].join('\r\n');
    expect(parseDotenv(source).map(({ name, value, line }) => [name, value, line])).toEqual([
      ['APP_ENV', 'dev', 1],
      ['APP_SECRET', 'abc', 2],
      ['MAILER_DSN', 'smtp://localhost', 3],
      ['QUOTED', 'a # not a comment', 4],
      ['MULTI', 'line 1\nNOT_A_NAME=inside the value\nline 3', 5],
      ['_PRIVATE', '1', 8],
      ['EMPTY', '', 9],
    ]);
  });

  it('keeps escaped double quotes inside the value', () => {
    expect(parseDotenv('A="say \\"hi\\""\nB=2\n').map((variable) => variable.name)).toEqual(['A', 'B']);
  });
});

describe('EnvIndex', () => {
  let dir: string;
  const write = (name: string, content: string): void => fs.writeFileSync(path.join(dir, name), content);
  const values = (): Record<string, string> => Object.fromEntries(new EnvIndex(dir).all().map((variable) => [variable.name, variable.value]));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-env-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('merges .env, .env.local, .env.<env> and .env.<env>.local in order', () => {
    write('.env', 'A=env\nB=env\nC=env\nD=env\n');
    write('.env.local', 'B=local\n');
    write('.env.dev', 'C=dev\n');
    write('.env.dev.local', 'D=dev.local\n');
    write('.env.prod', 'E=prod\n');
    expect(values()).toEqual({ A: 'env', B: 'local', C: 'dev', D: 'dev.local' });
  });

  it('takes APP_ENV from the files, skips .env.local in test, stops for local', () => {
    write('.env', 'APP_ENV=prod\n');
    write('.env.local', 'L=1\n');
    write('.env.prod', 'P=1\n');
    expect(Object.keys(values()).sort()).toEqual(['APP_ENV', 'L', 'P']);
    write('.env', 'APP_ENV=test\n');
    write('.env.test', 'T=1\n');
    expect(Object.keys(values()).sort()).toEqual(['APP_ENV', 'T']);
    write('.env', 'APP_ENV=dev\n');
    write('.env.local', 'APP_ENV=local\n');
    write('.env.local.local', 'X=1\n');
    expect(Object.keys(values()).sort()).toEqual(['APP_ENV']);
  });

  it('falls back to .env.dist, and knows nothing without files', () => {
    expect(values()).toEqual({});
    write('.env.dist', 'DIST=1\n');
    expect(values()).toEqual({ DIST: '1' });
  });

  it('recognizes the .env files of the project root only', () => {
    expect(EnvIndex.isEnvFile(path.join(dir, '.env.dev.local'), dir)).toBe(true);
    expect(EnvIndex.isEnvFile(path.join(dir, 'config', '.env'), dir)).toBe(false);
    expect(EnvIndex.isEnvFile(path.join(dir, '.environment'), dir)).toBe(false);
  });
});
