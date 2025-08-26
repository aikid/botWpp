import { Telegraf, Markup, session }  from 'telegraf';

import { TELEGRAM_TOKEN } from '../config';
import { logger } from '../logger';

import addSession from '../db/addSession';
import getAllSessions from '../db/getAllSessions';
import delSessions from '../db/delSessions';

import  getUserProfile from '../whapi/getUserProfile';

import telegramRetry from '../utils/telegramRetry';


const bot = new Telegraf(TELEGRAM_TOKEN, { handlerTimeout: 30000 });

bot.use(session({
  defaultSession: () => ({
    waitingForToken: false,
    taskId: null,
  }),
}));

// Menu principal
const menu = async(ctx) =>{
  ctx.session = { taskId: ctx.session?.taskId || null }; // preserva taskId
  try {
    await telegramRetry(() =>
      ctx.reply('📋 Gerenciar Sessões:', Markup.inlineKeyboard([
        [Markup.button.callback('➕ Adicionar Sessão', 'add_session')],
        [Markup.button.callback('🗑️ Remover Sessão', 'remove_session')],
        [Markup.button.callback('📱 Listar Sessões', 'list_sessions')]
      ]))
    );
  } catch (err) {
    logger.error('Erro ao exibir menu de gerenciamento:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao exibir menu: ${err.message}`));
  }
}

// create session
bot.action('add_session', async (ctx) => {
  try {

    ctx.session.waitingForToken = true;

    await telegramRetry(() =>
      ctx.reply('Cole o token gerado na Whapi:', Markup.inlineKeyboard([
        [Markup.button.callback('↩️ Menu', 'menu')]
      ]))
    );
  } catch (err) {
    logger.error('Erro ao solicitar token:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

// Listar sessões
bot.action('list_sessions', async (ctx) => {
  try {
    const lisSessions = await getAllSessions();

    if (lisSessions.length === 0) {
      return ctx.reply('⚠️ Nenhuma sessão cadastrada.');
    }

    let msg = '📱 Sessões cadastradas:\n\n';

    for (const s of lisSessions) {
      msg += `• ID: ${s.id} | ${s.name}\n`;
    }

    await telegramRetry(() => ctx.reply(msg));
  } catch (err) {
    logger.error('Erro ao listar sessões:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao listar sessões: ${err.message}`));
  }
});

// Remover sessão
bot.action('remove_session', async (ctx) => {
  try {
    const lisSessions = await getAllSessions();

    if (lisSessions.length === 0) {
      return ctx.reply('⚠️ Nenhuma sessão para remover.');
    }

    const buttons = lisSessions.map(s => [
      Markup.button.callback(`${s.name}`, `confirm_remove_${s.id}`)
    ]);

    buttons.push([Markup.button.callback('↩️ Voltar', 'menu')]);

    await telegramRetry(() =>
      ctx.reply('Selecione a sessão para remover:', Markup.inlineKeyboard(buttons))
    );
  } catch (err) {
    logger.error('Erro ao preparar remoção de sessão:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro: ${err.message}`));
  }
});

// Confirma e remove a sessão
bot.action(/confirm_remove_(\d+)/, async (ctx) => {
  const sessionId = ctx.match[1];
  try {
    delSessions(sessionId);
    await telegramRetry(() =>
      ctx.reply(`🗑️ Sessão ID ${sessionId} removida com sucesso!`)
    );
  } catch (err) {
    logger.error('Erro ao remover sessão:', err);
    await telegramRetry(() => ctx.reply(`❌ Erro ao remover sessão: ${err.message}`));
  }
});


bot.command('start', (ctx) => menu(ctx));
bot.command('menu', (ctx) => menu(ctx));
bot.action('menu', (ctx) => menu(ctx));

// create session confirm
bot.on('text', async (ctx) => {
  if (ctx.session?.waitingForToken) {
    const token = ctx.message.text.trim();

    ctx.session.waitingForToken = false;

    try {
        const res = await getUserProfile(token);
        const { name, about, icon } =  res;

        if (name) {
            const resAdd = await addSession(token, name, about, icon);

            if (resAdd.status == 'success') {
              await telegramRetry(() =>
                ctx.reply(`✅ Sessão adicionada com sucesso!\nID: \nNome contato: ${name}...`)
              );
            }
        }

    } catch (err) {
      logger.error('Erro ao salvar sessão:', err);
      await telegramRetry(() => ctx.reply(`❌ Erro ao salvar sessão: ${err.message}`));
    }
  }
});

export default bot;