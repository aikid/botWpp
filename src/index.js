import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { __dirname, port, path, fs, upload, uploadsDir } from "./config";
import { logger } from "./logger";

import addMessage from './db/addMessage';
import createTables from './db/createTables';
import getAllTokens from './db/getAllTokens';
import setDelivered from './db/setDelivered';

import getGroupsByPatternName from './whapi/getGroupsByPatternName';

import boundSessionById from './utils/boundSessionById';

import bot from './botTelegram';

import processMessages from './utils/emitter';
// Configuração do Express

const app = express();

// Middleware para parsing de JSON
app.use(express.json());

app.post('/send-groups', upload.single('image'), async (req, res) => {
    const { pattern, message } = req.body;
    const image = req.file;

    logger.info(`SEND-GROUPS | GRUPOS: ${pattern}`);

    // Validações
    if (!message && !image) {
        return res.status(400).json({ error: 'Você deve fornecer uma mensagem e uma imagem.' });
    }
    if (!pattern) {
        return res.status(400).json({ error: 'Você deve fornecer um pattern regex para nome' });
    }

  try {

    if (image) {
        const ext = image.originalname.split('.').pop();
        const newPath = path.join(uploadsDir, `${uuidv4()}.${ext}`);
        fs.renameSync(image.path, newPath);

        //Buscar Sessions 
        const arrSessions = (await getAllTokens()).map((row) => row.token);
        const firstToken = arrSessions[0];

        logger.info(`Qtd Sessions: ${arrSessions.length}`);

        //Buscar Grupos para disparo
        const arrGroupID = await getGroupsByPatternName(firstToken, pattern);
        
        logger.info(`Qtd Groups: ${arrGroupID.length}`);

        //Distribui grupos para sessions 
        const mapper = await boundSessionById(arrSessions, arrGroupID);

        for ( const row of mapper){
            const sessionId = row[0];
            const groupId = row[1];

            await addMessage(sessionId, groupId, message, newPath, image.originalname);
        }
    }
    
    res.status(202).json({ success: true, msg: "Mensagem encaminhada para fila" });
  } catch (err) {
    logger.error(`[SEND-GROUPS] ERRO: ${JSON.stringify(err)}`);
    res.status(500).json({ error: err.message });
  }
});

//WebHook Status
app.put('webhook/statuses', async (req, res) => {
  const { statuses, channel_id} = req.body;
  statuses.filter(row => row.status == 'delivered')
    .forEach(row => {
      setDelivered(row.id)
    }
  );
});

// Iniciar o servidor Express
app.listen(port, async () => {
  logger.info(`Servidor Express rodando na porta ${port}`);
  await createTables().then( res => {
      if (res.status == "success"){
        logger.info(res.msg);
      }
    })
    .catch( err => {
      logger.error(`Erro ao iniciar Base: ${err.message}`);
    });
  
  processMessages();
  
  // Iniciar Bot telegram
  try {
    await bot.launch(
      () => logger.info('Bot iniciado!')
    );
  } catch (err) {
    logger.warn('Bot OFF, verifique o TELEGRAM_TOKEN');
  }
});