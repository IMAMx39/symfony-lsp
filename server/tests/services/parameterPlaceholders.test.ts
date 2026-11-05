import { describe, expect, it } from 'vitest';
import { findPlaceholders } from '../../src/services/parameterPlaceholders';

describe('findPlaceholders', () => {
  const names = (value: string) => findPlaceholders(value).map(({ name, closed }) => (closed ? name : `${name}…`));

  it('finds every %name% placeholder with its offsets', () => {
    expect(findPlaceholders('%kernel.project_dir%/var/%kernel.environment%')).toEqual([
      { name: 'kernel.project_dir', start: 0, nameStart: 1, nameEnd: 19, closed: true },
      { name: 'kernel.environment', start: 25, nameStart: 26, nameEnd: 44, closed: true },
    ]);
  });

  it('skips escaped percents and names with whitespace', () => {
    expect(names('100%% sure')).toEqual([]);
    expect(names('%%a%%')).toEqual([]);
    expect(names('a % b')).toEqual([]);
    expect(names('%%%app.x%')).toEqual(['app.x']);
  });

  it('reports a trailing placeholder being typed', () => {
    expect(names('%kernel.pro')).toEqual(['kernel.pro…']);
    expect(names('%a%/%')).toEqual(['a', '…']);
  });

  it('keeps env placeholders (filtered by the features)', () => {
    expect(names('%env(APP_SECRET)%')).toEqual(['env(APP_SECRET)']);
  });
});
