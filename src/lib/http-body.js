function readBodyBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;

    function onData(chunk) {
      if (done) return;
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += buf.length;
      if (total > maxBytes) {
        done = true;
        req.removeListener('data', onData);
        if (typeof req.resume === 'function') req.resume();
        const err = Object.assign(new Error('Request body too large.'), { code: 'body_too_large' });
        reject(err);
        return;
      }
      chunks.push(buf);
    }

    function onEnd() {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks, total));
    }

    function onError(err) {
      if (done) return;
      done = true;
      reject(err);
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

module.exports = { readBodyBuffer };
