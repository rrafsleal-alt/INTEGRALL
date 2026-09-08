import {readFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const map=JSON.parse(await readFile(path.join(root,'data/recovery-map.json'),'utf8'));
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const failures=[];
const urls=new Set();
for(const entry of map.entries){
  if(!entry.publicUrl.startsWith('/assets/recovered/') || !/^[a-f0-9]{64}\.webp$/.test(path.basename(entry.publicUrl))) throw new Error('URL de recuperação inválida.');
  const data=await readFile(path.join(root,'public',entry.publicUrl.slice(1)));
  if(hash(data)!==entry.optimizedSha256) failures.push(`Imagem alterada: ${entry.id}`);
  const sidecar=JSON.parse(await readFile(path.join(root,'data/media-seed',entry.id+'.json'),'utf8'));
  const seed=await readFile(path.join(root,'data/media-seed',entry.id+'.webp'));
  if(hash(seed)!==entry.optimizedSha256 || sidecar.checksum!==entry.optimizedSha256 || sidecar.id!==entry.id || sidecar.mimeType!=='image/webp') failures.push(`Compatibilidade de mídia inválida: ${entry.id}`);
  urls.add(entry.publicUrl);
}
let references=0;
for(const filename of ['catalog.json','catalog.seed.json']){
 const catalog=JSON.parse(await readFile(path.join(root,'data',filename),'utf8'));
 const images=[];
 for(const product of catalog.products){
   if(new Set(product.images||[]).size!==(product.images||[]).length) failures.push(`Galeria duplicada: ${product.id}`);
   images.push(...(product.images||[]),...(product.variants||[]).map(v=>v.image).filter(Boolean));
 }
 images.push(...Object.values(catalog.settings?.visual?.assets||{}).filter(Boolean));
 for(const url of images){
  references++;
  if(url.startsWith('/assets/')){
   try{if(!(await stat(path.join(root,'public',url.slice(1)))).size)failures.push(`Mídia vazia: ${url}`);}catch{failures.push(`Mídia ausente: ${url}`);}
  }else if(url.startsWith('/media/products/')){
   if(!map.entries.some(entry=>entry.legacyUrl===url)) failures.push(`Mídia dinâmica não empacotada: ${url}`);
  }else if(!/^https:\/\//.test(url))failures.push(`URL inválida: ${url}`);
 }
}
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log(`MEDIA OK — ${map.entries.length} IDs preservados; ${urls.size} imagens únicas; ${references} referências verificadas nos catálogos.`);
