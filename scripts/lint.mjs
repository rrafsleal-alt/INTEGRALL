import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';

// Dependency-free style/safety rules. This is not a TypeScript type checker.
const failures = [];
let count = 0;
async function walk(dir) {
  for (const item of await readdir(dir, {withFileTypes:true})) {
    const file = path.join(dir,item.name);
    if (item.isDirectory()) { if (!['node_modules','dist','backups','.git'].includes(item.name)) await walk(file); }
    else if (/\.(?:js|mjs|css|html)$/.test(file)) {
      count++;
      const text = await readFile(file,'utf8');
      if (/^(?:<{7}|={7}|>{7})(?: |$)/m.test(text)) failures.push(`${file}: conflito de merge não resolvido`);
      if (/^[ \t]*debugger\s*;/m.test(text)) failures.push(`${file}: instrução debugger em código entregue`);
      if (/\u0000/.test(text)) failures.push(`${file}: byte nulo inesperado`);
    }
  }
}
for (const directory of ['src','public','scripts','tests']) await walk(directory);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`LINT OK — ${count} arquivos; regras de conflitos, debugger e bytes inválidos (sem inferência de tipos).`);
