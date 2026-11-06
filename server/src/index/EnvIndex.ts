import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseDotenv } from '../project/dotenv';
import { isSamePath } from '../util/paths';

/** Environment used when APP_ENV is not defined in the .env files (Dotenv::loadEnv() default). */
const DEFAULT_ENV = 'dev';
/** Environments for which .env.local is skipped (Dotenv::loadEnv() $testEnvs). */
const TEST_ENVS = ['test'];

/** An environment variable known from the .env files. */
export interface EnvVariable {
  name: string;
  /** Value of the last file defining it. */
  value: string;
  file: string;
}

/**
 * Variables of the .env files of a project, in the order Dotenv::loadEnv() reads them:
 * `.env` (or `.env.dist`), `.env.local` (not for `test`), `.env.<APP_ENV>`, `.env.<APP_ENV>.local`,
 * where APP_ENV comes from the files read so far (default `dev`); nothing more for APP_ENV=local.
 * `.env.local.php` (compiled, PHP) and the real environment (Docker) are not read.
 */
export class EnvIndex {
  private variables = new Map<string, EnvVariable>();

  constructor(private readonly projectRoot: string) {
    this.reload();
  }

  all(): EnvVariable[] {
    return [...this.variables.values()];
  }

  /** True when a changed file may be one of the .env files. */
  static isEnvFile(file: string, projectRoot: string): boolean {
    return isSamePath(path.dirname(file), projectRoot) && /^\.env(\..+)?$/.test(path.basename(file));
  }

  reload(): void {
    const variables = new Map<string, EnvVariable>();
    const load = (name: string): boolean => {
      const file = path.join(this.projectRoot, name);
      const source = readText(file);
      if (source === null) {
        return false;
      }
      for (const variable of parseDotenv(source)) {
        variables.set(variable.name, { name: variable.name, value: variable.value, file });
      }
      return true;
    };
    if (!load('.env')) {
      load('.env.dist');
    }
    let env = variables.get('APP_ENV')?.value || DEFAULT_ENV;
    if (!TEST_ENVS.includes(env) && load('.env.local')) {
      env = variables.get('APP_ENV')?.value || env;
    }
    if (env !== 'local') {
      load(`.env.${env}`);
      load(`.env.${env}.local`);
    }
    this.variables = variables;
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
