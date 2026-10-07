// Syntax-only fallback for restricted environments; npm run typecheck remains required.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const appRequire = createRequire(path.join(root, "apps/web/package.json"));
const ts = process.env.WORKBENCH_TYPESCRIPT_PATH
  ? require(process.env.WORKBENCH_TYPESCRIPT_PATH)
  : appRequire("typescript");
let count = 0;
const errors = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (/\.tsx?$/.test(file) && !file.endsWith(".d.ts")) {
      const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        fileName: file,
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
        },
      });
      for (const diagnostic of output.diagnostics || [])
        if (diagnostic.category === ts.DiagnosticCategory.Error)
          errors.push(
            `${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
          );
      count++;
    }
  }
}
for (const directory of ["apps/web/src", "apps/web/e2e", "packages/contracts"])
  visit(path.join(root, directory));
if (errors.length) {
  process.stderr.write(errors.join("\n"));
  process.exit(1);
}
process.stdout.write(
  `PASS: TypeScript/TSX syntax transpilation (${count} files, TypeScript ${ts.version}). This is not a dependency-resolved typecheck or Next.js build.\n`,
);
