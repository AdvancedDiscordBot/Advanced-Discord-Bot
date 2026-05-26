const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pluginsDir = path.join(__dirname, '..', 'plugins');

function findPluginWebs(dir) {
  const webs = [];
  if (!fs.existsSync(dir)) return webs;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const webPath = path.join(dir, entry.name, 'web');
      const pkgJson = path.join(webPath, 'package.json');
      if (fs.existsSync(pkgJson)) {
        const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'));
        if (pkg.scripts?.build) {
          webs.push({ name: entry.name, path: webPath, pkg });
        }
      }
    }
  }
  return webs;
}

function run(command, cwd) {
  console.log(`\n📦 Running in ${cwd}: ${command}`);
  try {
    execSync(command, { cwd, stdio: 'inherit' });
  } catch (e) {
    console.error(`❌ Failed in ${cwd}`);
    process.exit(1);
  }
}

const webs = findPluginWebs(pluginsDir);

if (webs.length === 0) {
  console.log('No plugin web apps found to build.');
  process.exit(0);
}

console.log(`Found ${webs.length} plugin web app(s) to build.`);

for (const web of webs) {
  console.log(`\n🔨 Building ${web.name} web app...`);
  run('npm install', web.path);
  run('npm run build', web.path);
}

console.log('\n✅ All plugin web apps built successfully.');