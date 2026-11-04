import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SymfonyProject } from '../../src/project/SymfonyProject';
import { isSamePath } from '../../src/util/paths';

const fixtureApp = path.resolve(__dirname, '..', 'fixtures', 'symfony-app');

describe('SymfonyProject.detect', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'symfony-zed-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function touch(...segments: string[]): void {
    const file = path.join(tmp, ...segments);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
  }

  it('detects the fixture project at its root', () => {
    const project = SymfonyProject.detect(fixtureApp);
    expect(project).not.toBeNull();
    expect(isSamePath(project!.root, fixtureApp)).toBe(true);
  });

  it('accepts config/bundles.php when bin/console is missing', () => {
    touch('composer.json');
    touch('config', 'bundles.php');
    expect(SymfonyProject.detect(tmp)?.root).toBe(path.resolve(tmp));
  });

  it('rejects a plain composer project', () => {
    touch('composer.json');
    touch('src', 'Foo.php');
    expect(SymfonyProject.detect(tmp)).toBeNull();
  });

  it('rejects a folder without composer.json', () => {
    touch('bin', 'console');
    expect(SymfonyProject.detect(tmp)).toBeNull();
  });

  it('rejects a missing folder without throwing', () => {
    expect(SymfonyProject.detect(path.join(tmp, 'does-not-exist'))).toBeNull();
  });

  it('detects a single Symfony project in a direct subdirectory', () => {
    touch('docker-compose.yml');
    touch('app', 'composer.json');
    touch('app', 'bin', 'console');
    expect(SymfonyProject.detect(tmp)?.root).toBe(path.join(path.resolve(tmp), 'app'));
  });

  it('returns null when several subdirectories are Symfony projects', () => {
    for (const app of ['api', 'admin']) {
      touch(app, 'composer.json');
      touch(app, 'bin', 'console');
    }
    expect(SymfonyProject.detect(tmp)).toBeNull();
  });

  it('ignores Symfony-looking folders inside vendor/', () => {
    touch('vendor', 'composer.json');
    touch('vendor', 'bin', 'console');
    expect(SymfonyProject.detect(tmp)).toBeNull();
  });
});
