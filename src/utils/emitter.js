import path from 'path';
import fs from 'fs/promises';

import messagesList from '../db/messageList';
import updateMessageStatus from '../db/updateMessage';
import pathImageInUse from '../db//pathImageInUse';

import sendMessage from '../whapi/sendMediaImageMessage'

import { logger } from '../logger/index';

import { delayMin, delayMax } from "../config";

import randomDelay from './randomDelay';

const send = async (messages) => {
    for (const msg of messages) {
      try {
        const result = await sendMessage(msg.token, msg.groupId, msg.pathImage, msg.message);

        if (!result.success) {
          await updateMessageStatus(msg.id, {
            sent: result.sent,
            sentId: result.id
          });

          logger.info(`Mensagem enviada para grupo ${msg.groupId} pela sessão ${msg.token}`);

        } else {
          logger.warn(`Mensagem não enviada para grupo ${msg.groupId} pela sessão ${msg.token}, REALOCANDO para o final!`);

        }
        
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
      await new Promise(resolve => setTimeout(resolve, randomDelay(delayMin, delayMax)));
    }
}

let timeout = 5000;

const processMessages = async() => {

  try {
    const messages = await messagesList();

    timeout = (!messages.length) ? Math.min(timeout * 1.5, 180000) : 5000;

    // Agrupa por token
    const grouped = messages.reduce((acc, msg) => {
      acc[msg.token] = acc[msg.token] || [];
      acc[msg.token].push(msg);
      return acc;
    }, {});

    const promises = Object.values(grouped).map(msgs => send(msgs));

    await Promise.all(promises);

  } catch (err) {
    logger.error(`Erro no emitter: ${err.message}`);
  } finally {
    setTimeout(processMessages, timeout);
  }
}

export default processMessages;