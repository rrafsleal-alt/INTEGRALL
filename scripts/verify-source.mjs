import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const lines=(await readFile(path.join(root,'MANIFEST.sha256'),'utf8')).trim().split('\n');
for(const line of lines){
  if(!/^[a-f0-9]{64}  .+/.test(line))throw new Error('Manifesto inválido.');
  const expected=line.slice(0,64),relative=line.slice(66),file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep))throw new Error('Caminho inválido.');
  const actual=createHash('sha256').update(await readFile(file)).digest('hex');
  if(actual!==expected)throw new Error(`Arquivo alterado desde a entrega: ${relative}`);
}
console.log(`SOURCE OK — ${lines.length} arquivos correspondem ao manifesto da entrega. Alterações operacionais posteriores exigem um novo backup, não a restauração automática deste catálogo.`);
