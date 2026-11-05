import * as path from 'node:path';
import { Language, Parser, type Tree } from 'web-tree-sitter';

export type DocumentLanguage = 'php' | 'twig';

/** Absolute paths of the WASM files needed by the parsers. */
export interface GrammarFiles {
  runtime: string;
  php: string;
  twig: string;
}

/** Layout used by the bundled server: every .wasm file sits next to dist/server.js. */
export function bundledGrammarFiles(dir: string): GrammarFiles {
  return {
    runtime: path.join(dir, 'tree-sitter.wasm'),
    php: path.join(dir, 'tree-sitter-php.wasm'),
    twig: path.join(dir, 'tree-sitter-twig.wasm'),
  };
}

export class Parsers {
  private readonly phpParser: Parser;
  private readonly twigParser: Parser;

  private constructor(
    readonly php: Language,
    readonly twig: Language,
  ) {
    this.phpParser = new Parser();
    this.phpParser.setLanguage(php);
    this.twigParser = new Parser();
    this.twigParser.setLanguage(twig);
  }

  static async load(files: GrammarFiles): Promise<Parsers> {
    await Parser.init({
      locateFile: (file: string) => (file === 'tree-sitter.wasm' ? files.runtime : file),
    });
    const [php, twig] = await Promise.all([Language.load(files.php), Language.load(files.twig)]);
    return new Parsers(php, twig);
  }

  parse(language: DocumentLanguage, text: string): Tree | null {
    return (language === 'php' ? this.phpParser : this.twigParser).parse(text);
  }
}
