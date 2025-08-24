import pino from 'pino';
import path from 'path';
import { __dirname }  from '../config';

// Configuração do logger para console e arquivo
const logger = pino({
  level: 'info',
  transport: {
    targets: [
      {
        target: 'pino-pretty', // Para o console
        options: {
          colorize: true, // Exibe com cores no console
          translateTime: 'dd-mm-yyyy HH:MM:ss', // Formato de timestamp legível
          destination: 1, // 1 = stdout
          ignore: 'pid,hostname', // Ignora pid e hostname
        },
      },
      {
        target: 'pino-pretty', // Para o arquivo
        options: {
          destination: path.join(__dirname, 'bot.log'),
          mkdir: true,
          colorize: false, // Sem cores no arquivo
          translateTime: 'dd-mm-yyyy HH:MM:ss',
          ignore: 'pid,hostname', // Ignora pid e hostname
        },
      },
    ],
  },
});


export { logger };