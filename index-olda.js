const { Telegraf, Markup, session } = require('telegraf');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { Worker } = require('worker_threads');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { createTable, addMessage } = require('./database-olda.js');
const { ClientBrowser, isSessionInUse, setSessionInUse, getSessionUser, processNextInQueue } = require('./client-browser-old.js');
const { delay, telegramRetry } = require('./utils-old.js');
const { db, saveDb } = require('./sessionFile-old.js');


// PREPARA TESTES
const TESTES = (process.env.PORT)? false : true;

const PHONE_TEST = (!TESTES)? null : "test_number_test";

// Configuração do Express
const app = express();
const port = process.env.PORT || 3000;

const TELEGRAM_TOKEN = '7670764917:AAHb-qogu40Yy-30IGYgh2y9GKr9jH24U-4' //process.env.TELEGRAM_TOKEN;

const mediaDir = path.join(__dirname, 'media');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

const uploadsDir = path.join(__dirname, 'media/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Configuração do Multer para upload de arquivos
const upload = multer({
  dest: path.join(__dirname, uploadsDir), // Diretório temporário para uploads
  limits: { fileSize: 10 * 1024 * 1024 }, // Limite de 10MB para arquivos
});

// Middleware para parsing de JSON
app.use(express.json());

// Rota GET /groups
app.get('/groups', async (req, res) => {

  await client_browser.pause();

  while (true){
    if (isSessionInUse(client_browser.session)) {
      // Verifica novamente em 2 segundos
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }

    break;
  }


  setSessionInUse(client_browser.session, true, 'API');
  try {

    const isConnected = await client_browser.client.isConnected();

    if (isConnected){

      const groups = await client_browser.client.getAllChatsGroups();

      res.status(200).json({ groups: groups.map(
        (row) => ({
          Nome: row.name,
          id: row.id
        })
      )
      });
    } else {
      res.status(400).json({ error: 'Sessão desconectada' });
    }

  } catch (err) {
    logger.error('❌ Erro na leitura do grupo:', err);
    res.status(500).json({ error: 'Erro no servidor' });
  } finally {
    setSessionInUse(client_browser.session, false, 'API');
    client_browser.start();
  }
});

app.post('/print-tela', async (req, res) => {
  try {
    const bodyRes = await client_browser.client.screenshot();
    res.status(200).send(bodyRes);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' })
  }
});

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

      await addMessage(message, newPath, image.originalname, pattern);      

    }

    client_browser.start();
    
    res.status(202).json({ success: true, msg: "Mensagem encaminhada para fila" });
  } catch (err) {
    logger.error(`[SEND-GROUPS] ERRO: ${JSON.stringify(err)}`);
    res.status(500).json({ error: err.message });
  }
});

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


const whatsappClients = {};
const activeWorkers = new Map();

// Adicionar no início do código, após a definição de `activeWorkers`
function monitorWorkers() {
  const MAX_RUNTIME = 20 * 60 * 1000; // 20 minutos em milissegundos
  setInterval(() => {
    const now = Date.now();
    for (const [taskId, workerData] of activeWorkers.entries()) {
      if (now - workerData.startTime >= MAX_RUNTIME) {
        logger.info(`[${getFormattedDateTime()}] [Task ID: ${taskId}] ❌ Worker ${taskId} ultrapassou 20 minutos. Forçando encerramento...`);
        workerData.worker.terminate();
        activeWorkers.delete(taskId);
        setSessionInUse(workerData.originalData.session, false);
        telegramRetry(() =>
          bot.telegram.sendMessage(
            workerData.originalData.chatId,
            `❌ Envio da tarefa ${taskId} interrompido: Tempo máximo de 20 minutos atingido.`,
            Markup.inlineKeyboard([[Markup.button.callback('↩️ Menu Principal', 'menu')]])
          )
        ).catch(err => logger.error(`Erro ao notificar usuário sobre timeout: ${err.message}`));
      }
    }
  }, 60000); // Verificar a cada 1 minuto
}

// Função auxiliar para formatar data/hora
function getFormattedDateTime() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium'
  });
}


const bot = new Telegraf(TELEGRAM_TOKEN, { handlerTimeout: 30000 });
axios.defaults.timeout = 10000;

const botStartTime = Math.floor(Date.now() / 1000);

function isUserAllowed(ctx) {
  if (!db.botControl.enabled) return true;
  const user = ctx.from.username || ctx.from.id.toString();
  return db.botControl.allowedUsers.includes(user);
}

function isAdmin(ctx) {
  const username = ctx.from.username ? `@${ctx.from.username}` : null;
  const userId = ctx.from.id.toString();
  logger.debug(`Verificando admin - Username: ${username}, ID: ${userId}`);
  return db.botControl.admins.includes(username) || db.botControl.admins.includes(userId);
}

async function addToQueue(session, content, chatId, groupList) {
  if (!db.queues[session]) db.queues[session] = [];
  const taskId = `T${Date.now().toString().slice(-11)}`;
  db.queues[session].push({ taskId, content, chatId, groupList });
  await saveDb();
  return taskId;
}

async function downloadFile(url, type) {
  const filePath = path.join(mediaDir, `${uuidv4()}.${type}`);
  const maxRetries = 3;
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 30000
      });
      response.data.pipe(fs.createWriteStream(filePath));
      return new Promise((resolve, reject) => {
        response.data.on('end', () => resolve(filePath));
        response.data.on('error', (err) => reject(err));
      });
    } catch (err) {
      lastError = err;
      logger.error(`Tentativa ${attempt + 1} falhou: ${err.message}`);
      if (attempt < maxRetries - 1) {
        await delay(2000 * Math.pow(2, attempt));
      }
    }
  }

  logger.error('Erro ao baixar arquivo após todas as tentativas:', lastError);
  throw lastError;
}

