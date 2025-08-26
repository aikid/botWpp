import path from 'path';
import fs from 'fs/promises';

import messagesList from '../db/messageList';
import updateMessageStatus from '../db/updateMessage';
import pathImageInUse from '../db//pathImageInUse';

import sendMessage from '../whapi/sendMediaImageMessage'

import { logger } from '../logger/index';

function randomDelay(min = 5000, max = 9000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const send = async (messages, callback) => {
    for (const msg of messages) {
      try {
        const result = await sendMessage(msg.token, msg.groupId, msg.pathImage, msg.message);

        await updateMessageStatus(msg.id, {
          sent: result.sent,
          sentId: result.id || null
        });

        logger.info(`Mensagem enviada para grupo ${msg.groupId} pela sessão ${msg.token}`);
        
      } catch (err) {
        logger.error(`Erro ao enviar mensagem para grupo ${msg.groupId}: ${err.message}`);
      }

      const list_image_in_use = await pathImageInUse(msg.pathImage);

      if (msg.pathImage && list_image_in_use.length === 0) {
          const fullPath = path.resolve(msg.pathImage);
          try {
              await fs.unlink(fullPath);
              logger.info(`🗑️ Imagem ${fullPath} removida`);
          } catch (err) {
              logger.info(`⚠️ Imagem ${fullPath} não encontrada ou erro ao remover`);
          }
      }
      await new Promise(resolve => setTimeout(resolve, randomDelay()));
    }
    callback();
}

const processMessages = async() => {
  try {
    const messages = await messagesList();
    const tokens = Array.from(new Set(messages.map(m => m.token)));
    const tokensSends = Array.from(new Set(messages.map(m => false)));
    for(const token of tokens){
        const msgsByToken = messages.filter(m => m.token === token);
        send(msgsByToken, () => {tokensSends[token] = true});
    }
    while(tokensSends.includes(false)){
        await new Promise(resolve => setTimeout(resolve, 180000));
    }
  } catch (err) {
    logger.error(`Erro no emitter: ${err.message}`);
  } finally {
    setTimeout(processMessages, 2000);
  }
}

export default processMessages;