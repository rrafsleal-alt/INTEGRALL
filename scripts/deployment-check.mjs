import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {normalizeCatalog} from '../src/catalog.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=process.argv.find(arg=>arg.startsWith('--catalog='))?.slice(10)||path.join(root,'data/catalog.json');
const catalog=normalizeCatalog(JSON.parse(await readFile(source,'utf8')));
const missing=[];
for(const [key,label] of [['taxId','CPF/CNPJ do fornecedor'],['businessAddress','endereço físico completo'],['supportEmail','e-mail de atendimento']]){
 if(!catalog.commerce[key])missing.push(label);
}
const draft=catalog.products.filter(p=>p.hidden===true&&!p.price&&!p.variants?.some(v=>v.price>0)).length;
console.log(`Pré-publicação: ${catalog.products.length} cadastros; ${draft} rascunhos sem preço preservados no administrador.`);
if(missing.length)console.log('Dados comerciais a preencher no administrador: '+missing.join('; ')+'.');
console.log('Homologação externa necessária: banco de produção, credenciais próprias, pagamento, e-mail, transportadoras e aprovação jurídica das políticas.');
console.log('Esta checagem lê o catálogo escolhido, não consulta nem modifica um banco publicado.');
if(process.argv.includes('--strict')&&missing.length)process.exit(1);
