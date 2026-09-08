/** Read-only compatibility check of the image validator against shipped media. */
import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateAndSanitizeImage} from '../src/image-upload.js';
const root=process.cwd();
const out=path.resolve(process.argv[2]||'docs/revisao-cliente/midias');
await mkdir(out,{recursive:true});
const results=[];
async function walk(dir){
 for(const entry of await readdir(path.join(root,dir),{withFileTypes:true})){
  const rel=path.join(dir,entry.name);
  if(entry.isDirectory()){await walk(rel);continue}
  if(!/\.(png|jpe?g|webp)$/i.test(rel))continue;
  const data=await readFile(path.join(root,rel));
  try{
   const parsed=validateAndSanitizeImage({data,filename:entry.name});
   const hash=createHash('sha256').update(parsed.data).digest('hex');
   // Only optional temporary copies are decoded by a second independent tool.
   if(process.env.INTEGRALL_DECODE_DIR){await mkdir(process.env.INTEGRALL_DECODE_DIR,{recursive:true});await writeFile(path.join(process.env.INTEGRALL_DECODE_DIR,hash+'.'+(parsed.mimeType.split('/')[1])),parsed.data)}
   results.push({file:rel,status:'APROVADO',width:parsed.width,height:parsed.height,sha256:hash});
  }catch(error){results.push({file:rel,status:'REPROVADO',code:error.code,message:error.message})}
 }
}
for(const dir of ['public/assets','data/media-seed','tests/fixtures/client-images'])await walk(dir);
const report={scope:'Validação estrutural em leitura; não modifica mídia operacional',total:results.length,failures:results.filter(x=>x.status!=='APROVADO'),results};
await writeFile(path.join(out,'compatibilidade.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({total:report.total,failures:report.failures}));
process.exitCode=report.failures.length?1:0;
