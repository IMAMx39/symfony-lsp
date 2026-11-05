import { describe, expect, it } from 'vitest';
import { addPathPrefix, displayPath, normalizeRoutePath, pathFromTokens, pathVariables } from '../../src/routing/routePath';

describe('routePath', () => {
  it.each([
    ['/blog/{slug}', ['slug']],
    ['/{year<\\d{4}>}/{month?1}', ['year', 'month']],
    ['/post/{slug:post.slug}', ['slug']],
    ['/{!_locale}/{id}/{id}', ['_locale', 'id']],
    ['/feed.{_format}', ['_format']],
    ['/static', []],
  ])('extracts the variables of %s', (path, expected) => {
    expect(pathVariables(path)).toEqual(expected);
  });

  it('strips inline requirements, defaults and mappings for display', () => {
    expect(displayPath('/{year<\\d{4}>}/{month?1}/{slug:post.slug}')).toBe('/{year}/{month}/{slug}');
  });

  it('normalizes and prefixes paths like Symfony', () => {
    expect(normalizeRoutePath('//blog')).toBe('/blog');
    expect(normalizeRoutePath('')).toBe('/');
    expect(addPathPrefix('/admin/', '/export')).toBe('/admin/export');
    expect(addPathPrefix('', '/export')).toBe('/export');
  });

  it('rebuilds paths from reversed compiled tokens', () => {
    expect(pathFromTokens([['variable', '/', '[^/]++', 'token', true], ['text', '/_wdt']])).toBe('/_wdt/{token}');
    expect(pathFromTokens([['text', '/']])).toBe('/');
    expect(pathFromTokens([])).toBe('/');
    expect(pathFromTokens('nope')).toBeNull();
  });
});
