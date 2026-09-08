import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const root=path.resolve(process.argv[2]||'dist');
const lines=(await readFile(path.join(root,'BUILD-MANIFEST.sha256'),'utf8')).trim().split('\n');
const declared=new Set();
for(const line of lines){
 if(!/^[a-f0-9]{64}  .+/.test(line))throw new Error('Manifesto inválido.');
 const expected=line.slice(0,64),relative=line.slice(66),file=path.resolve(root,relative);
 if(!file.startsWith(root+path.sep))throw new Error('Caminho de manifesto inválido.');
 const actual=createHash('sha256').update(await readFile(file)).digest('hex');
 if(expected!==actual)throw new Error(`Hash divergente: ${relative}`);
 declared.add(relative);
}
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(e.name==='node_modules'||e.name==='local-state'||e.name==='.env')continue;const f=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('Link simbólico no pacote');if(e.isDirectory())await walk(f);else{const rel=path.relative(root,f).split(path.sep).join('/');if(rel!=='BUILD-MANIFEST.sha256'&&!declared.has(rel))throw new Error(`Arquivo não declarado: ${rel}`);}}}
await walk(root);
const result=spawnSync(process.execPath,[path.join(root,'scripts/verify-media.mjs')],{cwd:root,stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
console.log(`RELEASE OK — ${lines.length} hashes conferidos; nenhuma mídia referenciada ausente.`);
