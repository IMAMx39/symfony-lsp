import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findServiceReferences, parseServicesYaml } from '../../src/services/yamlServices';
import { fixtureApp } from '../helpers';

const servicesFile = path.join(fixtureApp, 'config', 'services.yaml');
const fixtureSource = fs.readFileSync(servicesFile, 'utf8');

describe('parseServicesYaml', () => {
  const services = parseServicesYaml(fixtureSource, servicesFile, 'dev')!;
  const byId = new Map(services.map((service) => [service.id, service]));

  it('reads explicit service keys, including the when@dev block', () => {
    expect([...byId.keys()]).toEqual([
      'App\\Service\\Mailer',
      'app.mailer',
      'app.newsletter',
      'app.mailer_short',
      'app.child_mailer',
      'app.debug_mailer',
    ]);
  });

  it('derives the class from a namespaced id, else reads `class:`', () => {
    expect(byId.get('App\\Service\\Mailer')?.class).toBe('App\\Service\\Mailer');
    expect(byId.get('app.newsletter')?.class).toBe('App\\Service\\Newsletter');
    expect(byId.get('app.debug_mailer')?.class).toBe('App\\Service\\Mailer');
  });

  it('reads aliases, short syntax included', () => {
    expect(byId.get('app.mailer')).toMatchObject({ class: null, alias: 'App\\Service\\Mailer' });
    expect(byId.get('app.mailer_short')).toMatchObject({ class: null, alias: 'app.mailer' });
  });

  it('leaves the class of a child definition unknown', () => {
    expect(byId.get('app.child_mailer')).toMatchObject({ class: null, alias: null });
  });

  it('locates the declaration on the key', () => {
    const line = fixtureSource.split(/\r?\n/).findIndex((text) => text.startsWith('    app.newsletter:'));
    expect(byId.get('app.newsletter')?.location?.range.start).toEqual({ line, character: 4 });
  });

  it('handles `~`, empty values and ids without namespace', () => {
    const source = 'services:\n    App\\Foo\\Bar: ~\n    App\\Foo\\Baz:\n    plain: ~\n';
    expect(parseServicesYaml(source, servicesFile, 'dev')?.map(({ id, class: className }) => [id, className])).toEqual([
      ['App\\Foo\\Bar', 'App\\Foo\\Bar'],
      ['App\\Foo\\Baz', 'App\\Foo\\Baz'],
      ['plain', null],
    ]);
  });

  it('returns null for invalid YAML', () => {
    expect(parseServicesYaml('services:\n  foo: [\n', servicesFile, 'dev')).toBeNull();
  });
});

describe('findServiceReferences', () => {
  const ids = (source: string): string[] => findServiceReferences(source, 'dev').map((reference) => reference.id);

  it('finds references in arguments, calls, bind, _instanceof and the short alias syntax', () => {
    expect(ids(fixtureSource)).toEqual([
      'logger',
      'app.mailer',
      'mailer.transport',
      'app.mailer',
      'app.optional',
      'logger',
      'unknown.service',
      'app.mailer',
    ]);
  });

  it('gives the offsets of the literal and of the id', () => {
    const source = "services:\n    foo:\n        arguments: ['@?bar']\n";
    const [reference] = findServiceReferences(source, 'dev');
    expect(reference).toBeDefined();
    expect(source.slice(reference!.start, reference!.end)).toBe("'@?bar'");
    expect(source.slice(reference!.idStart, reference!.idEnd)).toBe('bar');
  });

  it('skips escaped @, expressions, tags, parameters and other environments', () => {
    const source = [
      'parameters:',
      "    p: '@foo'",
      'services:',
      '    foo:',
      "        arguments: ['@@foo', '@=service(\"x\")', 'plain', '%param%']",
      '        tags:',
      "            - { name: t, ref: '@foo' }",
      'when@prod:',
      '    services:',
      '        bar:',
      "            arguments: ['@foo']",
    ].join('\n');
    expect(ids(source)).toEqual([]);
  });

  it('skips literals whose source differs from their value', () => {
    expect(ids("services:\n    foo:\n        arguments: ['@it''s', \"@a\\tb\"]\n")).toEqual([]);
  });

  it('accepts an empty id (completion right after @)', () => {
    expect(ids("services:\n    foo:\n        arguments: ['@']\n")).toEqual(['']);
  });

  it('still finds references in a file being edited', () => {
    expect(ids("services:\n    foo:\n        arguments: ['@bar']\n    broken: [\n")).toEqual(['bar']);
  });

  it('handles CRLF line endings', () => {
    const source = "services:\r\n    foo:\r\n        arguments:\r\n            - '@bar'\r\n";
    const [reference] = findServiceReferences(source, 'dev');
    expect(source.slice(reference!.idStart, reference!.idEnd)).toBe('bar');
  });
});
