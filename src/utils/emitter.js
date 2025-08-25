import messagesList from '../db/messageList';
import sendMessage from '../whapi/sendMediaImageMessage'
import updateMessageStatus from '../db/updateMessage';
import { logger } from '../logger/index';

function randomDelay(min = 5000, max = 9000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const send = async (messages, callback) => {
    for (const msg of messages) {
      try {
        const result = await sendMessage(msg.token, msg.group_id, msg.image_path, msg.message);

        await updateMessageStatus(msg.id, {
          sent: result.sent,
          sentId: result.id || null
        });

        logger.info(`Mensagem enviada para grupo ${msg.group_id} pela sessão ${msg.token}`);
      } catch (err) {
        logger.error(`Erro ao enviar mensagem para grupo ${msg.group_id}: ${err.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, randomDelay()));
    }
    callback();
}

export const processMessages = async() => {
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