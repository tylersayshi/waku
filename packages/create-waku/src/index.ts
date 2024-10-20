import { existsSync, readdirSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { prompt } from 'enquirer';
import { red, green, bold } from 'kolorist';
import fse from 'fs-extra/esm';
import checkForUpdate from 'update-check';
import {
  getTemplateNames,
  installTemplate,
} from './helpers/install-template.js';
import {
  parseExampleOption,
  downloadAndExtract,
} from './helpers/example-option.js';
import { spawn } from 'node:child_process';

const userAgent = process.env.npm_config_user_agent || '';
const packageManager = /pnpm/.test(userAgent)
  ? 'pnpm'
  : /yarn/.test(userAgent)
    ? 'yarn'
    : 'npm';
const commands = {
  pnpm: {
    install: 'pnpm install',
    dev: 'pnpm dev',
    create: 'pnpm create waku',
  },
  yarn: {
    install: 'yarn',
    dev: 'yarn dev',
    create: 'yarn create waku',
  },
  npm: {
    install: 'npm install',
    dev: 'npm run dev',
    create: 'npm create waku',
  },
}[packageManager];

const templateRoot = path.join(
  fileURLToPath(import.meta.url),
  '../../template',
);

// FIXME is there a better way with prompts?
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    choose: {
      type: 'boolean',
    },
    example: {
      type: 'string',
    },
    help: {
      type: 'boolean',
      short: 'h',
    },
  },
});

async function doPrompts() {
  const isValidPackageName = (projectName: string) =>
    /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(
      projectName,
    );

  const toValidPackageName = (projectName: string) =>
    projectName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/^[._]/, '')
      .replace(/[^a-z0-9-~]+/g, '-');

  // if the dir is empty or not exist
  const canSafelyOverwrite = (dir: string) =>
    !existsSync(dir) || readdirSync(dir).length === 0;

  const templateNames = await getTemplateNames(templateRoot);

  const defaultProjectName = 'waku-project';
  let targetDir = '';

  try {
    const projectName = await prompt<string>({
      message: 'Project Name',
      name: 'projectName',
      type: 'text',
      initial: defaultProjectName,
      format: (name) => (targetDir = name.trim() || defaultProjectName),
    });
    const shouldOverwrite =
      canSafelyOverwrite(targetDir) ||
      (await prompt<boolean>({
        type: 'confirm',
        name: 'shouldOverwrite',
        message: `A project with the name ${bold(projectName)} already exists. Do you want to overwrite it?`,
      }));
    if (!shouldOverwrite) {
      throw new Error(red('✖') + ' Operation cancelled');
    }
    const packageName =
      isValidPackageName(targetDir) ||
      (await prompt<string>({
        message: 'Package name',
        type: 'text',
        name: 'packageName',
        initial: toValidPackageName(projectName),
        validate: (dir) =>
          isValidPackageName(dir) || 'Invalid package.json name',
      }));
    const templateName =
      !values['choose'] ||
      (await prompt<string>({
        name: 'templateName',
        type: 'select',
        message: 'Choose a starter template',
        choices: templateNames.map((name) => ({
          name,
        })),
      }));
    return {
      projectName,
      shouldOverwrite,
      packageName:
        packageName === true ? toValidPackageName(targetDir) : packageName,
      templateName: templateName === true ? templateNames[0] : templateName,
      targetDir,
    };
  } catch (err) {
    if (err instanceof Error) {
      console.log(err.message);
    }
    process.exit(1);
  }
}

function displayUsage() {
  console.log(`
Usage: ${commands.create} [options]

Options:
  --choose              Choose from the template list
  --example             Specify an example use as a template
  -h, --help            Display this help message
`);
}

async function notifyUpdate() {
  const packageJson = await import('../package.json');
  const result = await checkForUpdate(packageJson).catch(() => {});
  if (result?.latest) {
    console.log(`A new version of 'create-waku' is available!`);
    console.log('You can update by running: ');
    console.log();
    console.log(`    npm i -g create-waku`);
  }
}

async function init() {
  if (values.help) {
    displayUsage();
    return;
  }

  const exampleOption = await parseExampleOption(values.example);

  const { packageName, templateName, shouldOverwrite, targetDir } =
    await doPrompts();
  const root = path.resolve(targetDir);

  console.log('Setting up project...');

  if (shouldOverwrite) {
    fse.emptyDirSync(root);
  } else if (!existsSync(root)) {
    await fsPromises.mkdir(root, { recursive: true });
  }

  if (exampleOption) {
    // If an example repository is provided, clone it.
    await downloadAndExtract(root, exampleOption);
  } else if (templateName) {
    // If an example repository is not provided for cloning, proceed
    // by installing from a template.
    await installTemplate(root, packageName, templateRoot, templateName);
  }

  // 1. check packageManager
  // 2. and then install dependencies
  console.log();
  console.log(`Installing dependencies by running ${commands.install}...`);

  const installProcess = spawn(packageManager, ['install'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: targetDir,
  });

  installProcess.on('close', (code) => {
    // process exit code
    if (code !== 0) {
      console.error(`Could not execute ${commands.install}. Please run`);
      console.log(`${bold(green(`cd ${targetDir}`))}`);
      console.log(`${bold(green(commands.install))}`);
      console.log(`${bold(green(commands.dev))}`);
      console.log();
    } else {
      console.log(`\nDone. Now run:\n`);
      console.log(`${bold(green(`cd ${targetDir}`))}`);
      console.log(`${bold(green(commands.dev))}`);
      console.log();
    }
  });
}

init()
  .then(notifyUpdate)
  .catch((e) => {
    console.error(e);
  });