async function scrapePromo(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    let icon = '🛍️';
    let conviteMessage = '';
    if (url.includes('promodehomem')) {
      icon = '🏁';
      conviteMessage = '🔥 VAGAS NO GRUPO DO WHATSAPP NESSE LINK:';
    } else {
      icon = '💋';
      conviteMessage = '💋 Convida as amigas pro grupo!:';
    }

    const title = $('h1.sc-c006e98b-9').text().trim();
    const oldPrice = $('div.sc-c006e98b-17').text().trim();
    const newPrice = $('div.sc-c006e98b-18').text().trim();
    const link = url;
    const imageUrl = $('div.sc-c006e98b-6').attr('style').match(/url\("(.*?)"\)/)[1];
    const linkWhatsApp = $('a.sc-9ca5915a-1').attr('href');
    let coupon = $('button.sc-c006e98b-14').first().text().trim();
    if (coupon.includes('Copiar')) {
      coupon = coupon.replace(/Copiar.*/, '').trim();
    }

    let message = `${icon} ${title}\n`;
    if (oldPrice) message += `\nDe ~${oldPrice}~\n`;
    message += `💵 Por ${newPrice}\n`;
    if (coupon) message += `\n🎟️ Cupom: ${coupon}\n`;
    message += `\n➡️ ${link}\n`;
    if (linkWhatsApp) message += `\n${conviteMessage} ${linkWhatsApp}`;
    const imagePath = await downloadFile(imageUrl, 'jpg');
    return { message, imagePath };
  } catch (error) {
    logger.error('Erro ao fazer scraping:', error);
    return null;
  }
}


async function removeSession(phone, ctx) {
  if (isSessionInUse(phone)) {
    const userId = getSessionUser(phone);
    await telegramRetry(() =>
      ctx.reply(`⚠️ A sessão ${phone} está em uso pelo chat ${userId}. Deseja adicionar à fila para remoção?`, 
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Sim', `queue_remove_${phone}`)],
          [Markup.button.callback('❌ Não', 'menu')]
        ]))
    );
    return;
  }

  setSessionInUse(phone, true, ctx.chat.id);
  try {
    if (whatsappClients[phone]) {
      whatsappClients[phone].end();
      delete whatsappClients[phone];
    }
    const authDir = path.join(__dirname, 'auth_info_multi', session);

    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }
    delete db.sessions[phone];
    delete db.customLists[phone];
    delete db.queues[phone];
    await saveDb();
    await telegramRetry(() => ctx.reply(`✅ Sessão ${phone} removida com sucesso!`));
  } catch (err) {
    logger.error(`Erro ao remover sessão ${phone}:`, err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao remover a sessão ${phone}: ${err.message}`));
  } finally {
    setSessionInUse(phone, false);
  }
}

async function editSessionName(ctx, phone, newName) {
  try {
    if (db.sessions[phone]) {
      db.sessions[phone].name = newName;
      await saveDb();
      await telegramRetry(() => ctx.reply(`✅ Nome da sessão ${phone} atualizado para: ${newName}`));
    } else {
      await telegramRetry(() => ctx.reply(`❌ Sessão ${phone} não encontrada.`));
    }
  } catch (err) {
    logger.error(`Erro ao editar nome da sessão ${phone}:`, err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao editar nome: ${err.message}`));
  }
}

async function monitorSessions() {
  for (const phone in whatsappClients) {
    const client = whatsappClients[phone];
    try {
      await client.user;
    } catch (err) {
      logger.info(`Sessão ${phone} desconectada. Removendo do cache...`);
      delete whatsappClients[phone];
    }
  }
}

setInterval(monitorSessions, 60000);

bot.use(session({ defaultSession: () => ({}) }));

bot.use((ctx, next) => {
  if (ctx.update.message) {
    const messageDate = ctx.update.message.date;
    if (messageDate < botStartTime) {
      logger.info(`Mensagem antiga ignorada: ${ctx.update.message.text}`);
      return;
    }
  }
  if (!isUserAllowed(ctx) && !isAdmin(ctx)) {
    telegramRetry(() => ctx.reply('❌ Você não tem permissão para usar este bot.'));
    return;
  }
  return next();
});

// Menu principal
function mainMenu(ctx) {
  ctx.session = { taskId: ctx.session?.taskId || null }; // Preserva taskId se existir
  const buttons = [
    [Markup.button.callback('📋 Gerenciar Sessões', 'manage_sessions')],
    // [Markup.button.callback('📑 Gerenciar Lista de Grupos', 'manage_group_lists')],
  ];
  if (isAdmin(ctx)) {
    buttons.push([Markup.button.callback('🤖 Gerenciar Bot', 'manage_bot')]);
    logger.info('Usuário é admin, exibindo Gerenciar Bot'); // Debug
  } else {
    logger.info('Usuário não é admin, ocultando Gerenciar Bot'); // Debug
  }
  return telegramRetry(() =>
    ctx.reply('Escolha uma opção:', Markup.inlineKeyboard(buttons))
  ).catch(err => {
    logger.error('Erro ao exibir menu principal:', err);
    ctx.reply('❌ Erro ao exibir menu. Tente novamente com /menu.');
  });
}

// Menu principal TESTES
function mainMenuTests(ctx) {
  ctx.session = { taskId: ctx.session?.taskId || null }; // Preserva taskId se existir
  const buttons = [
    [Markup.button.callback('Gerar sessao pro localhost', `reauth_session_${PHONE_TEST}`)],
  ];
  if (TESTES) {
    logger.info('Ambiente de Teste'); // Debug
  }
  return telegramRetry(() =>
    ctx.reply('Escolha uma opção:', Markup.inlineKeyboard(buttons))
  ).catch(err => {
    logger.error('Erro ao exibir menu principal:', err);
    ctx.reply('❌ Erro ao exibir menu. Tente novamente com /menu.');
  });
}


bot.command('start', (ctx) => (TESTES)? mainMenuTests(ctx) : mainMenu(ctx));
bot.command('menu', (ctx) => (TESTES)? mainMenuTests(ctx) : mainMenu(ctx));

