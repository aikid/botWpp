async function telegramRetry(fn, maxRetries = 3, baseDelay = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.code === 'ECONNRESET' || err.response?.status === 429) {
        const delayTime = baseDelay * Math.pow(2, i);
        logger.info(`Tentativa ${i + 1} falhou: ${err.message}. Tentando novamente em ${delayTime / 1000}s...`);
        await delay(delayTime);
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Falha após ${maxRetries} tentativas`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export {telegramRetry, delay };