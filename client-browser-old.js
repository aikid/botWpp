import { Markup } from 'telegraf';
import path from 'path';
import { messageList, clearFilaTable, path_image_in_use } from './database-olda.js';
import { BrowserWhatsapp } from './PlaywrightWhats-olda.js';
import qrcode from 'qrcode';
import { telegramRetry }  from './utils-old.js';
import { db, saveDb }  from './sessionFile-old.js';
import fs from 'fs/promises';

//Scheduller 
class ClientBrowser {
  constructor( logger ) {
    this.logger = logger;
    this.isRunning = false;
  };
  connectClient = async () => {
      // Selecionar uma sessão válida
      const sessions = Object.keys(db.sessions);
      
      if (sessions.length === 0) {
        this.logger.warn("Nenhuma sessão disponível");

        return;

      }

      this.session = sessions[0];

      

      this.client = await this.getClient(this.session);

      if (!this.client) {
        this.logger.warn("Sessão ainda não autenticada!");
      }

  }
  pause = async () => {
    this.logger.info(`[SCHEDULER] pause() chamado em ${new Date().toLocaleString('pt-BR')}`);
    this.isRunning = false;
    while (this.service_on) {
      await new Promise((resolve) => setTimeout(resolve, 1000)); 
    }
    return true;
  }
  start = () => {
    if (this.service_on) {
      return;
    } else {
      
      this.logger.info(`[SCHEDULER] start() chamado em ${new Date().toLocaleString('pt-BR')}`);
      this.___service();

      return;
    }
  }
  ___service = async () => {

    if (this.service_on) return;

    this.service_on = true; 

    if (this.client && (await this.client.isConnected())){
      //pass
    } else {
      await this.connectClient();
      
      if (!this.client) {
        this.logger.info(`[SCHEDULER] encerrado em ${new Date().toLocaleString('pt-BR')}`);
        this.service_on = false;
        return;
      }
    }
    
    this.logger.info("Aguardando carregamento completo do whatsapp!");

    await this.client.isLoadChats( () => {
      this.logger.info(`Whatsapp Carregado, iniciando processamento de Fila.`);
      this.looping();
    })
  }
  looping = async () =>{
    let backoff = 5000;
    this.isRunning = true;
    while (this.isRunning) {
        const list = await messageList();

        if (list.length > 0) {
            await this.proccess_send(list);
            backoff = 5000;
        } else {
            this.logger.info("Fila vazia, aguardando...");
            await new Promise(resolve => setTimeout(resolve, backoff));
            backoff = Math.min(backoff * 1.5, 180000); // backoff até 3 min
        }
    }
    this.service_on = false;
  }
  proccess_send = async (list) =>{

    try {

        if (isSessionInUse(this.session)) {
            // Verifica novamente em 2 segundos
            await new Promise((resolve) => setTimeout(resolve, 2000));
            return;
        }

        this.logger.info(`[FILA] ${list.length} mensagens para serem enviadas`);

        setSessionInUse(this.session, true, 'SCHEDULER');
        this.logger.info(`[SCHEDULER] Iniciado em ${new Date().toLocaleString('pt-BR')}`);

        for (const row of list) {
            const id = row.id;
            const message = row.message;
            const path_image = row.path_image;
            const image_original_name = row.image_original_name;
            const pattern = row.pattern;

            if (await this.client.isConnected()) {
              //pass
            } else {
              this.isRunning = false;
              this.logger.warn("Sessão desconectada!");
            }

            if (path_image) {

              const bufferImage = await fs.readFile(path_image);

              await this.client.sendMessageImageByPattern(pattern, bufferImage, message, (status) => {
                if (status.includes("ERRO")) {
                  this.logger.error(status);
                } else {
                  this.logger.info(status);
                }
              }, randomizeDelay());

              await clearFilaTable(id);

            }

            const list_image_in_use = await path_image_in_use(path_image);

            if (path_image && list_image_in_use.length === 0) {
                const fullPath = path.resolve(path_image);
                try {
                    await fs.unlink(fullPath);
                    this.logger.info(`🗑️ Imagem ${fullPath} removida`);
                } catch (err) {
                    this.logger.info(`⚠️ Imagem ${fullPath} não encontrada ou erro ao remover`);
                }
            }

        }
    } catch (err) {
        this.logger.error('❌ Erro no scheduler:', err);
        this.isRunning = false;
    } finally {
        if (isSessionInUse(this.session)){
            setSessionInUse(this.session, false, 'API');
            this.logger.info(`[SCHEDULER] Finalizado em ${new Date().toLocaleString('pt-BR')}`);
        }
    }
  }
  createNewSession = async (phone, ctx) => {
    setSessionInUse(phone, true, ctx.chat.id);

    try {

      this.client = new BrowserWhatsapp(phone);

      await this.client.start(
        (status, data) => {
          this.logger.info(status);
        },
        (action, data) => {
          this.logger.info("Enviando QR CODE");
          if (action == "Connect") {
            qrcode.toBuffer(data, { margin: 2 }, async (err, qrBuffer) => {
              const qrPhotoMsg = await telegramRetry(() =>
                ctx.replyWithPhoto(
                  { source: qrBuffer },
                  {
                    caption: '📱 Escaneie este QR Code com o WhatsApp:\n1. Abra o WhatsApp\n2. Vá em ⋮ → Dispositivos vinculados\n3. Escaneie este código',
                  }
                )
              );

              const qrMsg = await telegramRetry(() =>
                ctx.reply(
                  '🔄 Aguardando autenticação...',
                  Markup.inlineKeyboard([Markup.button.callback('❌ Cancelar', `cancel_action_${phone}`)])
                )
              );

              ctx.session.qrMsgId = qrMsg.message_id;
              ctx.session.qrPhotoMsgId = qrPhotoMsg.message_id;

              if (err) return this.logger.error('Erro ao gerar QR code:', err);
              
            });

          }
        }
      )
      
      if (await this.client.isConnected()){
        // Considera autenticado após algum tempo ou evento
        db.sessions[phone] = { status: 'authenticated', name: phone };
        await saveDb();

        if (ctx.session.qrMsgId) await ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.qrMsgId).catch(() => {});
        if (ctx.session.qrPhotoMsgId) await ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.qrPhotoMsgId).catch(() => {});

        await ctx.reply(`✅ Sessão ${phone} autenticada com sucesso!`);
        mainMenu(ctx);

        setSessionInUse(phone, false);

        this.start();

      }

    } catch (error) {
      this.logger.error('[ERROR] ao criar nova sessão:', error);
      setSessionInUse(phone, false);
    }
  }
  getClient = async (sessionId) => {

    const whats = new BrowserWhatsapp(sessionId);

    await whats.start(
      (status, data) => {
        this.logger.info(status);
      }
    ).then(
      res => res
    ).catch(err => this.logger.error("ERR:" + err));

    if (await whats.isConnected()){
      return whats;
    } else {
      await whats.close();
      return false;
    }

  }
}

// Funções Auxiliares

let sessionInUse = new Map();

const isSessionInUse = (session) => {
  return sessionInUse.has(session);
}

const setSessionInUse = (session, inUse, chatId) => {
  if (inUse) {
    sessionInUse.set(session, chatId);
  } else {
    sessionInUse.delete(session);
    processNextInQueue(session);
  }
}

const getSessionUser = (session)  => {
  return sessionInUse.get(session);
}

const processNextInQueue = async (session) => {
  if (!db.queues[session] || db.queues[session].length === 0 || isSessionInUse(session)) return;
  
  const nextTask = db.queues[session].shift();
  await saveDb();
  setSessionInUse(session, true, nextTask.chatId);
  await telegramRetry(() => 
    bot.telegram.sendMessage(nextTask.chatId, `📤 Iniciando envio da tarefa ${nextTask.taskId}...`)
  );
  await sendToAllGroups(session, nextTask.content, nextTask.chatId, nextTask.taskId, nextTask.groupList);
}

//Delay Aleatorio
function randomizeDelay() {
  return (Math.random() * (9 - 5) + 5) * 1000; 
}

export {ClientBrowser, isSessionInUse, setSessionInUse, getSessionUser, processNextInQueue };