bot.action('manage_sessions', async (ctx) => {
  try {
    await telegramRetry(() =>
      ctx.reply('Gerenciar Sessões:', Markup.inlineKeyboard([
        [Markup.button.callback('➕ Adicionar Sessão', 'add_session')],
        [Markup.button.callback('🗑️ Remover Sessão', 'remove_session')],
        [Markup.button.callback('✏️ Editar Nome da Sessão', 'edit_session_name')],
        [Markup.button.callback('↩️ Menu Principal', 'menu')],
      ]))
    );
  } catch (err) {
    logger.error('Erro ao exibir menu de gerenciamento:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao exibir menu: ${err.message}`));
  }
});

bot.action('add_session', async (ctx) => {
  try {
    ctx.session.waitingForPhone = true;
    await telegramRetry(() =>
      ctx.reply('📱 Digite o número do WhatsApp (ex: 5511999999999):', Markup.inlineKeyboard([
        [Markup.button.callback('Menu', 'menu')]
      ]))
    );
  } catch (err) {
    logger.error('Erro ao solicitar número:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action('remove_session', async (ctx) => {
  try {
    const sessions = Object.keys(db.sessions);
    if (sessions.length === 0) {
      await telegramRetry(() => ctx.reply('Nenhuma sessão disponível.'));
      return;
    }

    const buttons = sessions.map(session => [Markup.button.callback(db.sessions[session].name || session, `session_confirm_remove_${session}`)]);
    buttons.push([Markup.button.callback('❌ Cancelar', 'cancel_action_remove_session')]);
    await telegramRetry(() =>
      ctx.reply('Selecione a sessão para remover:', Markup.inlineKeyboard(buttons))
    );
  } catch (err) {
    logger.error('Erro ao listar sessões para remoção:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/session_confirm_remove_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  await removeSession(session, ctx);
  mainMenu(ctx);
});

bot.action('edit_session_name', async (ctx) => {
  try {
    const sessions = Object.keys(db.sessions);
    if (sessions.length === 0) {
      await telegramRetry(() => ctx.reply('Nenhuma sessão disponível.'));
      return;
    }

    const buttons = sessions.map(session => [Markup.button.callback(db.sessions[session].name || session, `edit_select_${session}`)]);
    buttons.push([Markup.button.callback('❌ Cancelar', 'cancel_action_edit_session')]);
    await telegramRetry(() =>
      ctx.reply('Selecione a sessão para editar o nome:', Markup.inlineKeyboard(buttons))
    );
  } catch (err) {
    logger.error('Erro ao listar sessões para edição:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/edit_select_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    ctx.session.editingSession = session;
    await telegramRetry(() =>
      ctx.reply(`Digite o novo nome para a sessão ${db.sessions[session].name || session}:`, Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancelar', `cancel_action_edit_${session}`)],
        [Markup.button.callback('Menu', 'menu')]
      ]))
    );
  } catch (err) {
    logger.error('Erro ao solicitar novo nome:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/reauth_session_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    setSessionInUse(session, true, ctx.chat.id);

    const authDir = path.join(__dirname, 'auth_info_multi', session);
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }
    
    await telegramRetry(() => ctx.reply('🔄 Gerando novo QR Code para reautenticação...'));
    await client_browser.createNewSession(session, ctx);
  } catch (err) {
    logger.error('Erro ao reautenticar sessão:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao reautenticar: ${err.message}`));
    setSessionInUse(session, false);
  }
});


bot.action(/switch_session_(.+)_(.+)_(.+)/, async (ctx) => {
  const oldSession = ctx.match[1];
  const newSession = ctx.match[2];
  const taskId = ctx.match[3];

  try {
    if (!db.sessions[newSession]) {
      await telegramRetry(() => ctx.reply(`❌ Sessão ${newSession} não encontrada.`));
      return;
    }

    if (isSessionInUse(newSession)) {
      const userId = getSessionUser(newSession);
      await telegramRetry(() =>
        ctx.reply(`⚠️ A sessão ${newSession} está em uso pelo chat ${userId}. Adicione à fila ou tente outra sessão.`, 
          Markup.inlineKeyboard([[Markup.button.callback('Menu', 'menu')]])
        )
      );
      return;
    }

    // Recuperar informações da tarefa original
    const workerData = activeWorkers.get(taskId);
    if (!workerData) {
      await telegramRetry(() => ctx.reply(`❌ Tarefa ${taskId} não encontrada ou já concluída.`));
      return;
    }

    const { content, chatId, groupList } = workerData.originalData || {};
    if (!content || !chatId) {
      await telegramRetry(() => ctx.reply(`❌ Dados da tarefa original não encontrados.`));
      return;
    }

    // Finalizar o worker antigo
    workerData.worker.terminate();
    activeWorkers.delete(taskId);

    // Iniciar envio com a nova sessão
    await telegramRetry(() => ctx.reply(`🔄 Trocando para a sessão ${db.sessions[newSession].name || newSession}...`));
    const newTaskId = await sendToAllGroups(newSession, content, chatId, taskId, groupList);
    ctx.session.taskId = newTaskId;

    mainMenu(ctx);
  } catch (err) {
    logger.error(`Erro ao trocar sessão de ${oldSession} para ${newSession}:`, err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao trocar sessão: ${err.message}`));
    mainMenu(ctx);
  }
});

bot.action('send_message', async (ctx) => {
  try {
    const sessions = Object.keys(db.sessions);
    if (sessions.length === 0) {
      await telegramRetry(() => ctx.reply('Nenhuma sessão disponível.'));
      return;
    }

    const buttons = sessions.map(session => [Markup.button.callback(db.sessions[session].name || session, `select_session_for_send_${session}`)]);
    buttons.push([Markup.button.callback('❌ Cancelar', 'cancel_action_send_message')]);
    await telegramRetry(() =>
      ctx.reply('Selecione a sessão para enviar mensagem:', Markup.inlineKeyboard(buttons))
    );
  } catch (err) {
    logger.error('Erro ao listar sessões para envio:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/select_session_for_send_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    ctx.session.selectedSession = session;
    const lists = db.customLists[session] || {};
    const buttons = [[Markup.button.callback('Enviar para todos os grupos', `send_to_all_groups_${session}`)]];
    Object.keys(lists).forEach(listName => {
      buttons.push([Markup.button.callback(`Lista: ${listName}`, `send_to_custom_list_${session}_${listName}`)]);
    });
    buttons.push([Markup.button.callback('❌ Cancelar', `cancel_action_send_${session}`)]);
    await telegramRetry(() =>
      ctx.reply(`Escolha o destino para a sessão ${db.sessions[session].name || session}:`, Markup.inlineKeyboard(buttons))
    );
  } catch (err) {
    logger.error('Erro ao listar destinos de envio:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/send_to_all_groups_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    ctx.session.selectedSession = session;
    ctx.session.sendToAll = true;
    ctx.session.waitingForMessage = true;
    await telegramRetry(() =>
      ctx.reply(`Envie a mensagem para todos os grupos da sessão ${db.sessions[session].name || session}:`, Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancelar', `cancel_action_send_${session}`)]
      ]))
    );
  } catch (err) {
    logger.error('Erro ao selecionar envio para todos os grupos:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/send_to_custom_list_(.+)_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  const listName = ctx.match[2];
  try {
    ctx.session.selectedSession = session;
    ctx.session.selectedList = listName;
    ctx.session.waitingForMessage = true;
    await telegramRetry(() =>
      ctx.reply(`Envie a mensagem para a lista "${listName}" da sessão ${db.sessions[session].name || session}:`, Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancelar', `cancel_action_send_${session}`)]
      ]))
    );
  } catch (err) {
    logger.error('Erro ao selecionar envio para lista personalizada:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action('manage_group_lists', async (ctx) => {
  try {
    const sessions = Object.keys(db.sessions);
    if (sessions.length === 0) {
      await telegramRetry(() => ctx.reply('Nenhuma sessão disponível.'));
      return;
    }

    const buttons = sessions.map(session => [Markup.button.callback(db.sessions[session].name || session, `manage_lists_for_${session}`)]);
    buttons.push([Markup.button.callback('↩️ Menu Principal', 'menu')]);
    await telegramRetry(() =>
      ctx.reply('Selecione a sessão para gerenciar listas de grupos:', Markup.inlineKeyboard(buttons))
    );
  } catch (err) {
    logger.error('Erro ao listar sessões para gerenciamento de listas:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/manage_lists_for_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    await telegramRetry(() =>
      ctx.reply(`Gerenciar listas da sessão ${db.sessions[session].name || session}:`, Markup.inlineKeyboard([
        [Markup.button.callback('➕ Criar Nova Lista', `create_new_list_${session}`)],
        [Markup.button.callback('✏️ Editar Lista Existente', `edit_existing_list_${session}`)],
        [Markup.button.callback('🗑️ Remover Lista', `remove_list_${session}`)],
        [Markup.button.callback('↩️ Menu Principal', 'menu')]
      ]))
    );
  } catch (err) {
    logger.error('Erro ao exibir opções de gerenciamento de listas:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/create_new_list_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    ctx.session.creatingListFor = session;
    await telegramRetry(() =>
      ctx.reply(`Digite o nome da nova lista para a sessão ${db.sessions[session].name || session}:`, Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancelar', `cancel_action_create_${session}`)]
      ]))
    );
  } catch (err) {
    logger.error('Erro ao solicitar nome da lista:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/edit_existing_list_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    const lists = db.customLists[session] || {};
    if (Object.keys(lists).length === 0) {
      await telegramRetry(() => ctx.reply('Nenhuma lista personalizada encontrada para esta sessão.'));
      return;
    }
    const buttons = Object.keys(lists).map(listName => [Markup.button.callback(listName, `edit_list_${session}_${listName}`)]);
    buttons.push([Markup.button.callback('❌ Cancelar', `cancel_action_edit_list_${session}`)]);
    await telegramRetry(() =>
      ctx.reply('Selecione a lista para editar:', Markup.inlineKeyboard(buttons))
    );
  } catch (err) {
    logger.error('Erro ao listar listas para edição:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/edit_list_(.+)_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  const listName = ctx.match[2];
  let client;
  try {
    client = await getTemporaryClient(session);
    const chats = await client.groupFetchAllParticipating();
    const groupChats = Object.values(chats).filter(chat => chat.id.endsWith('@g.us'));

    ctx.session.tempGroups = groupChats.map((group, index) => ({ index, ...group }));
    ctx.session.editingList = { session, listName };

    const message = await showGroupsForList(ctx, session, listName, 0);
    ctx.session.groupListMessageId = message.message_id;
  } catch (err) {
    logger.error('Erro ao carregar grupos para edição:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao carregar grupos: ${err.message}. Verifique se a sessão está autenticada.`));
  } finally {
    if (client) client.end();
  }
});

bot.action(/remove_list_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    const lists = db.customLists[session] || {};
    if (Object.keys(lists).length === 0) {
      await telegramRetry(() => ctx.reply('Nenhuma lista personalizada encontrada para esta sessão.'));
      return;
    }
    const buttons = Object.keys(lists).map(listName => [Markup.button.callback(listName, `list_confirm_remove_${session}_${listName}`)]);
    buttons.push([Markup.button.callback('❌ Cancelar', `cancel_action_remove_list_${session}`)]);
    await telegramRetry(() =>
      ctx.reply('Selecione a lista para remover:', Markup.inlineKeyboard(buttons))
    );
  } catch (err) {
    logger.error('Erro ao listar listas para remoção:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/list_confirm_remove_(.+)_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  const listName = ctx.match[2];
  try {
    if (!db.customLists[session] || !db.customLists[session][listName]) {
      await telegramRetry(() => ctx.reply(`❌ Lista "${listName}" não encontrada para a sessão ${db.sessions[session].name || session}.`));
      return;
    }

    delete db.customLists[session][listName];
    if (Object.keys(db.customLists[session]).length === 0) {
      delete db.customLists[session];
    }
    await saveDb();

    await telegramRetry(() => ctx.reply(`✅ Lista "${listName}" removida com sucesso da sessão ${db.sessions[session].name || session}!`));
    mainMenu(ctx);
  } catch (err) {
    logger.error('Erro ao remover lista:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao remover a lista "${listName}": ${err.message}`));
  }
});

// Menu Gerenciar Bot (Apenas Admins)
bot.action('manage_bot', async (ctx) => {
  if (!isAdmin(ctx)) {
    await telegramRetry(() => ctx.reply('❌ Apenas administradores podem acessar este menu.'));
    return;
  }
  try {
    const status = db.botControl.enabled ? '✅ Ativado' : '❌ Desativado';
    await telegramRetry(() =>
      ctx.reply(`🤖 Gerenciar Bot (Controle de Acesso: ${status}):`, Markup.inlineKeyboard([
        [Markup.button.callback('➕ Adicionar Usuário', 'add_user')],
        [Markup.button.callback('🗑️ Remover Usuário', 'remove_user')],
        [Markup.button.callback(db.botControl.enabled ? '❌ Desativar Controle' : '✅ Ativar Controle', 'toggle_control')],
        [Markup.button.callback('↩️ Menu Principal', 'menu')]
      ]))
    );
  } catch (err) {
    logger.error('Erro ao exibir menu Gerenciar Bot:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action('add_user', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    ctx.session.waitingForUserToAdd = true;
    await telegramRetry(() =>
      ctx.reply('Digite o nome de usuário (@username) ou ID/número de telefone do usuário para adicionar:', Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancelar', 'cancel_action_add_user')]
      ]))
    );
  } catch (err) {
    logger.error('Erro ao solicitar usuário:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action('remove_user', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    if (db.botControl.allowedUsers.length === 0) {
      await telegramRetry(() => ctx.reply('Nenhum usuário na lista de permitidos.'));
      return;
    }
    const buttons = db.botControl.allowedUsers.map(user => [Markup.button.callback(user, `confirm_remove_user_${user}`)]);
    buttons.push([Markup.button.callback('❌ Cancelar', 'cancel_action_remove_user')]);
    await telegramRetry(() =>
      ctx.reply('Selecione o usuário para remover:', Markup.inlineKeyboard(buttons))
    );
  } catch (err) {
    logger.error('Erro ao listar usuários para remoção:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/confirm_remove_user_(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const user = ctx.match[1];
  try {
    const index = db.botControl.allowedUsers.indexOf(user);
    if (index !== -1) {
      db.botControl.allowedUsers.splice(index, 1);
      await saveDb();
      await telegramRetry(() => ctx.reply(`✅ Usuário ${user} removido da lista de permitidos.`));
    }
    mainMenu(ctx);
  } catch (err) {
    logger.error('Erro ao remover usuário:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action('toggle_control', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    db.botControl.enabled = !db.botControl.enabled;
    await saveDb();
    await telegramRetry(() => ctx.reply(`✅ Controle de acesso ${db.botControl.enabled ? 'ativado' : 'desativado'}.`));
    mainMenu(ctx);
  } catch (err) {
    logger.error('Erro ao alternar controle:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

// Ações de Fila
bot.action(/queue_session_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    await telegramRetry(() => ctx.reply('✅ Sessão adicionada à fila. Você será notificado quando for processada.'));
    mainMenu(ctx);
    // Aqui você pode adicionar mais lógica se necessário, mas a criação já está na entrada de texto
  } catch (err) {
    logger.error('Erro ao adicionar sessão à fila:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/queue_remove_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    if (!db.queues[session]) db.queues[session] = [];
    db.queues[session].push({ taskId: `R${Date.now().toString().slice(-11)}`, action: 'remove', chatId: ctx.chat.id });
    await saveDb();
    await telegramRetry(() => ctx.reply('✅ Remoção da sessão adicionada à fila.'));
    mainMenu(ctx);
    processNextInQueue(session);
  } catch (err) {
    logger.error('Erro ao adicionar remoção à fila:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

async function showGroupsForList(ctx, session, listName, page) {
  try {
    const groupChats = ctx.session.tempGroups || [];
    if (!groupChats.length) {
      await telegramRetry(() => ctx.reply('❌ Nenhum grupo carregado. Tente novamente.'));
      return;
    }

    const itemsPerPage = 10;
    const totalPages = Math.ceil(groupChats.length / itemsPerPage);
    const start = page * itemsPerPage;
    const end = Math.min(start + itemsPerPage, groupChats.length);
    const paginatedGroups = groupChats.slice(start, end);

    const currentList = (db.customLists[session] && db.customLists[session][listName]) || [];
    const buttons = paginatedGroups.map(group => {
      const isSelected = currentList.includes(group.id);
      return [Markup.button.callback(`${isSelected ? '✅' : '⬜'} ${group.subject}`, `toggle_group_${group.index}_${page}`)];
    });

    const navButtons = [];
    if (page > 0) navButtons.push(Markup.button.callback('⬅️ Anterior', `list_page_${session}_${listName}_${page - 1}`));
    if (page < totalPages - 1) navButtons.push(Markup.button.callback('Próximo ➡️', `list_page_${session}_${listName}_${page + 1}`));
    if (navButtons.length > 0) buttons.push(navButtons);
    buttons.push([Markup.button.callback('✅ Salvar e Voltar', `save_list_${session}_${listName}`)]);
    buttons.push([Markup.button.callback('❌ Cancelar', `cancel_action_list_${session}`)]);

    const text = `Editando lista "${listName}" - Sessão: ${db.sessions[session].name || session}\nPágina ${page + 1} de ${totalPages}\nSelecione os grupos:`;

    if (ctx.session.groupListMessageId) {
      await telegramRetry(() =>
        ctx.telegram.editMessageText(
          ctx.chat.id,
          ctx.session.groupListMessageId,
          null,
          text,
          Markup.inlineKeyboard(buttons)
        )
      );
      return { message_id: ctx.session.groupListMessageId };
    } else {
      const message = await telegramRetry(() =>
        ctx.reply(text, Markup.inlineKeyboard(buttons))
      );
      return message;
    }
  } catch (err) {
    logger.error('Erro ao exibir grupos para lista:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao listar grupos: ${err.message}`));
  }
}

bot.action(/toggle_group_(\d+)_(\d+)/, async (ctx) => {
  const groupIndex = parseInt(ctx.match[1]);
  const page = parseInt(ctx.match[2]);
  const { session, listName } = ctx.session.editingList || {};

  try {
    if (!session || !listName || !ctx.session.tempGroups) {
      await telegramRetry(() => ctx.reply('❌ Sessão de edição inválida. Tente novamente.'));
      return;
    }

    const group = ctx.session.tempGroups[groupIndex];
    if (!group) {
      await telegramRetry(() => ctx.reply('❌ Grupo não encontrado.'));
      return;
    }

    if (!db.customLists[session]) db.customLists[session] = {};
    if (!db.customLists[session][listName]) db.customLists[session][listName] = [];

    const list = db.customLists[session][listName];
    const index = list.indexOf(group.id);
    if (index === -1) {
      list.push(group.id);
    } else {
      list.splice(index, 1);
    }

    await showGroupsForList(ctx, session, listName, page);
  } catch (err) {
    logger.error('Erro ao adicionar/remover grupo da lista:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/list_page_(.+)_(.+)_(\d+)/, async (ctx) => {
  const session = ctx.match[1];
  const listName = ctx.match[2];
  const page = parseInt(ctx.match[3]);

  try {
    await showGroupsForList(ctx, session, listName, page);
  } catch (err) {
    logger.error('Erro ao navegar entre páginas:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao mudar de página: ${err.message}`));
  }
});

bot.action(/save_list_(.+)_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  const listName = ctx.match[2];
  try {
    await saveDb();
    await telegramRetry(() => ctx.reply(`✅ Lista "${listName}" salva com sucesso!`));
    delete ctx.session.tempGroups;
    delete ctx.session.editingList;
    delete ctx.session.groupListMessageId;
    mainMenu(ctx);
  } catch (err) {
    logger.error('Erro ao salvar lista:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.action(/cancel_action_list_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    await telegramRetry(() => ctx.reply(`❌ Edição da lista cancelada.`));
    delete ctx.session.tempGroups;
    delete ctx.session.editingList;
    delete ctx.session.groupListMessageId;
    mainMenu(ctx);
  } catch (err) {
    logger.error('Erro ao cancelar edição da lista:', err);
  }
});

bot.action('menu', (ctx) => mainMenu(ctx));

bot.action(/cancel_action_(.+)/, async (ctx) => {
  const action = ctx.match[1];
  try {
    await telegramRetry(() => ctx.reply(`❌ Ação cancelada.`));
    mainMenu(ctx);
  } catch (err) {
    logger.error('Erro ao cancelar ação:', err);
  }
});

bot.action(/cancel_task_(.+)/, async (ctx) => {
  const taskId = ctx.match[1];
  const workerData = activeWorkers.get(taskId);
  try {
    if (workerData && workerData.worker) {
      const { worker, messageId } = workerData;
      worker.postMessage({ type: 'cancel', messageId });
      activeWorkers.delete(taskId);
      await telegramRetry(() => ctx.reply('❌ Cancelando o envio de mensagens...'));
    } else {
      await telegramRetry(() => ctx.reply('❌ Nenhuma tarefa de envio ativa encontrada para cancelar.'));
    }
    mainMenu(ctx);
  } catch (err) {
    logger.error('Erro ao cancelar tarefa:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao cancelar: ${err.message}`));
  }
});

bot.on('text', async (ctx) => {
  try {
    if (ctx.session.waitingForPhone) {
      const phone = ctx.message.text.trim();
      if (!/^\d{13}$/.test(phone)) {
        await telegramRetry(() => ctx.reply('❌ Número inválido. Use o formato: 5511999999999'));
        return;
      }
      ctx.session.waitingForPhone = false;
      await telegramRetry(() => ctx.reply('🔄 Gerando QR Code...'));
      const authDir = path.join(__dirname, 'auth_info_multi', phone);

      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
      }

      await client_browser.createNewSession(phone, ctx);
    } else if (ctx.session.waitingForMessage && ctx.session.selectedSession) {
      const session = ctx.session.selectedSession;
      if (isSessionInUse(session)) {
        const userId = getSessionUser(session);
        await telegramRetry(() =>
          ctx.reply(`⚠️ A sessão ${session} está em uso pelo chat ${userId}. Deseja adicionar à fila?`, 
            Markup.inlineKeyboard([
              [Markup.button.callback('✅ Sim', `queue_message_${session}`)],
              [Markup.button.callback('❌ Não', 'menu')]
            ]))
        );
        ctx.session.messageToQueue = { text: ctx.message.text.trim() };
        return;
      }

      setSessionInUse(session, true, ctx.chat.id);
      await telegramRetry(() => ctx.reply(`📤 Iniciando envio...`));

      const text = ctx.message.text.trim();
      let content;

      if (/^https:\/\/promode/.test(text)) {
        const scraped = await scrapePromo(text);
        if (scraped) {
          content = { text: scraped.message, photo: scraped.imagePath };
        } else {
          await telegramRetry(() => ctx.reply('❌ Erro ao processar o link de promoção.'));
          setSessionInUse(session, false);
          return;
        }
      } else {
        content = { text };
      }

      const groupList = ctx.session.selectedList ? db.customLists[session][ctx.session.selectedList] : null;
      const taskId = await sendToAllGroups(session, content, ctx.chat.id, null, groupList);
      ctx.session.taskId = taskId;

      ctx.session.waitingForMessage = false;
      ctx.session.selectedSession = null;
      ctx.session.selectedList = null;
      ctx.session.sendToAll = false;
      mainMenu(ctx);
    } else if (ctx.session.editingSession) {
      const newName = ctx.message.text.trim();
      await editSessionName(ctx, ctx.session.editingSession, newName);
      ctx.session.editingSession = null;
      mainMenu(ctx);
    } else if (ctx.session.creatingListFor) {
      const session = ctx.session.creatingListFor;
      const listName = ctx.message.text.trim();
      if (!listName) {
        await telegramRetry(() => ctx.reply('❌ Nome da lista não pode ser vazio.'));
        return;
      }
      if (!db.customLists[session]) db.customLists[session] = {};
      if (db.customLists[session][listName]) {
        await telegramRetry(() => ctx.reply('❌ Já existe uma lista com esse nome.'));
        return;
      }
      db.customLists[session][listName] = [];
      await saveDb();
      ctx.session.creatingListFor = null;

      let client;
      try {
        client = await getTemporaryClient(session);
        const chats = await client.groupFetchAllParticipating();
        const groupChats = Object.values(chats).filter(chat => chat.id.endsWith('@g.us'));
        ctx.session.tempGroups = groupChats.map((group, index) => ({ index, ...group }));
        ctx.session.editingList = { session, listName };
        const message = await showGroupsForList(ctx, session, listName, 0);
        ctx.session.groupListMessageId = message.message_id;
      } catch (err) {
        logger.error('Erro ao carregar grupos para criação:', err);
        await telegramRetry(() => ctx.reply(`❌ Erro ao carregar grupos: ${err.message}. Verifique se a sessão está autenticada.`));
      } finally {
        if (client) client.end();
      }
    } else if (ctx.session.waitingForUserToAdd) {
      const user = ctx.message.text.trim();
      if (!user) {
        await telegramRetry(() => ctx.reply('❌ Usuário inválido. Forneça um @username ou ID/número de telefone.'));
        return;
      }
      if (db.botControl.allowedUsers.includes(user)) {
        await telegramRetry(() => ctx.reply('❌ Este usuário já está na lista de permitidos.'));
        return;
      }
      db.botControl.allowedUsers.push(user);
      await saveDb();
      ctx.session.waitingForUserToAdd = false;
      await telegramRetry(() => ctx.reply(`✅ Usuário ${user} adicionado à lista de permitidos.`));
      mainMenu(ctx);
    } else {
      await telegramRetry(() =>
        ctx.reply('Use /menu para acessar as opções.', Markup.inlineKeyboard([
          [Markup.button.callback('Menu', 'menu')]
        ]))
      );
    }
  } catch (err) {
    logger.error('Erro ao processar mensagem de texto:', err);
    await telegramRetry(() => ctx.reply(`❌ Ocorreu um erro: ${err.message}. Tente novamente ou use /menu.`));
  }
});

bot.action(/queue_message_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    const content = ctx.session.messageToQueue;
    const groupList = ctx.session.selectedList ? db.customLists[session][ctx.session.selectedList] : null;
    const taskId = await addToQueue(session, content, ctx.chat.id, groupList);
    await telegramRetry(() => ctx.reply(`✅ Mensagem adicionada à fila com ID ${taskId}.`));
    ctx.session.waitingForMessage = false;
    ctx.session.selectedSession = null;
    ctx.session.selectedList = null;
    ctx.session.sendToAll = false;
    delete ctx.session.messageToQueue;
    mainMenu(ctx);
    processNextInQueue(session);
  } catch (err) {
    logger.error('Erro ao adicionar mensagem à fila:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.on('photo', async (ctx) => {
  try {
    if (ctx.session.waitingForMessage && ctx.session.selectedSession) {
      const session = ctx.session.selectedSession;
      if (isSessionInUse(session)) {
        const userId = getSessionUser(session);
        await telegramRetry(() =>
          ctx.reply(`⚠️ A sessão ${session} está em uso pelo chat ${userId}. Deseja adicionar à fila?`, 
            Markup.inlineKeyboard([
              [Markup.button.callback('✅ Sim', `queue_photo_${session}`)],
              [Markup.button.callback('❌ Não', 'menu')]
            ]))
        );
        ctx.session.photoToQueue = { fileId: ctx.message.photo[ctx.message.photo.length - 1].file_id, caption: ctx.message.caption || '' };
        return;
      }

      setSessionInUse(session, true, ctx.chat.id);
      await telegramRetry(() => ctx.reply(`📤 Iniciando envio...`));
      const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const filePath = await downloadFile(fileLink, 'jpg');
      const content = { photo: filePath, caption: ctx.message.caption || '' };
      const groupList = ctx.session.selectedList ? db.customLists[session][ctx.session.selectedList] : null;
      const taskId = await sendToAllGroups(session, content, ctx.chat.id, null, groupList);
      ctx.session.taskId = taskId;

      ctx.session.waitingForMessage = false;
      ctx.session.selectedSession = null;
      ctx.session.selectedList = null;
      ctx.session.sendToAll = false;
      mainMenu(ctx);
    }
  } catch (err) {
    logger.error('Erro ao processar foto:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao processar foto: ${err.message}`));
    setSessionInUse(ctx.session.selectedSession, false);
  }
});

bot.action(/queue_photo_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    const { fileId, caption } = ctx.session.photoToQueue;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const filePath = await downloadFile(fileLink, 'jpg');
    const content = { photo: filePath, caption };
    const groupList = ctx.session.selectedList ? db.customLists[session][ctx.session.selectedList] : null;
    const taskId = await addToQueue(session, content, ctx.chat.id, groupList);
    await telegramRetry(() => ctx.reply(`✅ Foto adicionada à fila com ID ${taskId}.`));
    ctx.session.waitingForMessage = false;
    ctx.session.selectedSession = null;
    ctx.session.selectedList = null;
    ctx.session.sendToAll = false;
    delete ctx.session.photoToQueue;
    mainMenu(ctx);
    processNextInQueue(session);
  } catch (err) {
    logger.error('Erro ao adicionar foto à fila:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.on('video', async (ctx) => {
  try {
    if (ctx.session.waitingForMessage && ctx.session.selectedSession) {
      const session = ctx.session.selectedSession;
      if (isSessionInUse(session)) {
        const userId = getSessionUser(session);
        await telegramRetry(() =>
          ctx.reply(`⚠️ A sessão ${session} está em uso pelo chat ${userId}. Deseja adicionar à fila?`, 
            Markup.inlineKeyboard([
              [Markup.button.callback('✅ Sim', `queue_video_${session}`)],
              [Markup.button.callback('❌ Não', 'menu')]
            ]))
        );
        ctx.session.videoToQueue = { fileId: ctx.message.video.file_id, caption: ctx.message.caption || '' };
        return;
      }

      setSessionInUse(session, true, ctx.chat.id);
      await telegramRetry(() => ctx.reply(`📤 Iniciando envio...`));
      const fileId = ctx.message.video.file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const filePath = await downloadFile(fileLink, 'mp4');
      const content = { video: filePath, caption: ctx.message.caption || '' };
      const groupList = ctx.session.selectedList ? db.customLists[session][ctx.session.selectedList] : null;
      const taskId = await sendToAllGroups(session, content, ctx.chat.id, null, groupList);
      ctx.session.taskId = taskId;

      ctx.session.waitingForMessage = false;
      ctx.session.selectedSession = null;
      ctx.session.selectedList = null;
      ctx.session.sendToAll = false;
      mainMenu(ctx);
    }
  } catch (err) {
    logger.error('Erro ao processar vídeo:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao processar vídeo: ${err.message}`));
    setSessionInUse(ctx.session.selectedSession, false);
  }
});

bot.action(/queue_video_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    const { fileId, caption } = ctx.session.videoToQueue;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const filePath = await downloadFile(fileLink, 'mp4');
    const content = { video: filePath, caption };
    const groupList = ctx.session.selectedList ? db.customLists[session][ctx.session.selectedList] : null;
    const taskId = await addToQueue(session, content, ctx.chat.id, groupList);
    await telegramRetry(() => ctx.reply(`✅ Vídeo adicionado à fila com ID ${taskId}.`));
    ctx.session.waitingForMessage = false;
    ctx.session.selectedSession = null;
    ctx.session.selectedList = null;
    ctx.session.sendToAll = false;
    delete ctx.session.videoToQueue;
    mainMenu(ctx);
    processNextInQueue(session);
  } catch (err) {
    logger.error('Erro ao adicionar vídeo à fila:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.on('document', async (ctx) => {
  try {
    if (ctx.session.waitingForMessage && ctx.session.selectedSession) {
      const session = ctx.session.selectedSession;
      if (isSessionInUse(session)) {
        const userId = getSessionUser(session);
        await telegramRetry(() =>
          ctx.reply(`⚠️ A sessão ${session} está em uso pelo chat ${userId}. Deseja adicionar à fila?`, 
            Markup.inlineKeyboard([
              [Markup.button.callback('✅ Sim', `queue_document_${session}`)],
              [Markup.button.callback('❌ Não', 'menu')]
            ]))
        );
        ctx.session.documentToQueue = { fileId: ctx.message.document.file_id, caption: ctx.message.caption || '', fileExtension: ctx.message.document.file_name.split('.').pop() };
        return;
      }

      setSessionInUse(session, true, ctx.chat.id);
      await telegramRetry(() => ctx.reply(`📤 Iniciando envio...`));
      const fileId = ctx.message.document.file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const fileExtension = ctx.message.document.file_name.split('.').pop();
      const filePath = await downloadFile(fileLink, fileExtension);
      const content = { document: filePath, caption: ctx.message.caption || '' };
      const groupList = ctx.session.selectedList ? db.customLists[session][ctx.session.selectedList] : null;
      const taskId = await sendToAllGroups(session, content, ctx.chat.id, null, groupList);
      ctx.session.taskId = taskId;

      ctx.session.waitingForMessage = false;
      ctx.session.selectedSession = null;
      ctx.session.selectedList = null;
      ctx.session.sendToAll = false;
      mainMenu(ctx);
    }
  } catch (err) {
    logger.error('Erro ao processar documento:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao processar documento: ${err.message}`));
    setSessionInUse(ctx.session.selectedSession, false);
  }
});

bot.action(/queue_document_(.+)/, async (ctx) => {
  const session = ctx.match[1];
  try {
    const { fileId, caption, fileExtension } = ctx.session.documentToQueue;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const filePath = await downloadFile(fileLink, fileExtension);
    const content = { document: filePath, caption };
    const groupList = ctx.session.selectedList ? db.customLists[session][ctx.session.selectedList] : null;
    const taskId = await addToQueue(session, content, ctx.chat.id, groupList);
    await telegramRetry(() => ctx.reply(`✅ Documento adicionado à fila com ID ${taskId}.`));
    ctx.session.waitingForMessage = false;
    ctx.session.selectedSession = null;
    ctx.session.selectedList = null;
    ctx.session.sendToAll = false;
    delete ctx.session.documentToQueue;
    mainMenu(ctx);
    processNextInQueue(session);
  } catch (err) {
    logger.error('Erro ao adicionar documento à fila:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

bot.telegram.setMyCommands([
  { command: 'menu', description: 'Mostrar o menu principal' },
]);

// Iniciar o monitoramento
monitorWorkers();
bot.launch().then(() => logger.info('Bot iniciado!'));

// Prepara Client
const client_browser = new ClientBrowser( logger);

client_browser.start()

// Iniciar o servidor Express
app.listen(port, () => {
  logger.info(`Servidor Express rodando na porta ${port}`);
  createTable().then(
    res => {
      if (res.status == "success") {
        logger.info(res.msg);
      } else {
        logger.error(`[ERRO ao criar DATABASE] ${res.error}`);
      }
    }
  )
});


process.on('uncaughtException', (err) => {
  logger.error('🚨 Erro crítico não tratado (uncaughtException):', err);
});

process.on('unhandledRejection', (err) => {
  logger.error('🚨 Erro não tratado (unhandledRejection):', err);
});