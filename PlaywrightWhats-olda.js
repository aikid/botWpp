import { chromium } from 'playwright';
import fs from 'fs/promises';
import test from 'playwright/test';

export class BrowserWhatsapp {
  constructor(session) {
    this.session = session;
    this.browser = null;
    this.page = null;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
  screenshot = async () => {
    
    const buffer = await this.page.screenshot();
    await fs.writeFile('screenshot.png', buffer);
    const body = await this.page.$("body")
    const textHtml = await body.innerHTML();
    return textHtml;
  }
  isConnected = async () => {
    // Verifica se o QR code está presente
    const qrDetected = await this.page.waitForSelector('[data-ref]', {
      timeout: 30000
    }).then(() => true).catch(() => false);

    await this.screenshot();

    return qrDetected ? false : true;
  }
  async isLoadChats(callback) {
      const targetSelector = "#side > div:nth-child(2)";
      const side_left = await this.page.$(targetSelector);
      if (side_left) {
        callback();
        return;
      };
      
      await this.page.exposeFunction("onChatsLoaded", async () => {
          await this.page.waitForTimeout(10000);
          const btns = await this.page.$$('button');
          for (const btn of btns){
            if(["continuar", "continue"].includes(String(await btn.innerText()).toLowerCase())) await btn.click();
          }

          if (callback) callback();
          
      });

      await this.page.evaluate(() => {
          const targetSelector = "#side > div:nth-child(2)";
          
          const checkAndTrigger = () => {
              if (document.querySelector(targetSelector)) {
                  window.onChatsLoaded();
                  observer.disconnect();
              }
          };

          const observer = new MutationObserver(() => {
              checkAndTrigger();
          });

          observer.observe(document.body, { childList: true, subtree: true });

          checkAndTrigger();
      });
  }

  async start(callbackStatus, callbackConnect = null) {
    callbackStatus("Iniciando Contexto Web", null);

    this.browser = await chromium.launchPersistentContext(`./SessionsWhats/${this.session}`, {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-infobars',
        '--disable-blink-features=AutomationControlled',
        '--lang=pt-BR',
        '--window-size=1280,800'
      ],
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
             '(KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    });
    
    this.page = await this.browser.newPage();

    callbackStatus("Iniciando WebWhatsapp", null);
    await this.page.goto('https://web.whatsapp.com/');

    let qr_code = null;
    const timeout = Date.now() + 300000; // 5 min

    while (Date.now() < timeout) {
      callbackStatus("Verificando conexão com Whatsapp", null);
      if (await this.isConnected()) {
        callbackStatus("Whatsapp está logado, Sessão Conectada!", null);
        return;
      }

      callbackStatus("Whatsapp não está logado", null);
      if (!callbackConnect) return;

      // Tenta obter novo QR Code
      const new_qr = await this.page.evaluate( async () => {
          for (let i = 0; i < 5; i++) {
            const el = await document.querySelector('[data-ref]');
            const qr = el ? await el.getAttribute('data-ref') : null;
            if (qr) return qr;
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
          return null;
      });

      if (new_qr && new_qr !== qr_code) {
        qr_code = new_qr;
        callbackStatus("Aguardando conexao com qr_code", null);
        callbackConnect("Connect", qr_code);
      }

      await this.page.waitForTimeout(2000);
    }
  }
  async sendMessageImageByPattern(pattern, bufferImage, caption, callback, delay) {

    const already_seen = new Set();

    for (let attempt = 0; attempt < 2; attempt++) {
      try {

          try {
            await this.page.waitForSelector('#group-filter, #all-filter', { timeout: 15000 });
          } catch (err) {
            return 
          }

          const btn_modal = await this.page.$('button:nth-child(1)');
          if (btn_modal) {
            await btn_modal.click();
          }

          const btn_all_filter = await this.page.$('#all-filter');
          let btn_group_filter = await this.page.$('#group-filter');

          
          if (btn_all_filter) {
            await btn_all_filter.click();
          }
        
          const chatArchived = await this.page.$('#pane-side > button:nth-child(1)');
          const has_chatArchived = (chatArchived) ? true : false;

          if (has_chatArchived) {
              await chatArchived.click();
          } else if (btn_group_filter) {
            await btn_group_filter.click();
          }
          
          const attemptSend = async (filterList, add, has) => {

            while (true) {
                let chats = await this.page.$$(filterList);

                for (let chat of chats){
                    if (filterList.includes("não lidas")) {
                      chat = await chat.evaluateHandle((el) => {
                        return el.parentElement.parentElement.parentElement.parentElement.parentElement.parentElement;
                      });
                    } else {
                      chat = await chat.$('div:nth-child(1) > div:nth-child(1) > div:nth-child(1)');
                    }
                    
                    let title = await chat.$('[title]');
                    
                    let text = (title) ? await title.innerText() : "";
                    text = text.trim();
                    console.log(text);
                    const clean = pattern.trim();  
                    let _pattern;
                    
                    try {
                      _pattern = new RegExp(clean);
                    } catch (err) {
                      callback(`Regex inválida: "${clean}" -> ${err.message}`);
                      return;
                    }

                    if (!_pattern.test(text)) continue;
                    
                    if (!has(text)){
                        await chat.click();

                        let timeout = Date.now() + 10000;
                        while (Date.now() < timeout) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                            if (await this.page.$('[data-id]')) break;
                        }
                        
                        const elem_chat_id = await this.page.$('[data-id]')
                        
                        const chat_id = await elem_chat_id.getAttribute('data-id');

                        const match = chat_id.match(/(\d+@(c|g)\.us)/);
                        
                        callback(`➡️ [ENVIANDO MENSAGEM] para ${match?.[1]} - ${text}`)

                        const send = await this.#____sendMessageImage(bufferImage, caption);
                          
                        if (!send?.success) {
                            callback(`❌ [ERRO AO ENVIAR MENSAGEM] para ${match?.[1]} - ${text}`);
                            continue;
                        } else {
                            callback(`✅ [MENSAGEM ENVIADA] para ${match?.[1]} - ${text}`);
                            add(text);
                            await new Promise((resolve) => setTimeout(resolve, delay));
                        }
                    }
                }

                const isEndScroll = await this.page.evaluate(async () => {
                  await document.querySelector('#pane-side').scrollBy(0, 500);
                  
                  await new Promise(resolve => setTimeout(resolve, 200));
                  
                  const el = document.querySelector('#pane-side');

                  if (el.scrollTop + el.clientHeight >= el.scrollHeight) {
                    el.scrollBy(0,-999999999999);
                    return true;
                  } else {
                    return false;
                  }
                });

                if (isEndScroll) break;
            
            }
          }

          await attemptSend('[role="listitem"]', 
            (value) => already_seen.add(value), 
            (value) => {return already_seen.has(value)});

          await attemptSend('span[aria-label*="não lidas"]', 
            (value) => already_seen.add(value), 
            (value) => {return already_seen.has(value)});

          if (has_chatArchived) {
            
              const btn_voltar = await this.page.$('[aria-label="Voltar"]');
              if (btn_voltar) await btn_voltar.click();

              try {
                await this.page.waitForSelector('#group-filter', { timeout: 15000 });
              } catch (err) {
                return 
              }

              btn_group_filter = await this.page.$('#group-filter');

              if (btn_group_filter) {
                await btn_group_filter.click();
              }
              
            await attemptSend('[role="listitem"]', 
              (value) => already_seen.add(value), 
              (value) => {return already_seen.has(value)});

            await attemptSend('span[aria-label*="não lidas"]', 
              (value) => already_seen.add(value), 
              (value) => {return already_seen.has(value)});
          }

          const btn_list_unreads = await this.page.$('#unread-filter');

          if (btn_list_unreads) {
              await btn_list_unreads.click();
          }

          await attemptSend('[role="listitem"]', 
            (value) => already_seen.add(value), 
            (value) => {return already_seen.has(value)});
          

          break;
      } catch (error) {
          this.driver.get('https://web.whatsapp.com/');
      }
    }
    return true;
  }

  async #____sendMessageImage(bufferImage, caption) {

    try {
      await this.page.waitForSelector('[title=Anexar]', { timeout: 15000 });
    } catch (err) {
      return { success: false, msg: err };
    }

    await this.page.waitForTimeout(500);
    
    await this.page.evaluate(() => {

        const btn_attach = document.querySelector('[title=Anexar]');
        btn_attach.click();

    });

    await this.page.waitForTimeout(500);

    const inputAttach = await this.page.$('[accept="image/*,video/mp4,video/3gpp,video/quicktime"]');

    await inputAttach.setInputFiles({
      name: 'campanha.jpg',
      mimeType: 'image/jpeg',
      buffer: bufferImage
    });

    await this.page.waitForTimeout(100);

    try {
      await this.page.waitForSelector('div[aria-label*="legend"]', { timeout: 15000 });
    } catch (err) {
      const buffer = await this.page.screenshot();
      await fs.writeFile('screenshot.png', buffer);
      return { success: false, msg: err };
    }
    
    const textarea = await this.page.waitForSelector('div[aria-label*="legend"]', { timeout: 10000 });
    await textarea.focus();

    const lines = caption.split('\n');

    for (let i = 0; i < lines.length; i++) {
      await textarea.type(lines[i], { delay: 100 });

      if (i !== lines.length - 1) {
        await textarea.press('Control+Enter');
      }
    }

    await textarea.press('Enter');
    
    await this.page.waitForTimeout(1000);

    const more_options = await this.page.$('#main [aria-label="Mais opções"],#main [aria-label="More options"]');

    await more_options.click();

    await this.page.waitForTimeout(100);

    await this.page.waitForSelector('#app > div > span:nth-child(8) > div > ul > div > div > div > li',{ timeout: 10000 });

    return await this.page.evaluate(async () => {
        const list_options = await document.querySelectorAll('#app > div > span:nth-child(8) > div > ul > div > div > div > li');
            for (const option of list_options){
                let text = await option.textContent;
                text = text.toLowerCase();
                if ((text).includes("fechar") || (text).includes("close") ){
                    option.click();
                    return { success: true, msg: "Mensagem Enviada!" };
                }
            }
    })
  }
}