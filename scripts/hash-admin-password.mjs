import process from 'node:process';
import {hashPassword} from '../src/auth.js';

function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return new Promise(resolve => {
      let input = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { input += chunk; });
      process.stdin.on('end', () => resolve(input.replace(/\r?\n$/, '')));
    });
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    const wasRaw = Boolean(stdin.isRaw);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\u0003') {cleanup();process.stdout.write('\n');reject(new Error('Operação cancelada.'));return;}
        if (char === '\r' || char === '\n') {cleanup();process.stdout.write('\n');resolve(value);return;}
        if (char === '\u007f' || char === '\b') {
          if (value) {value=Array.from(value).slice(0,-1).join('');process.stdout.write('\b \b');}
        } else if (!/[\u0000-\u001f\u007f]/.test(char) && value.length < 256) {
          value+=char;process.stdout.write('•');
        }
      }
    };
    stdin.on('data', onData);
  });
}

try {
  const first = await readHidden('Nova senha administrativa (mínimo 10 caracteres): ');
  const second = process.stdin.isTTY ? await readHidden('Repita a senha: ') : first;
  if (first !== second) throw new Error('As senhas não coincidem.');
  const encoded = await hashPassword(first);
  process.stdout.write(`\nADMIN_PASSWORD_HASH=${encoded}\n`);
  process.stdout.write('Copie somente a linha acima para o gerenciador seguro de variáveis do ambiente.\n');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
