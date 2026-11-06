import * as path from 'node:path';
import type { TextEdit } from 'vscode-languageserver';
import { beforeAll, describe, expect, it } from 'vitest';
import { DoctrineEntities } from '../../../src/doctrine/DoctrineEntities';
import { provideFormFieldCompletion } from '../../../src/features/doctrine/formFieldCompletion';
import { FormFieldReferenceFinder } from '../../../src/features/doctrine/FormFieldReferenceFinder';
import type { Parsers } from '../../../src/parsing/parsers';
import { pathToUri } from '../../../src/util/paths';
import { fixtureApp, loadParsers, withCursor } from '../../helpers';

const formType = (buildForm: string, configureOptions: string): string => `<?php
namespace App\\Form;

use App\\Entity\\Product;
use App\\Entity as E;

class TestType extends AbstractType
{
    public function buildForm(FormBuilderInterface $builder, array $options): void
    {
        ${buildForm}
    }

    public function configureOptions(OptionsResolver $resolver): void
    {
        ${configureOptions}
    }
}
`;

const PRODUCT_DEFAULTS = `$resolver->setDefaults(['data_class' => Product::class, 'csrf_protection' => true]);`;

describe('form field completion', () => {
  let parsers: Parsers;
  let finder: FormFieldReferenceFinder;
  let doctrine: DoctrineEntities;

  beforeAll(async () => {
    parsers = await loadParsers();
    finder = new FormFieldReferenceFinder(parsers);
    doctrine = new DoctrineEntities(fixtureApp, parsers);
  });

  function complete(source: string) {
    const { document, offset } = withCursor(pathToUri(path.join(fixtureApp, 'src/Form/TestType.php')), 'php', source);
    const tree = parsers.parse('php', document.getText())!;
    const references = finder.find(tree.rootNode);
    tree.delete();
    const items = provideFormFieldCompletion(document, document.positionAt(offset), references, doctrine);
    const apply = (label: string): string => {
      const edit = items?.find((item) => item.label === label)?.textEdit as TextEdit;
      const text = document.getText();
      return text.slice(0, document.offsetAt(edit.range.start)) + edit.newText + text.slice(document.offsetAt(edit.range.end));
    };
    return { items, apply };
  }

  it('proposes the mapped fields of the data_class entity', () => {
    const { items, apply } = complete(formType(`$builder->add('name')->add('pr|', TextType::class);`, PRODUCT_DEFAULTS));
    expect(items?.map((item) => item.label)).toEqual(['id', 'createdAt', 'name', 'price', 'category', 'tags', 'warehouse', 'published']);
    expect(items?.find((item) => item.label === 'category')?.detail).toBe('ManyToOne → App\\Entity\\Category');
    expect(items?.find((item) => item.label === 'name')?.detail).toBe('Column ?string');
    expect(apply('price')).toContain(`->add('price', TextType::class)`);
  });

  it.each([
    ['setDefault()', `$resolver->setDefault('data_class', E\\Category::class);`, ['title', 'products']],
    ['a string data_class', `$resolver->setDefaults(['data_class' => 'App\\Entity\\Category']);`, ['title', 'products']],
  ])('reads the data_class from %s', (_label, options, expected) => {
    expect(complete(formType(`$builder->add("|");`, options)).items?.map((item) => item.label)).toEqual(expected);
  });

  it.each([
    ['no data_class', formType(`$builder->add('|');`, `$resolver->setDefaults(['csrf_protection' => true]);`)],
    ['a dynamic data_class', formType(`$builder->add('|');`, `$resolver->setDefaults(['data_class' => $this->class]);`)],
    ['two data_class values', formType(`$builder->add('|');`, `$resolver->setDefault('data_class', Product::class); $resolver->setDefault('data_class', E\\Category::class);`)],
    ['a non-entity data_class', formType(`$builder->add('|');`, `$resolver->setDefaults(['data_class' => \\App\\Service\\Mailer::class]);`)],
    ['outside buildForm()', formType(`$builder->add('name');`, `${PRODUCT_DEFAULTS} $resolver->add('|');`)],
    ['the second argument', formType(`$builder->add('name', 'pr|');`, PRODUCT_DEFAULTS)],
    ['outside the quotes', formType(`$builder->add(|'name');`, PRODUCT_DEFAULTS)],
    ['another method', formType(`$builder->remove('|');`, PRODUCT_DEFAULTS)],
  ])('proposes nothing for %s', (_label, source) => {
    expect(complete(source).items).toBeNull();
  });
});
